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
  loadRelationTargets,
  loadRuntimeDiscovery,
  normalizeBaseUrl,
  type DiscoveryAccess,
  type DiscoveryAction,
  type DiscoveryField,
  type DiscoveryModel,
  type RelationTarget,
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

function dateOnlyValue(context: IExecuteFunctions, itemIndex: number, value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/u.exec(raw);
  if (!match) {
    throw new NodeOperationError(context.getNode(), `${fieldName} must be a calendar date`, { itemIndex });
  }
  return match[1];
}

function mergeMappedValues(
  context: IExecuteFunctions,
  itemIndex: number,
  ...values: IDataObject[]
): IDataObject {
  const result: IDataObject = {};
  for (const value of values) {
    for (const [key, entry] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        throw new NodeOperationError(context.getNode(), `Field ${key} is configured more than once`, { itemIndex });
      }
      result[key] = entry;
    }
  }
  return result;
}

function dateMappedValues(context: IExecuteFunctions, itemIndex: number): IDataObject {
  const rows = context.getNodeParameter('dateFields.date', itemIndex, []) as Array<{ field?: unknown; value?: unknown }>;
  const result: IDataObject = {};
  for (const row of rows) {
    const field = String(row.field ?? '').trim();
    if (!field) continue;
    if (Object.prototype.hasOwnProperty.call(result, field)) {
      throw new NodeOperationError(context.getNode(), `Date field ${field} is configured more than once`, { itemIndex });
    }
    result[field] = dateOnlyValue(context, itemIndex, row.value, field);
  }
  return result;
}

function relationMappedValues(context: IExecuteFunctions, itemIndex: number): IDataObject {
  const singles = context.getNodeParameter('singleRelations.relation', itemIndex, []) as Array<{ field?: unknown; target?: unknown }>;
  const multiples = context.getNodeParameter('multiRelations.relation', itemIndex, []) as Array<{ field?: unknown; targets?: unknown }>;
  const result: IDataObject = {};
  for (const row of singles) {
    const field = String(row.field ?? '').trim();
    if (!field) continue;
    if (Object.prototype.hasOwnProperty.call(result, field)) {
      throw new NodeOperationError(context.getNode(), `Relation field ${field} is configured more than once`, { itemIndex });
    }
    const target = row.target === null || row.target === undefined ? '' : String(row.target).trim();
    result[field] = target || null;
  }
  for (const row of multiples) {
    const field = String(row.field ?? '').trim();
    if (!field) continue;
    if (Object.prototype.hasOwnProperty.call(result, field)) {
      throw new NodeOperationError(context.getNode(), `Relation field ${field} is configured more than once`, { itemIndex });
    }
    const raw = row.targets;
    const targets = Array.isArray(raw)
      ? raw.map((value) => String(value).trim()).filter(Boolean)
      : raw === null || raw === undefined || raw === ''
        ? []
        : [String(raw).trim()].filter(Boolean);
    result[field] = targets;
  }
  return result;
}

function mutationMappedValues(context: IExecuteFunctions, itemIndex: number): IDataObject {
  return mergeMappedValues(
    context,
    itemIndex,
    mappedValue(context, itemIndex, 'fields'),
    dateMappedValues(context, itemIndex),
    relationMappedValues(context, itemIndex),
  );
}

