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
  loadExecutionRuntimeDiscovery,
  loadRuntimeDiscovery,
  normalizeBaseUrl,
  type DiscoveryAccess,
  type DiscoveryAction,
  type DiscoveryField,
  type DiscoveryModel,
} from '../lifespaceDiscovery';

type QueryFilter = {
  field?: string;
  operator?: 'exact' | 'from' | 'to';
  value?: string;
};

type QuerySort = {
  field?: string;
  direction?: 'asc' | 'desc';
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
  const configuredSorts = context.getNodeParameter('sorts.sort', itemIndex, []) as QuerySort[];
  const legacySortField = String(options.sortField ?? '').trim();
  const legacySortDirection = String(options.sortDirection ?? 'desc').trim();
  const configuredCursor = String(options.cursor ?? '').trim();
  const cursor = cursorOverride ?? configuredCursor;
  const filters = context.getNodeParameter('filters.filter', itemIndex, []) as QueryFilter[];

  if (search) qs.q = search;

  const orderedSorts: string[] = [];
  const usedSortFields = new Set<string>();
  for (const sort of configuredSorts) {
    const field = String(sort.field ?? '').trim();
    if (!field) continue;
    const direction = String(sort.direction ?? 'asc').trim();
    if (direction !== 'asc' && direction !== 'desc') {
      throw new NodeOperationError(context.getNode(), `Sort direction for ${field} must be asc or desc`, { itemIndex });
    }
    if (usedSortFields.has(field)) {
      throw new NodeOperationError(context.getNode(), `Sort field ${field} may be supplied only once`, { itemIndex });
    }
    usedSortFields.add(field);
    orderedSorts.push(`${field}:${direction}`);
  }

  if (orderedSorts.length === 1) qs.sort = orderedSorts[0];
  if (orderedSorts.length > 1) qs.sort = orderedSorts;
  if (orderedSorts.length === 0 && legacySortField) qs.sort = `${legacySortField}:${legacySortDirection}`;
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
      return 'string';
  }
}

function mapperField(field: DiscoveryField, required: boolean) {
  return {
    id: field.key,
    displayName: field.title?.trim() || humanizeKey(field.key),
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

function hasServerDefault(model: DiscoveryModel, fieldKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(model.defaults ?? {}, fieldKey);
}

async function currentRecordVersion(
  context: IExecuteFunctions,
  itemIndex: number,
  baseUrl: string,
  recordPath: string,
): Promise<number> {
  const response = await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceApi',
    { method: 'GET', url: `${baseUrl}${recordPath}`, json: true },
  ) as { data?: IDataObject };
  const version = response.data?.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new NodeOperationError(
      context.getNode(),
      'LifeSpace record did not expose a usable version for optimistic concurrency',
      { itemIndex },
    );
  }
  return version;
}

async function mutationVersion(
  context: IExecuteFunctions,
  itemIndex: number,
  baseUrl: string,
  recordPath: string,
): Promise<number> {
  const options = context.getNodeParameter('mutationOptions', itemIndex, {}) as IDataObject;
  const configuredVersion = options.version;
  if (typeof configuredVersion === 'number' && Number.isInteger(configuredVersion) && configuredVersion >= 1) {
    return configuredVersion;
  }
  return currentRecordVersion(context, itemIndex, baseUrl, recordPath);
}

async function actionBodyWithConcurrency(
  context: IExecuteFunctions,
  itemIndex: number,
  baseUrl: string,
  spaceId: string,
  modelRoute: string,
  recordPath: string,
  actionKey: string,
  semanticInput: IDataObject,
): Promise<IDataObject> {
  const discovery = await loadExecutionRuntimeDiscovery(context, baseUrl);
  const model = discoveryModel(discovery, spaceId, modelRoute);
  const action = model?.actions.find((entry) => entry.key === actionKey);
  if (!action) {
    throw new NodeOperationError(context.getNode(), `LifeSpace Action ${actionKey} is not available`, { itemIndex });
  }

  const concurrency = action.concurrency;
  if (!concurrency || !concurrency.required) return semanticInput;

  if (concurrency.strategy !== 'record-version' || concurrency.transport.in !== 'body' || !concurrency.transport.name) {
    throw new NodeOperationError(
      context.getNode(),
      `LifeSpace Action ${action.key} uses an unsupported concurrency contract`,
      { itemIndex },
    );
  }

  return {
    ...semanticInput,
    [concurrency.transport.name]: await currentRecordVersion(context, itemIndex, baseUrl, recordPath),
  };
}

