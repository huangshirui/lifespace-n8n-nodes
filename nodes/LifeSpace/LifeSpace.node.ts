import type {
  FieldType,
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  ResourceMapperFields,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
  discoveryModel,
  discoverySpace,
  humanizeKey,
  loadRuntimeDiscovery,
  normalizeBaseUrl,
  type DiscoveryAccess,
  type DiscoveryField,
} from '../lifespaceDiscovery';

type QueryFilter = {
  field?: string;
  operator?: 'exact' | 'from' | 'to';
  value?: string;
};

type QueryPage = {
  items: IDataObject[];
  nextCursor: string | null;
};

function parseJsonObject(
  context: IExecuteFunctions,
  itemIndex: number,
  value: unknown,
  fieldName: string,
): IDataObject {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NodeOperationError(context.getNode(), `${fieldName} must be a JSON object`, { itemIndex });
  }
  return parsed as IDataObject;
}

function mappedValue(context: IExecuteFunctions, itemIndex: number, parameterName: string): IDataObject {
  const value = context.getNodeParameter(`${parameterName}.value`, itemIndex, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value as IDataObject : {};
}

function queryParameters(
  context: IExecuteFunctions,
  itemIndex: number,
  limit: number,
  cursorOverride?: string,
): IDataObject {
  const qs: IDataObject = {};
  const search = String(context.getNodeParameter('search', itemIndex, '')).trim();
  const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const sortField = String(options.sortField ?? '').trim();
  const sortDirection = String(options.sortDirection ?? 'desc').trim();
  const configuredCursor = String(options.cursor ?? '').trim();
  const cursor = cursorOverride ?? configuredCursor;
  const filters = context.getNodeParameter('filters.filter', itemIndex, []) as QueryFilter[];

  if (search) qs.q = search;
  if (sortField) qs.sort = `${sortField}:${sortDirection}`;
  qs.limit = limit;
  if (cursor) qs.cursor = cursor;

  const usedKeys = new Set<string>();
  for (const filter of filters) {
    const field = String(filter.field ?? '').trim();
    const value = String(filter.value ?? '');
    const operator = filter.operator ?? 'exact';
    if (!field || value === '') continue;
    const key = operator === 'from' ? `${field}From` : operator === 'to' ? `${field}To` : field;
    if (usedKeys.has(key)) {
      throw new NodeOperationError(context.getNode(), `Query filter ${key} may be supplied only once`, { itemIndex });
    }
    usedKeys.add(key);
    qs[key] = value;
  }

  return qs;
}

function queryPage(context: IExecuteFunctions, itemIndex: number, response: unknown): QueryPage {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace query returned an invalid response', { itemIndex });
  }
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace query response is missing data', { itemIndex });
  }
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace query response is missing data.items', { itemIndex });
  }
  const nextCursorValue = (data as { nextCursor?: unknown }).nextCursor;
  return {
    items: items.filter((entry): entry is IDataObject => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)),
    nextCursor: typeof nextCursorValue === 'string' && nextCursorValue ? nextCursorValue : null,
  };
}

function requiredAccessForOperation(operation: string): DiscoveryAccess {
  return ['create', 'update', 'delete'].includes(operation) ? 'write' : 'read';
}

function resourceMapperType(field: DiscoveryField): FieldType {
  switch (field.type) {
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'datetime':
      return 'dateTime';
    case 'person_list':
    case 'record_list':
      return 'array';
    case 'enum':
      return 'options';
    default:
      // Date-only values intentionally remain strings so n8n does not convert
      // YYYY-MM-DD business dates into timezone-bearing instants.
      return 'string';
  }
}

function mapperField(field: DiscoveryField, required: boolean) {
  return {
    id: field.key,
    displayName: humanizeKey(field.key),
    required,
    defaultMatch: false,
    canBeUsedToMatch: false,
    display: true,
    type: resourceMapperType(field),
    options: field.type === 'enum'
      ? (field.values ?? []).map((value) => ({ name: value, value }))
      : undefined,
  };
}