function normalizeActionInput(
  context: IExecuteFunctions,
  itemIndex: number,
  value: IDataObject,
  fields: DiscoveryField[],
): IDataObject {
  const result = { ...value };
  for (const field of fields) {
    if (field.type === 'date' && Object.prototype.hasOwnProperty.call(result, field.key)) {
      result[field.key] = dateOnlyValue(context, itemIndex, result[field.key], field.key);
    }
  }
  return result;
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
  const setFilter = (field: string, operator: 'exact' | 'from' | 'to', value: string | number | boolean) => {
    const key = operator === 'from' ? `${field}From` : operator === 'to' ? `${field}To` : field;
    if (usedKeys.has(key)) {
      throw new NodeOperationError(context.getNode(), `Query filter ${key} may be supplied only once`, { itemIndex });
    }
    usedKeys.add(key);
    qs[key] = typeof value === 'boolean' ? String(value) : value;
  };

  for (const filter of filters) {
    const field = String(filter.field ?? '').trim();
    const value = String(filter.value ?? '');
    const operator = filter.operator ?? 'exact';
    if (field && value !== '') setFilter(field, operator, value);
  }

  const typedFilters = context.getNodeParameter('filters', itemIndex, {}) as IDataObject;
  for (const row of (typedFilters.text ?? []) as Array<{ field?: unknown; value?: unknown }>) {
    const field = String(row.field ?? '').trim();
    if (field && row.value !== undefined && row.value !== '') setFilter(field, 'exact', String(row.value));
  }
  for (const row of (typedFilters.enum ?? []) as Array<{ field?: unknown; values?: unknown }>) {
    const field = String(row.field ?? '').trim();
    const values = Array.isArray(row.values) ? row.values.map(String).filter(Boolean) : [];
    if (field && values.length) setFilter(field, 'exact', values.join(','));
  }
  for (const row of (typedFilters.boolean ?? []) as Array<{ field?: unknown; value?: unknown }>) {
    const field = String(row.field ?? '').trim();
    if (field) setFilter(field, 'exact', Boolean(row.value));
  }
  for (const row of (typedFilters.number ?? []) as Array<{ field?: unknown; operator?: 'exact' | 'from' | 'to'; value?: unknown }>) {
    const field = String(row.field ?? '').trim();
    const value = Number(row.value);
    if (field && Number.isFinite(value)) setFilter(field, row.operator ?? 'exact', value);
  }
  for (const row of (typedFilters.temporal ?? []) as Array<{ field?: unknown; operator?: 'exact' | 'from' | 'to'; value?: unknown }>) {
    const encoded = String(row.field ?? '').trim();
    if (!encoded || row.value === undefined || row.value === '') continue;
    const separator = encoded.indexOf(':');
    const fieldType = separator > 0 ? encoded.slice(0, separator) : 'datetime';
    const field = separator > 0 ? encoded.slice(separator + 1) : encoded;
    const raw = String(row.value);
    const value = fieldType === 'date' ? dateOnlyValue(context, itemIndex, raw, field) : raw;
    if (value !== null) setFilter(field, row.operator ?? 'exact', value);
  }
  for (const row of (typedFilters.person ?? []) as Array<{ field?: unknown; target?: unknown }>) {
    const field = String(row.field ?? '').trim();
    const target = String(row.target ?? '').trim();
    if (field && target) setFilter(field, 'exact', target);
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
    case 'date':
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

function mapperField(field: DiscoveryField, required: boolean, relationTargets?: RelationTarget[]) {
  const relationOptions = relationTargets?.map((target) => ({ name: target.label, value: target.id }));
  return {
    id: field.key,
    displayName: field.title?.trim() || humanizeKey(field.key),
    required,
    defaultMatch: false,
    canBeUsedToMatch: false,
    display: true,
    type: relationTargets !== undefined && field.type === 'person' ? 'options' : resourceMapperType(field),
    options: relationTargets !== undefined
      ? relationOptions
      : field.type === 'enum'
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

  const normalizedInput = normalizeActionInput(context, itemIndex, semanticInput, action.input.fields);
  const concurrency = action.concurrency;
  if (!concurrency || !concurrency.required) return normalizedInput;

  if (concurrency.strategy !== 'record-version' || concurrency.transport.in !== 'body' || !concurrency.transport.name) {
    throw new NodeOperationError(
      context.getNode(),
      `LifeSpace Action ${action.key} uses an unsupported concurrency contract`,
      { itemIndex },
    );
  }

  return {
    ...normalizedInput,
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

async function optionModel(context: ILoadOptionsFunctions): Promise<{ model: DiscoveryModel; spaceId: string } | null> {
  const spaceId = String(context.getNodeParameter('spaceId', '')).trim();
  const modelRoute = String(context.getNodeParameter('modelRoute', '')).trim();
  if (!spaceId || !modelRoute) return null;
  const discovery = await loadRuntimeDiscovery.call(context);
  const model = discoveryModel(discovery, spaceId, modelRoute);
  return model ? { model, spaceId } : null;
}

async function filterFieldOptions(
  context: ILoadOptionsFunctions,
  types: DiscoveryField['type'][],
  encodeType = false,
): Promise<INodePropertyOptions[]> {
  const selected = await optionModel(context);
  if (!selected) return [];
  const allowed = new Set(selected.model.query.filterable);
  return selected.model.fields
    .filter((field) => allowed.has(field.key) && types.includes(field.type))
    .map((field) => ({
      name: field.title?.trim() || humanizeKey(field.key),
      value: encodeType ? `${field.type}:${field.key}` : field.key,
      description: field.description,
    }));
}

async function relationFieldOptions(
  context: ILoadOptionsFunctions,
  cardinality?: 'one' | 'many',
  filterableOnly = false,
): Promise<INodePropertyOptions[]> {
  const selected = await optionModel(context);
  if (!selected) return [];
  const operation = String(context.getNodeParameter('operation', 'create'));
  const filterable = new Set(selected.model.query.filterable);
  return selected.model.fields
    .filter((field) => field.relation?.lookup.supported === true)
    .filter((field) => cardinality === undefined || field.relation?.cardinality === cardinality)
    .filter((field) => !filterableOnly || filterable.has(field.key))
    .filter((field) => filterableOnly || (!field.readOnly && (operation !== 'update' || !field.immutable)))
    .map((field) => ({ name: field.title?.trim() || humanizeKey(field.key), value: field.key, description: field.description }));
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
        displayName: 'Date Fields',
        name: 'dateFields',
        type: 'fixedCollection',
        default: {},
        placeholder: 'Add Date Field',
        typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },
        options: [
          {
            displayName: 'Date',
            name: 'date',
            values: [
              {
                displayName: 'Field Name or ID',
                name: 'field',
                type: 'options',
                typeOptions: {
                  loadOptionsMethod: 'getWritableDateFields',
                  loadOptionsDependsOn: ['spaceId', 'modelRoute', 'operation'],
                },
                options: [],
                default: '',
                required: true,
                description: 'Choose a LifeSpace date field. The node submits calendar-date YYYY-MM-DD values. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
              },
              {
                displayName: 'Date',
                name: 'value',
                type: 'dateTime',
                default: '',
                description: 'Calendar date. Expressions remain supported; empty values clear nullable fields.',
              },
            ],
          },
        ],
      },
      {
        displayName: 'Single Relations',
        name: 'singleRelations',
        type: 'fixedCollection',
        default: {},
        placeholder: 'Add Single Relation',
        typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },
        options: [
          {
            displayName: 'Relation',
            name: 'relation',
            values: [
              {
                displayName: 'Field Name or ID',
                name: 'field',
                type: 'options',
																description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                typeOptions: {
                  loadOptionsMethod: 'getSingleRelationFields',
                  loadOptionsDependsOn: ['spaceId', 'modelRoute', 'operation'],
                },
                options: [],
                default: '',
                required: true,
              },
              {
                displayName: 'Target Name or ID',
                name: 'target',
                type: 'options',
                typeOptions: {
                  loadOptionsMethod: 'getRelationTargetsForCurrentField',
                  loadOptionsDependsOn: ['spaceId', 'modelRoute', '&field'],
                },
                options: [],
                default: '',
                description: 'Choose an authorized relation target, or use an expression with a stable LifeSpace ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
              },
            ],
          },
        ],
      },
      {
        displayName: 'Multi Relations',
        name: 'multiRelations',
        type: 'fixedCollection',
        default: {},
        placeholder: 'Add Multi Relation',
        typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },
        options: [
          {
            displayName: 'Relation',
            name: 'relation',
            values: [
              {
                displayName: 'Field Name or ID',
                name: 'field',
                type: 'options',
																description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                typeOptions: {
                  loadOptionsMethod: 'getMultiRelationFields',
                  loadOptionsDependsOn: ['spaceId', 'modelRoute', 'operation'],
                },
                options: [],
                default: '',
                required: true,
              },
              {
                displayName: 'Targets Names or IDs',
                name: 'targets',
                type: 'multiOptions',
                typeOptions: {
                  loadOptionsMethod: 'getRelationTargetsForCurrentField',
                  loadOptionsDependsOn: ['spaceId', 'modelRoute', '&field'],
                },
                options: [],
                default: [],
                description: 'Choose authorized relation targets, or use an expression with stable LifeSpace IDs. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
              },
            ],
          },
        ],
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
            displayName: 'Text Filter',
            name: 'text',
            values: [
              { displayName: 'Field Name or ID', name: 'field', type: 'options',
																																																																description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getTextFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },
              { displayName: 'Value', name: 'value', type: 'string', default: '', required: true },
            ],
          },
          {
            displayName: 'Enum Filter',
            name: 'enum',
            values: [
              { displayName: 'Field Name or ID', name: 'field', type: 'options',
																																																																description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getEnumFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },
              { displayName: 'Value Names or IDs', name: 'values', type: 'multiOptions',
																																																							description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getEnumValuesForCurrentFilter', loadOptionsDependsOn: ['spaceId', 'modelRoute', '&field'] }, options: [], default: [], required: true },
            ],
          },
          {
            displayName: 'Boolean Filter',
            name: 'boolean',
            values: [
              { displayName: 'Field Name or ID', name: 'field', type: 'options',
																																																																description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getBooleanFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },
              { displayName: 'Value', name: 'value', type: 'boolean', default: true },
            ],
          },
          {
            displayName: 'Number Filter',
            name: 'number',
            values: [
              { displayName: 'Field Name or ID', name: 'field', type: 'options',
																																																																description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getNumericFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },
              { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },
              { displayName: 'Value', name: 'value', type: 'number', default: 0, required: true },
            ],
          },
          {
            displayName: 'Date / Time Filter',
            name: 'temporal',
            values: [
              { displayName: 'Field Name or ID', name: 'field', type: 'options',
																																																																description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getTemporalFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },
              { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },
              { displayName: 'Value', name: 'value', type: 'dateTime', default: '', required: true },
            ],
          },
          {
            displayName: 'Person Filter',
            name: 'person',
            values: [
              { displayName: 'Field Name or ID', name: 'field', type: 'options',
																																																																description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getPersonFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },
              { displayName: 'Person Name or ID', name: 'target', type: 'options',
																																																																		description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getRelationTargetsForCurrentField', loadOptionsDependsOn: ['spaceId', 'modelRoute', '&field'] }, options: [], default: '', required: true },
            ],
          },
          {
            displayName: 'Raw / Legacy Filter',
            name: 'filter',
            values: [
              { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getFilterableFields' }, options: [], default: '', required: true, description: 'Compatibility and unsupported relation escape hatch. Prefer the typed filter variants above. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
              { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },
              { displayName: 'Value', name: 'value', type: 'string', default: '', required: true },
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
          loadOptionsDependsOn: ['spaceId', 'modelRoute'],
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
          name: space.spaceName?.trim() || space.spaceId,
          value: space.spaceId,
          description: `${space.spaceId} · ${space.models.length} available Record Type${space.models.length === 1 ? '' : 's'}`,
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
      async getWritableDateFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        if (!spaceId || !modelRoute) return [];
        const operation = String(this.getNodeParameter('operation', 'create'));
        const discovery = await loadRuntimeDiscovery.call(this);
        const model = discoveryModel(discovery, spaceId, modelRoute);
        if (!model) return [];
        return model.fields
          .filter((field) => field.type === 'date' && !field.readOnly && (operation !== 'update' || !field.immutable))
          .map((field) => ({ name: field.title?.trim() || humanizeKey(field.key), value: field.key, description: field.description }));
      },
      async getSingleRelationFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return relationFieldOptions(this, 'one', false);
      },
      async getMultiRelationFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return relationFieldOptions(this, 'many', false);
      },
      async getRelationTargetsForCurrentField(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        const fieldKey = String(this.getCurrentNodeParameter('&field') ?? '').trim();
        if (!spaceId || !modelRoute || !fieldKey) return [];
        const discovery = await loadRuntimeDiscovery.call(this);
        const model = discoveryModel(discovery, spaceId, modelRoute);
        const field = model?.fields.find((entry) => entry.key === fieldKey);
        if (!model || !field) return [];
        const targets = await loadRelationTargets(this, spaceId, model.key, field);
        return (targets ?? []).map((target) => ({ name: target.label, value: target.id }));
      },
      async getTextFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return filterFieldOptions(this, ['string', 'text', 'timezone']);
      },
      async getEnumFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return filterFieldOptions(this, ['enum']);
      },
      async getBooleanFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return filterFieldOptions(this, ['boolean']);
      },
      async getNumericFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return filterFieldOptions(this, ['integer', 'number']);
      },
      async getTemporalFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return filterFieldOptions(this, ['date', 'datetime'], true);
      },
      async getPersonFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return relationFieldOptions(this, undefined, true);
      },
      async getEnumValuesForCurrentFilter(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        const fieldKey = String(this.getCurrentNodeParameter('&field') ?? '').trim();
        if (!spaceId || !modelRoute || !fieldKey) return [];
        const discovery = await loadRuntimeDiscovery.call(this);
        const field = discoveryModel(discovery, spaceId, modelRoute)?.fields.find((entry) => entry.key === fieldKey);
        return field?.type === 'enum' ? (field.values ?? []).map((value) => ({ name: value, value })) : [];
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

        const writableFields = model.fields
          .filter((field) => !field.readOnly && (operation !== 'update' || !field.immutable))
          .filter((field) => field.type !== 'date')
          .filter((field) => field.relation?.lookup.supported !== true);
        const fields = writableFields.map((field) => mapperField(
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
                body: mutationMappedValues(this, itemIndex),
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
                  ...mutationMappedValues(this, itemIndex),
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