function actionOption(action: DiscoveryAction): INodePropertyOptions {
  return {
    name: humanizeKey(action.key),
    value: action.key,
    description: `${action.kind} action · ${action.access} access`,
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
            description: 'Execute a published LifeSpace Record Action or Capability action',
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
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
        description: 'Writable fields loaded from LifeSpace Runtime Discovery. Server-defaulted required fields are not required from the n8n user.',
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
        description: 'Whether to return all results or only up to a given limit',
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
        displayName: 'Sorts',
        name: 'sorts',
        type: 'fixedCollection',
        default: {},
        placeholder: 'Add Sort',
        typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        options: [
          {
            displayName: 'Sort',
            name: 'sort',
            values: [
              {
                displayName: 'Field Name or ID',
                name: 'field',
                type: 'options',
                typeOptions: { loadOptionsMethod: 'getSortableFields' },
                options: [],
                default: '',
                required: true,
                description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
              },
              {
                displayName: 'Direction',
                name: 'direction',
                type: 'options',
                options: [
                  { name: 'Ascending', value: 'asc' },
                  { name: 'Descending', value: 'desc' },
                ],
                default: 'asc',
              },
            ],
          },
        ],
        description: 'Add sort criteria in priority order. If omitted, LifeSpace applies the server-declared default order.',
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
            displayName: 'Cursor',
            name: 'cursor',
            type: 'string',
            default: '',
            description: 'Advanced manual pagination. Normally leave empty and use Return All or Limit.',
          },
        ],
      },
      {
        displayName: 'Concurrency Options',
        name: 'mutationOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: { show: { resource: ['modelRecord'], operation: ['update', 'delete'] } },
        options: [
          {
            displayName: 'Version',
            name: 'version',
            type: 'number',
            typeOptions: { minValue: 1, numberPrecision: 0 },
            default: 1,
            description: 'Optional known record version. If omitted, the node reads the current record version immediately before the mutation.',
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
            noFieldsError: 'This LifeSpace Action has no semantic input fields.',
          },
        },
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['executeAction'],
          },
        },
        description: 'Only semantic/domain inputs from Runtime Discovery are shown. Concurrency metadata is resolved automatically.',
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

        return model.actions.map(actionOption);
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
            name: field?.title?.trim() || humanizeKey(fieldKey),
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
          ...model.query.sort.envelopeFields.map((fieldKey) => ({
            name: humanizeKey(fieldKey),
            value: fieldKey,
          })),
          ...model.query.sortable.map((fieldKey) => {
            const field = model.fields.find((entry) => entry.key === fieldKey);
            return { name: field?.title?.trim() || humanizeKey(fieldKey), value: fieldKey };
          }),
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
          .map((field) => mapperField(
            field,
            operation === 'create' && field.required === true && !hasServerDefault(model, field.key),
          ));

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
          const rawSpaceId = String(this.getNodeParameter('spaceId', itemIndex));
          const rawModelRoute = String(this.getNodeParameter('modelRoute', itemIndex));
          const spaceId = encodeURIComponent(rawSpaceId);
          const modelRoute = encodeURIComponent(rawModelRoute);
          const collectionPath = `/spaces/${spaceId}/${modelRoute}`;

          if (operation === 'list') {
            const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
            if (!returnAll) {
              const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
              const qs = queryParameters(this, itemIndex, limit);
              const requestOptions: IHttpRequestOptions = {
                method: 'GET',
                url: `${baseUrl}${collectionPath}`,
                qs,
                json: true,
              };
              if (Array.isArray(qs.sort)) requestOptions.arrayFormat = 'repeat';
              response = await this.helpers.httpRequestWithAuthentication.call(
                this,
                'lifeSpaceApi',
                requestOptions,
              );
            } else {
              const allItems: IDataObject[] = [];
              const seenCursors = new Set<string>();
              let cursor: string | undefined;

              do {
                const qs = queryParameters(this, itemIndex, 200, cursor);
                const requestOptions: IHttpRequestOptions = {
                  method: 'GET',
                  url: `${baseUrl}${collectionPath}`,
                  qs,
                  json: true,
                };
                if (Array.isArray(qs.sort)) requestOptions.arrayFormat = 'repeat';
                const pageResponse = await this.helpers.httpRequestWithAuthentication.call(
                  this,
                  'lifeSpaceApi',
                  requestOptions,
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
                body: {
                  ...mappedValue(this, itemIndex, 'fields'),
                  version: await mutationVersion(this, itemIndex, baseUrl, recordPath),
                },
                json: true,
              };
            } else if (operation === 'delete') {
              options = {
                method: 'DELETE',
                url: `${baseUrl}${recordPath}`,
                body: { version: await mutationVersion(this, itemIndex, baseUrl, recordPath) },
                json: true,
              };
            } else {
              const rawActionKey = String(this.getNodeParameter('actionKey', itemIndex));
              const actionKey = encodeURIComponent(rawActionKey);
              options = {
                method: 'POST',
                url: `${baseUrl}${recordPath}/actions/${actionKey}`,
                body: await actionBodyWithConcurrency(
                  this,
                  itemIndex,
                  baseUrl,
                  rawSpaceId,
                  rawModelRoute,
                  recordPath,
                  rawActionKey,
                  mappedValue(this, itemIndex, 'actionInput'),
                ),
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