export class LifeSpace implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace',
    name: 'lifeSpace',
    icon: {
      light: 'file:lifespace.svg',
      dark: 'file:lifespace.dark.svg',
    },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["resource"] === "modelRecord" ? $parameter["operation"] : "API Request"}}',
    description: 'Use LifeSpace records and APIs in n8n workflows',
    defaults: {
      name: 'LifeSpace',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [
      {
        name: 'lifeSpaceApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Record',
            value: 'modelRecord',
          },
          {
            name: 'API Request',
            value: 'apiRequest',
          },
        ],
        default: 'modelRecord',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['modelRecord'] } },
        options: [
          {
            name: 'Create',
            value: 'create',
            action: 'Create a record',
            description: 'Create a record through the LifeSpace Generic Runtime',
          },
          {
            name: 'Delete',
            value: 'delete',
            action: 'Delete a record',
            description: 'Delete a record using optimistic concurrency',
          },
          {
            name: 'Execute Action',
            value: 'executeAction',
            action: 'Execute a record action',
            description: 'Execute a published Capability or workflow action on a record',
          },
          {
            name: 'Get',
            value: 'get',
            action: 'Get a record',
            description: 'Get one record by ID',
          },
          {
            name: 'List / Query',
            value: 'list',
            action: 'List or query records',
            description: 'Query a record collection using its published query contract',
          },
          {
            name: 'Update',
            value: 'update',
            action: 'Update a record',
            description: 'Update a record using optimistic concurrency',
          },
        ],
        default: 'list',
      },
      {
        displayName: 'Space Name or ID',
        name: 'spaceId',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'getSpaces',
        },
        options: [],
        default: '',
        required: true,
        displayOptions: { show: { resource: ['modelRecord'] } },
        description: 'Choose a Space available to the current LifeSpace credential',
      },
      {
        displayName: 'Record Type Name or ID',
        name: 'modelRoute',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'getRecordTypes',
          loadOptionsDependsOn: ['spaceId', 'operation'],
        },
        options: [],
        default: '',
        required: true,
        displayOptions: { show: { resource: ['modelRecord'] } },
        description: 'Choose from Record Types available in the selected Space',
      },
      {
        displayName: 'Record ID',
        name: 'recordId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['get', 'update', 'delete', 'executeAction'],
          },
        },
      },
      {
        displayName: 'Fields',
        name: 'fields',
        type: 'resourceMapper',
        default: {
          mappingMode: 'defineBelow',
          value: null,
        },
        noDataExpression: true,
        required: true,
        typeOptions: {
          loadOptionsDependsOn: ['spaceId', 'modelRoute', 'operation'],
          resourceMapper: {
            resourceMapperMethod: 'getRecordFields',
            mode: 'add',
            fieldWords: {
              singular: 'field',
              plural: 'fields',
            },
            addAllFields: true,
            supportAutoMap: false,
            noFieldsError: 'The selected LifeSpace Record Type has no writable fields for this operation.',
          },
        },
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['create', 'update'],
          },
        },
        description: 'Writable fields loaded from LifeSpace Runtime Discovery. Human-readable field labels will come from LifeSpace semantics when available.',
      },
      {
        displayName: 'Version',
        name: 'version',
        type: 'number',
        typeOptions: { minValue: 1, numberPrecision: 0 },
        default: 1,
        required: true,
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['update', 'delete'],
          },
        },
        description: 'Current record version used by LifeSpace optimistic concurrency',
      },
      {
        displayName: 'Search',
        name: 'search',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Full-text search across fields declared searchable by LifeSpace. Leave empty to disable search.',
      },
      {
        displayName: 'Filters',
        name: 'filters',
        type: 'fixedCollection',
        default: {},
        placeholder: 'Add Filter',
        typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        options: [
          {
            displayName: 'Filter',
            name: 'filter',
            values: [
              {
                displayName: 'Field Name or ID',
                name: 'field',
                type: 'options',
                typeOptions: { loadOptionsMethod: 'getFilterableFields' },
                options: [],
                default: '',
                required: true,
                description: 'Choose from fields declared filterable by LifeSpace',
              },
              {
                displayName: 'Operator',
                name: 'operator',
                type: 'options',
                options: [
                  { name: 'Equals', value: 'exact' },
                  { name: 'From / Greater Than or Equal', value: 'from' },
                  { name: 'To / Less Than or Equal', value: 'to' },
                ],
                default: 'exact',
                description: 'Range operators are supported only for date, datetime, integer and number fields',
              },
              {
                displayName: 'Value',
                name: 'value',
                type: 'string',
                default: '',
                required: true,
                description: 'For enum equality filters, comma-separated values select any listed value. Relation fields use LifeSpace IDs.',
              },
            ],
          },
        ],
      },
      {
        displayName: 'Return All',
        name: 'returnAll',
        type: 'boolean',
        default: false,
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Whether to automatically follow LifeSpace nextCursor values until all matching records are returned',
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 200, numberPrecision: 0 },
        default: 50,
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'], returnAll: [false] } },
        description: 'Max number of results to return',
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        options: [
          {
            displayName: 'Sort Field Name or ID',
            name: 'sortField',
            type: 'options',
            typeOptions: { loadOptionsMethod: 'getSortableFields' },
            options: [],
            default: '',
            description: 'Optional. Leave unset to use the deterministic default ordering provided by LifeSpace.',
          },
          {
            displayName: 'Sort Direction',
            name: 'sortDirection',
            type: 'options',
            options: [
              { name: 'Ascending', value: 'asc' },
              { name: 'Descending', value: 'desc' },
            ],
            default: 'desc',
          },
          {
            displayName: 'Cursor',
            name: 'cursor',
            type: 'string',
            default: '',
            description: 'Advanced manual pagination. Normally leave empty and use Return All or Limit.',
          },
        ],
      },
      {
        displayName: 'Action Name or ID',
        name: 'actionKey',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'getActions',
        },
        options: [],
        default: '',
        required: true,
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['executeAction'],
          },
        },
        description: 'Choose an action published by the selected Record Type',
      },
      {
        displayName: 'Action Input',
        name: 'actionInput',
        type: 'resourceMapper',
        default: {
          mappingMode: 'defineBelow',
          value: null,
        },
        noDataExpression: true,
        required: true,
        typeOptions: {
          loadOptionsDependsOn: ['spaceId', 'modelRoute', 'actionKey'],
          resourceMapper: {
            resourceMapperMethod: 'getActionInputFields',
            mode: 'add',
            fieldWords: {
              singular: 'input',
              plural: 'inputs',
            },
            addAllFields: true,
            supportAutoMap: false,
            noFieldsError: 'The selected LifeSpace action does not accept input fields.',
          },
        },
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['executeAction'],
          },
        },
        description: 'Inputs are loaded from LifeSpace Runtime Discovery. Current concurrency metadata may still appear here until the upstream Action contract is refined.',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['apiRequest'] } },
        options: [
          {
            name: 'API Request',
            value: 'apiRequest',
            action: 'Make an API request',
            description: 'Call a path relative to the configured LifeSpace API Base URL',
          },
        ],
        default: 'apiRequest',
      },
      {
        displayName: 'Method',
        name: 'method',
        type: 'options',
        displayOptions: { show: { resource: ['apiRequest'] } },
        options: [
          { name: 'DELETE', value: 'DELETE' },
          { name: 'GET', value: 'GET' },
          { name: 'PATCH', value: 'PATCH' },
          { name: 'POST', value: 'POST' },
          { name: 'PUT', value: 'PUT' },
        ],
        default: 'GET',
      },
      {
        displayName: 'Path',
        name: 'path',
        type: 'string',
        default: '/',
        required: true,
        displayOptions: { show: { resource: ['apiRequest'] } },
        description: 'Path relative to the configured LifeSpace API Base URL, for example /me/_discovery',
      },
      {
        displayName: 'JSON Body',
        name: 'jsonBody',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            resource: ['apiRequest'],
            method: ['POST', 'PATCH', 'PUT', 'DELETE'],
          },
        },
      },
    ],
  };

  methods = {
    loadOptions: {
      async getSpaces(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const discovery = await loadRuntimeDiscovery.call(this);
        return discovery.data.spaces.map((space) => ({
          name: space.spaceId,
          value: space.spaceId,
          description: `${space.models.length} available Record Type${space.models.length === 1 ? '' : 's'}`,
        }));
      },
      async getRecordTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();
        if (!spaceId) return [];
        const discovery = await loadRuntimeDiscovery.call(this);
        const space = discoverySpace(discovery, spaceId);
        if (!space) return [];
        const operation = String(this.getNodeParameter('operation', 'list'));

        return space.models
          .filter((model) => operation === 'executeAction'
            ? model.actions.length > 0
            : model.access.includes(requiredAccessForOperation(operation)))
          .map((model) => ({
            name: `${model.display.plural} (${model.route})`,
            value: model.route,
            description: model.description ?? undefined,
          }));
      },
      async getActions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        if (!spaceId || !modelRoute) return [];

        const discovery = await loadRuntimeDiscovery.call(this);
        const model = discoveryModel(discovery, spaceId, modelRoute);
        if (!model) return [];

        return model.actions.map((action) => ({
          name: humanizeKey(action.key),
          value: action.key,
          description: `${action.kind} action · ${action.access} access`,
        }));
      },
      async getFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        if (!spaceId || !modelRoute) return [];
        const discovery = await loadRuntimeDiscovery.call(this);
        const model = discoveryModel(discovery, spaceId, modelRoute);
        if (!model) return [];
        return model.query.filterable.map((fieldKey) => {
          const field = model.fields.find((entry) => entry.key === fieldKey);
          const rangeSupported = field && ['date', 'datetime', 'integer', 'number'].includes(field.type);
          return {
            name: humanizeKey(fieldKey),
            value: fieldKey,
            description: rangeSupported ? `${field?.type ?? 'field'} · equality and range filters` : `${field?.type ?? 'field'} · equality filter`,
          };
        });
      },
      async getSortableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        if (!spaceId || !modelRoute) return [];
        const discovery = await loadRuntimeDiscovery.call(this);
        const model = discoveryModel(discovery, spaceId, modelRoute);
        if (!model) return [];
        return [
          { name: 'Created At', value: 'createdAt' },
          { name: 'Updated At', value: 'updatedAt' },
          ...model.query.sortable.map((fieldKey) => ({ name: humanizeKey(fieldKey), value: fieldKey })),
        ];
      },
    },
    resourceMapping: {
      async getRecordFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        if (!spaceId || !modelRoute) return { fields: [] };

        const operation = String(this.getNodeParameter('operation', 'create'));
        const discovery = await loadRuntimeDiscovery.call(this);
        const model = discoveryModel(discovery, spaceId, modelRoute);
        if (!model) return { fields: [] };

        const fields = model.fields
          .filter((field) => !field.readOnly && (operation !== 'update' || !field.immutable))
          // Required/default semantics remain controlled by LifeSpace Discovery. This
          // intentionally does not invent adapter-side defaults while upstream #99 converges.
          .map((field) => mapperField(field, operation === 'create' && field.required === true));

        return { fields };
      },
      async getActionInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        const actionKey = String(this.getNodeParameter('actionKey', '')).trim();
        if (!spaceId || !modelRoute || !actionKey) return { fields: [] };

        const discovery = await loadRuntimeDiscovery.call(this);
        const model = discoveryModel(discovery, spaceId, modelRoute);
        const action = model?.actions.find((entry) => entry.key === actionKey);
        if (!action) return { fields: [] };

        return {
          fields: action.input.fields.map((field) => mapperField(field, field.required === true)),
        };
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];
    const credentials = await this.getCredentials('lifeSpaceApi');
    const baseUrl = normalizeBaseUrl(credentials.baseUrl);

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const resource = this.getNodeParameter('resource', itemIndex) as string;
        let response: unknown;

        if (resource === 'modelRecord') {
          const operation = this.getNodeParameter('operation', itemIndex) as string;
          const spaceId = encodeURIComponent(String(this.getNodeParameter('spaceId', itemIndex)));
          const modelRoute = encodeURIComponent(String(this.getNodeParameter('modelRoute', itemIndex)));
          const collectionPath = `/spaces/${spaceId}/${modelRoute}`;

          if (operation === 'list') {
            const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
            if (!returnAll) {
              const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
              response = await this.helpers.httpRequestWithAuthentication.call(
                this,
                'lifeSpaceApi',
                {
                  method: 'GET',
                  url: `${baseUrl}${collectionPath}`,
                  qs: queryParameters(this, itemIndex, limit),
                  json: true,
                },
              );
            } else {
              const allItems: IDataObject[] = [];
              const seenCursors = new Set<string>();
              let cursor: string | undefined;

              do {
                const pageResponse = await this.helpers.httpRequestWithAuthentication.call(
                  this,
                  'lifeSpaceApi',
                  {
                    method: 'GET',
                    url: `${baseUrl}${collectionPath}`,
                    qs: queryParameters(this, itemIndex, 200, cursor),
                    json: true,
                  },
                );
                const page = queryPage(this, itemIndex, pageResponse);
                allItems.push(...page.items);
                if (!page.nextCursor) {
                  cursor = undefined;
                  break;
                }
                if (seenCursors.has(page.nextCursor)) {
                  throw new NodeOperationError(this.getNode(), 'LifeSpace returned the same nextCursor more than once', { itemIndex });
                }
                seenCursors.add(page.nextCursor);
                cursor = page.nextCursor;
              } while (cursor);

              response = { data: { items: allItems, nextCursor: null } };
            }
          } else if (operation === 'create') {
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'lifeSpaceApi',
              {
                method: 'POST',
                url: `${baseUrl}${collectionPath}`,
                body: mappedValue(this, itemIndex, 'fields'),
                json: true,
              },
            );
          } else {
            const recordId = encodeURIComponent(String(this.getNodeParameter('recordId', itemIndex)));
            const recordPath = `${collectionPath}/${recordId}`;
            let options: IHttpRequestOptions;

            if (operation === 'get') {
              options = { method: 'GET', url: `${baseUrl}${recordPath}`, json: true };
            } else if (operation === 'update') {
              options = {
                method: 'PATCH',
                url: `${baseUrl}${recordPath}`,
                body: { ...mappedValue(this, itemIndex, 'fields'), version: this.getNodeParameter('version', itemIndex) },
                json: true,
              };
            } else if (operation === 'delete') {
              options = {
                method: 'DELETE',
                url: `${baseUrl}${recordPath}`,
                body: { version: this.getNodeParameter('version', itemIndex) },
                json: true,
              };
            } else {
              const actionKey = encodeURIComponent(String(this.getNodeParameter('actionKey', itemIndex)));
              options = {
                method: 'POST',
                url: `${baseUrl}${recordPath}/actions/${actionKey}`,
                body: mappedValue(this, itemIndex, 'actionInput'),
                json: true,
              };
            }

            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'lifeSpaceApi',
              options,
            );
          }
        } else {
          const method = this.getNodeParameter('method', itemIndex) as IHttpRequestOptions['method'];
          const path = String(this.getNodeParameter('path', itemIndex));
          const options: IHttpRequestOptions = {
            method,
            url: `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
            json: true,
          };

          if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(String(method))) {
            options.body = parseJsonObject(
              this,
              itemIndex,
              this.getNodeParameter('jsonBody', itemIndex, '{}'),
              'JSON Body',
            );
          }

          response = await this.helpers.httpRequestWithAuthentication.call(
            this,
            'lifeSpaceApi',
            options,
          );
        }

        const json = typeof response === 'object' && response !== null
          ? response as IDataObject
          : response === undefined || response === null
            ? { success: true }
            : { data: response };

        output.push({ json, pairedItem: { item: itemIndex } });
      } catch (error) {
        if (this.continueOnFail()) {
          output.push({
            json: { error: error instanceof Error ? error.message : String(error) },
            pairedItem: { item: itemIndex },
          });
          continue;
        }

        throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
      }
    }

    return [output];
  }
}
