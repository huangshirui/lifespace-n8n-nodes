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
  JsonObject,
  ResourceMapperFields,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type DiscoveryAccess = 'read' | 'write' | 'manage';
type DiscoveryField = {
  key: string;
  type: 'string' | 'text' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'timezone' | 'enum' | 'person' | 'person_list' | 'record' | 'record_list';
  description?: string;
  required?: boolean;
  nullable?: boolean;
  immutable?: boolean;
  readOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  values?: string[];
  targetModel?: string;
};
type DiscoveryAction = {
  key: string;
  access: DiscoveryAccess;
  kind: 'workflow' | 'capability';
  input: { fields: DiscoveryField[] };
};
type DiscoveryQuery = {
  searchable: string[];
  filterable: string[];
  sortable: string[];
};
type DiscoveryModel = {
  key: string;
  route: string;
  version: number;
  schemaHash: string;
  display: { singular: string; plural: string };
  description: string | null;
  access: DiscoveryAccess[];
  fields: DiscoveryField[];
  query: DiscoveryQuery;
  actions: DiscoveryAction[];
};
type DiscoveryResponse = {
  data: {
    spaceId: string;
    models: DiscoveryModel[];
  };
};
type QueryFilter = {
  field?: string;
  operator?: 'exact' | 'from' | 'to';
  value?: string;
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

function queryParameters(context: IExecuteFunctions, itemIndex: number): IDataObject {
  const qs: IDataObject = {};
  const search = String(context.getNodeParameter('search', itemIndex, '')).trim();
  const sortField = String(context.getNodeParameter('sortField', itemIndex, 'createdAt')).trim();
  const sortDirection = String(context.getNodeParameter('sortDirection', itemIndex, 'desc')).trim();
  const cursor = String(context.getNodeParameter('cursor', itemIndex, '')).trim();
  const limit = context.getNodeParameter('limit', itemIndex, 50) as number;
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

async function loadDiscovery(this: ILoadOptionsFunctions): Promise<DiscoveryResponse> {
  const credentials = await this.getCredentials('lifeSpaceApi');
  const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');
  const options: IHttpRequestOptions = {
    method: 'GET',
    url: `${baseUrl}/_discovery`,
    json: true,
  };

  try {
    return await this.helpers.httpRequestWithAuthentication.call(
      this,
      'lifeSpaceApi',
      options,
    ) as DiscoveryResponse;
  } catch (error) {
    throw new NodeApiError(this.getNode(), error as JsonObject);
  }
}

function selectedModel(discovery: DiscoveryResponse, route: string): DiscoveryModel | undefined {
  return discovery.data.models.find((entry) => entry.route === route);
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
    displayName: field.key,
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
    subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
    description: 'Use LifeSpace in n8n workflows',
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
            name: 'Model Record',
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
            action: 'Create a model record',
            description: 'Create a record through the LifeSpace Generic Runtime',
          },
          {
            name: 'Delete',
            value: 'delete',
            action: 'Delete a model record',
            description: 'Delete a record using optimistic concurrency',
          },
          {
            name: 'Execute Action',
            value: 'executeAction',
            action: 'Execute a model action',
            description: 'Execute a published Capability or workflow action on a record',
          },
          {
            name: 'Get',
            value: 'get',
            action: 'Get a model record',
            description: 'Get one model record by ID',
          },
          {
            name: 'List / Query',
            value: 'list',
            action: 'List or query model records',
            description: 'Query a model collection using its published query contract',
          },
          {
            name: 'Update',
            value: 'update',
            action: 'Update a model record',
            description: 'Update a record using optimistic concurrency',
          },
        ],
        default: 'list',
      },
      {
        displayName: 'Model Name or ID',
        name: 'modelRoute',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'getModels',
        },
        options: [],
        default: '',
        required: true,
        displayOptions: { show: { resource: ['modelRecord'] } },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
          loadOptionsDependsOn: ['modelRoute', 'operation'],
          resourceMapper: {
            resourceMapperMethod: 'getModelFields',
            mode: 'add',
            fieldWords: {
              singular: 'field',
              plural: 'fields',
            },
            addAllFields: true,
            supportAutoMap: false,
            noFieldsError: 'The selected LifeSpace model has no writable fields for this operation.',
          },
        },
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['create', 'update'],
          },
        },
        description: 'Writable fields loaded from the selected model through LifeSpace Runtime Discovery',
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
        description: 'Current record version used for optimistic concurrency',
      },
      {
        displayName: 'Search',
        name: 'search',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Full-text search across the selected model fields declared searchable by LifeSpace. Leave empty to disable search.',
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
                description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
                description: 'Range operators are supported by LifeSpace only for date, datetime, integer and number fields',
              },
              {
                displayName: 'Value',
                name: 'value',
                type: 'string',
                default: '',
                required: true,
                description: 'For enum equality filters, comma-separated values select any of the listed values. Relation fields use LifeSpace IDs.',
              },
            ],
          },
        ],
      },
      {
        displayName: 'Sort Field Name or ID',
        name: 'sortField',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getSortableFields' },
        options: [],
        default: 'createdAt',
        required: true,
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 200, numberPrecision: 0 },
        default: 50,
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Max number of results to return',
      },
      {
        displayName: 'Cursor',
        name: 'cursor',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Opaque nextCursor returned by a previous query. Leave empty for the first page.',
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
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
          loadOptionsDependsOn: ['modelRoute', 'actionKey'],
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
        description: 'Action input loaded from LifeSpace Runtime Discovery and validated again by Core at execution time',
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
            description: 'Call a path relative to the configured LifeSpace Connection Base URL',
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
        description: 'Path relative to the configured LifeSpace Connection Base URL',
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
      async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const discovery = await loadDiscovery.call(this);
        const operation = String(this.getNodeParameter('operation', 'list'));

        return discovery.data.models
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
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        if (!modelRoute) return [];

        const discovery = await loadDiscovery.call(this);
        const model = selectedModel(discovery, modelRoute);
        if (!model) return [];

        return model.actions.map((action) => ({
          name: action.key,
          value: action.key,
          description: `${action.kind} action · ${action.access} access`,
        }));
      },
      async getFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        if (!modelRoute) return [];
        const discovery = await loadDiscovery.call(this);
        const model = selectedModel(discovery, modelRoute);
        if (!model) return [];
        return model.query.filterable.map((fieldKey) => {
          const field = model.fields.find((entry) => entry.key === fieldKey);
          const rangeSupported = field && ['date', 'datetime', 'integer', 'number'].includes(field.type);
          return {
            name: fieldKey,
            value: fieldKey,
            description: rangeSupported ? `${field?.type ?? 'field'} · equality and range filters` : `${field?.type ?? 'field'} · equality filter`,
          };
        });
      },
      async getSortableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        if (!modelRoute) return [];
        const discovery = await loadDiscovery.call(this);
        const model = selectedModel(discovery, modelRoute);
        if (!model) return [];
        return [
          { name: 'Created At', value: 'createdAt' },
          { name: 'Updated At', value: 'updatedAt' },
          ...model.query.sortable.map((fieldKey) => ({ name: fieldKey, value: fieldKey })),
        ];
      },
    },
    resourceMapping: {
      async getModelFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        if (!modelRoute) return { fields: [] };

        const operation = String(this.getNodeParameter('operation', 'create'));
        const discovery = await loadDiscovery.call(this);
        const model = selectedModel(discovery, modelRoute);
        if (!model) return { fields: [] };

        const fields = model.fields
          .filter((field) => !field.readOnly && (operation !== 'update' || !field.immutable))
          .map((field) => mapperField(field, operation === 'create' && field.required === true));

        return { fields };
      },
      async getActionInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        const actionKey = String(this.getNodeParameter('actionKey', '')).trim();
        if (!modelRoute || !actionKey) return { fields: [] };

        const discovery = await loadDiscovery.call(this);
        const model = selectedModel(discovery, modelRoute);
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
    const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const resource = this.getNodeParameter('resource', itemIndex) as string;
        let options: IHttpRequestOptions;

        if (resource === 'modelRecord') {
          const operation = this.getNodeParameter('operation', itemIndex) as string;
          const modelRoute = encodeURIComponent(String(this.getNodeParameter('modelRoute', itemIndex)));
          const collectionPath = `/${modelRoute}`;

          if (operation === 'list') {
            options = {
              method: 'GET',
              url: `${baseUrl}${collectionPath}`,
              qs: queryParameters(this, itemIndex),
              json: true,
            };
          } else if (operation === 'create') {
            options = {
              method: 'POST',
              url: `${baseUrl}${collectionPath}`,
              body: mappedValue(this, itemIndex, 'fields'),
              json: true,
            };
          } else {
            const recordId = encodeURIComponent(String(this.getNodeParameter('recordId', itemIndex)));
            const recordPath = `${collectionPath}/${recordId}`;

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
          }
        } else {
          const method = this.getNodeParameter('method', itemIndex) as IHttpRequestOptions['method'];
          const path = String(this.getNodeParameter('path', itemIndex));
          options = {
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
        }

        const response = await this.helpers.httpRequestWithAuthentication.call(
          this,
          'lifeSpaceApi',
          options,
        );

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
