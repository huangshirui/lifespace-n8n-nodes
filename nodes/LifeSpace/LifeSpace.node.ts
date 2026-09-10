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
  decodeRecordTypeSelector,
  discoveryModel,
  discoverySpace,
  humanizeKey,
  loadExecutionRuntimeDiscovery,
  loadOptionParameter,
  loadRelationTargets,
  loadRuntimeDiscovery,
  normalizeBaseUrl,
  type DiscoveryAccess,
  type DiscoveryAction,
  type DiscoveryCapabilityQueryParameter,
  type DiscoveryComparison,
  type DiscoveryField,
  type DiscoveryModel,
  type RelationTarget,
} from '../lifespaceDiscovery';

type QueryFilter = {
  field?: string;
  operator?: 'exact' | 'from' | 'to';
  value?: string;
};

type QueryComparison = {
  field?: string;
  parameter?: string;
  value?: unknown;
};

type QueryLocalDateWindow = {
  field?: string;
  dateStart?: unknown;
  dateEndExclusive?: unknown;
  timezone?: unknown;
};

type QuerySort = {
  field?: string;
  direction?: 'asc' | 'desc';
};

type QueryPage = {
  items: IDataObject[];
  nextCursor: string | null;
};

const LEGACY_MODEL_ROUTE_TO_KEY: Readonly<Record<string, string>> = Object.freeze({
  tasks: 'task',
  wishes: 'wish',
  'day-records': 'day_record',
  events: 'event',
});
const LOCAL_DATE_WINDOW_SELECTOR_PREFIX = 'lsqw1.';

const COMPARISON_OPERATOR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  eq: 'Equals',
  lt: 'Less Than',
  lte: 'Less Than or Equal',
  gt: 'Greater Than',
  gte: 'Greater Than or Equal',
});

type LocalDateWindowSelector = {
  field: string;
  valueType: 'datetime';
  dateStartParameter: string;
  dateEndExclusiveParameter: string;
  timezoneParameter: string;
};

function comparisonFieldParts(value: unknown): { field: string; valueType: string } {
  const raw = String(value ?? '').trim();
  const separator = raw.indexOf(':');
  if (separator <= 0) return { field: raw, valueType: '' };
  return { valueType: raw.slice(0, separator), field: raw.slice(separator + 1) };
}

function encodeLocalDateWindowSelector(comparison: DiscoveryComparison): string {
  const window = comparison.localDateWindow;
  if (!window || comparison.valueType !== 'datetime') return '';
  return `${LOCAL_DATE_WINDOW_SELECTOR_PREFIX}${Buffer.from(JSON.stringify([
    comparison.field,
    comparison.valueType,
    window.dateStartParameter,
    window.dateEndExclusiveParameter,
    window.timezoneParameter,
  ])).toString('base64url')}`;
}

function decodeLocalDateWindowSelector(value: unknown): LocalDateWindowSelector | null {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith(LOCAL_DATE_WINDOW_SELECTOR_PREFIX)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw.slice(LOCAL_DATE_WINDOW_SELECTOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 5 || decoded.some((entry) => typeof entry !== 'string' || !entry)) return null;
    if (decoded[1] !== 'datetime') return null;
    return {
      field: decoded[0],
      valueType: 'datetime',
      dateStartParameter: decoded[2],
      dateEndExclusiveParameter: decoded[3],
      timezoneParameter: decoded[4],
    };
  } catch {
    return null;
  }
}

function semanticQueryMapperType(parameter: DiscoveryCapabilityQueryParameter): FieldType {
  if (parameter.type === 'boolean') return 'boolean';
  if (parameter.type === 'integer' || parameter.type === 'number') return 'number';
  return 'string';
}

function semanticQueryMapperField(parameter: DiscoveryCapabilityQueryParameter) {
  return {
    id: parameter.parameter,
    displayName: humanizeKey(parameter.role?.trim() || parameter.parameter),
    required: parameter.required === true,
    defaultMatch: false,
    canBeUsedToMatch: false,
    display: true,
    type: semanticQueryMapperType(parameter),
    description: `${parameter.type}${parameter.role ? ` · ${parameter.role}` : ''} · LifeSpace query parameter ${parameter.parameter}`,
  };
}

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
  const semanticSort = String(context.getNodeParameter('semanticSort', itemIndex, '') ?? '').trim();
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

  if (semanticSort && (orderedSorts.length > 0 || legacySortField)) {
    throw new NodeOperationError(context.getNode(), 'Semantic Sort cannot be combined with field Sorts', { itemIndex });
  }
  if (semanticSort) qs.sort = semanticSort;
  if (!semanticSort && orderedSorts.length === 1) qs.sort = orderedSorts[0];
  if (!semanticSort && orderedSorts.length > 1) qs.sort = orderedSorts;
  if (!semanticSort && orderedSorts.length === 0 && legacySortField) qs.sort = `${legacySortField}:${legacySortDirection}`;
  qs.limit = limit;
  if (cursor) qs.cursor = cursor;

  const usedKeys = new Set<string>();
  const setQueryParameter = (key: string, value: string | number | boolean) => {
    if (usedKeys.has(key)) {
      throw new NodeOperationError(context.getNode(), `Query parameter ${key} may be supplied only once`, { itemIndex });
    }
    usedKeys.add(key);
    qs[key] = typeof value === 'boolean' ? String(value) : value;
  };
  const setFilter = (field: string, operator: 'exact' | 'from' | 'to', value: string | number | boolean) => {
    const key = operator === 'from' ? `${field}From` : operator === 'to' ? `${field}To` : field;
    setQueryParameter(key, value);
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
  for (const row of (typedFilters.numberComparison ?? []) as QueryComparison[]) {
    const field = comparisonFieldParts(row.field).field;
    const parameter = String(row.parameter ?? '').trim();
    const value = Number(row.value);
    if (field && parameter && Number.isFinite(value)) setQueryParameter(parameter, value);
  }
  for (const row of (typedFilters.temporalComparison ?? []) as QueryComparison[]) {
    const { field, valueType } = comparisonFieldParts(row.field);
    const parameter = String(row.parameter ?? '').trim();
    if (!field || !parameter || row.value === undefined || row.value === '') continue;
    const raw = String(row.value);
    const value = valueType === 'date' ? dateOnlyValue(context, itemIndex, raw, field) : raw;
    if (value !== null) setQueryParameter(parameter, value);
  }

  const localDateWindows = context.getNodeParameter('localDateWindows.window', itemIndex, []) as QueryLocalDateWindow[];
  for (const row of localDateWindows) {
    const selector = decodeLocalDateWindowSelector(row.field);
    if (!selector) {
      if (String(row.field ?? '').trim()) {
        throw new NodeOperationError(context.getNode(), 'Local Date Window selector is invalid. Re-select the field from Runtime Discovery.', { itemIndex });
      }
      continue;
    }
    const dateStart = dateOnlyValue(context, itemIndex, row.dateStart, selector.field);
    const dateEndExclusive = dateOnlyValue(context, itemIndex, row.dateEndExclusive, selector.field);
    const timezone = String(row.timezone ?? '').trim();
    if (dateStart !== null) setQueryParameter(selector.dateStartParameter, dateStart);
    if (dateEndExclusive !== null) setQueryParameter(selector.dateEndExclusiveParameter, dateEndExclusive);
    if (timezone) setQueryParameter(selector.timezoneParameter, timezone);
  }

  const semanticQueryInput = mappedValue(context, itemIndex, 'semanticQueryInput');
  for (const [parameter, value] of Object.entries(semanticQueryInput)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new NodeOperationError(context.getNode(), `Semantic Query parameter ${parameter} must be a scalar value`, { itemIndex });
    }
    setQueryParameter(parameter, value);
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

function recordVersion(
  context: IExecuteFunctions,
  itemIndex: number,
  record: IDataObject,
): number {
  const version = record.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new NodeOperationError(
      context.getNode(),
      'LifeSpace record did not expose a usable version for optimistic concurrency',
      { itemIndex },
    );
  }
  return version;
}

async function currentRecord(
  context: IExecuteFunctions,
  itemIndex: number,
  baseUrl: string,
  recordPath: string,
): Promise<IDataObject> {
  const response = await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceApi',
    { method: 'GET', url: `${baseUrl}${recordPath}`, json: true },
  ) as { data?: IDataObject };
  if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace record lookup returned an invalid response', { itemIndex });
  }
  return response.data;
}

async function currentRecordVersion(
  context: IExecuteFunctions,
  itemIndex: number,
  baseUrl: string,
  recordPath: string,
): Promise<number> {
  return recordVersion(context, itemIndex, await currentRecord(context, itemIndex, baseUrl, recordPath));
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

async function executionModel(
  context: IExecuteFunctions,
  itemIndex: number,
  baseUrl: string,
  spaceId: string,
  modelKey: string,
): Promise<DiscoveryModel> {
  const discovery = await loadExecutionRuntimeDiscovery(context, baseUrl, spaceId, modelKey);
  const model = discoveryModel(discovery, spaceId, modelKey);
  if (!model) {
    throw new NodeOperationError(context.getNode(), `LifeSpace Record Type ${modelKey} is not available`, { itemIndex });
  }
  return model;
}

async function actionBodyWithConcurrency(
  context: IExecuteFunctions,
  itemIndex: number,
  baseUrl: string,
  spaceId: string,
  modelKey: string,
  recordPath: string,
  actionKey: string,
  semanticInput: IDataObject,
): Promise<IDataObject> {
  const model = await executionModel(context, itemIndex, baseUrl, spaceId, modelKey);
  const action = model.actions.find((entry) => entry.key === actionKey);
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
  const spaceId = loadOptionParameter(context, 'spaceId');
  const recordTypeValue = loadOptionParameter(context, 'recordType');
  const legacyModelRoute = recordTypeValue ? '' : loadOptionParameter(context, 'modelRoute');
  if (!spaceId || (!recordTypeValue && !legacyModelRoute)) return null;
  const recordType = recordTypeValue ? decodeRecordTypeSelector(recordTypeValue) : null;
  if (recordTypeValue && !recordType) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace Record Type selector is invalid. Choose a Record Type from Discovery or pass a Trigger recordType value.');
  }
  const discovery = await loadRuntimeDiscovery.call(context);
  const model = discoveryModel(discovery, spaceId, recordType?.modelKey ?? LEGACY_MODEL_ROUTE_TO_KEY[legacyModelRoute] ?? '');
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

async function comparisonFieldOptions(
  context: ILoadOptionsFunctions,
  types: DiscoveryComparison['valueType'][],
): Promise<INodePropertyOptions[]> {
  const selected = await optionModel(context);
  if (!selected) return [];
  const allowed = new Set(types);
  return (selected.model.query.comparisons ?? [])
    .filter((comparison) => allowed.has(comparison.valueType))
    .map((comparison) => {
      const field = selected.model.fields.find((entry) => entry.key === comparison.field);
      return {
        name: field?.title?.trim() || humanizeKey(comparison.field),
        value: `${comparison.valueType}:${comparison.field}`,
        description: `${comparison.source} · ${comparison.valueType} · explicit LifeSpace comparison operators`,
      };
    });
}

async function relationFieldOptions(
  context: ILoadOptionsFunctions,
  cardinality?: 'one' | 'many',
  filterableOnly = false,
): Promise<INodePropertyOptions[]> {
  const selected = await optionModel(context);
  if (!selected) return [];
  const operation = loadOptionParameter(context, 'operation') || 'create';
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
          { name: 'Create', value: 'create', action: 'Create a record', description: 'Create a record through the LifeSpace Generic Runtime' },
          { name: 'Delete', value: 'delete', action: 'Delete a record', description: 'Delete a record using optimistic concurrency' },
          { name: 'Execute Action', value: 'executeAction', action: 'Execute a record action', description: 'Execute a published LifeSpace Record Action or Capability action' },
          { name: 'Get', value: 'get', action: 'Get a record', description: 'Get one record by ID' },
          { name: 'List / Query', value: 'list', action: 'List or query records', description: 'Query a record collection using its published query contract' },
          { name: 'Update', value: 'update', action: 'Update a record', description: 'Update a record using optimistic concurrency' },
        ],
        default: 'list',
      },
      {
        displayName: 'Space Name or ID', name: 'spaceId', type: 'options',
        typeOptions: { loadOptionsMethod: 'getSpaces' }, options: [], default: '', required: true,
        displayOptions: { show: { resource: ['modelRecord'] } },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Record Type Name or ID', name: 'recordType', type: 'options',
        typeOptions: { loadOptionsMethod: 'getRecordTypes', loadOptionsDependsOn: ['spaceId', 'operation'] },
        options: [], default: '', required: true, displayOptions: { show: { resource: ['modelRecord'] } },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Record ID', name: 'recordId', type: 'string', default: '', required: true,
        displayOptions: { show: { resource: ['modelRecord'], operation: ['get', 'update', 'delete', 'executeAction'] } },
      },
      {
        displayName: 'Fields', name: 'fields', type: 'resourceMapper',
        default: { mappingMode: 'defineBelow', value: null }, noDataExpression: true, required: true,
        typeOptions: {
          loadOptionsDependsOn: ['spaceId', 'recordType', 'operation'],
          resourceMapper: {
            resourceMapperMethod: 'getRecordFields', mode: 'add',
            fieldWords: { singular: 'field', plural: 'fields' }, addAllFields: true, supportAutoMap: false,
            noFieldsError: 'The selected LifeSpace Record Type has no writable fields for this operation.',
          },
        },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },
        description: 'Writable fields loaded from LifeSpace Runtime Discovery. Server-defaulted required fields are not required from the n8n user.',
      },
      {
        displayName: 'Date Fields', name: 'dateFields', type: 'fixedCollection', default: {},
        placeholder: 'Add Date Field', typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },
        options: [{
          displayName: 'Date', name: 'date', values: [
            {
              displayName: 'Field Name or ID', name: 'field', type: 'options',
              typeOptions: { loadOptionsMethod: 'getWritableDateFields', loadOptionsDependsOn: ['spaceId', 'recordType', 'operation'] },
              options: [], default: '', required: true,
              description: 'Choose a LifeSpace date field. The node submits calendar-date YYYY-MM-DD values. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
            },
            { displayName: 'Date', name: 'value', type: 'dateTime', default: '', description: 'Calendar date. Expressions remain supported; empty values clear nullable fields.' },
          ],
        }],
      },
      {
        displayName: 'Single Relations', name: 'singleRelations', type: 'fixedCollection', default: {},
        placeholder: 'Add Single Relation', typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },
        options: [{ displayName: 'Relation', name: 'relation', values: [
          {
            displayName: 'Field Name or ID', name: 'field', type: 'options',
            description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
            typeOptions: { loadOptionsMethod: 'getSingleRelationFields', loadOptionsDependsOn: ['spaceId', 'recordType', 'operation'] },
            options: [], default: '', required: true,
          },
          {
            displayName: 'Target Name or ID', name: 'target', type: 'options',
            typeOptions: { loadOptionsMethod: 'getRelationTargetsForCurrentField', loadOptionsDependsOn: ['spaceId', 'recordType', '&field'] },
            options: [], default: '',
            description: 'Choose an authorized relation target, or use an expression with a stable LifeSpace ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
          },
        ] }],
      },
      {
        displayName: 'Multi Relations', name: 'multiRelations', type: 'fixedCollection', default: {},
        placeholder: 'Add Multi Relation', typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },
        options: [{ displayName: 'Relation', name: 'relation', values: [
          {
            displayName: 'Field Name or ID', name: 'field', type: 'options',
            description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
            typeOptions: { loadOptionsMethod: 'getMultiRelationFields', loadOptionsDependsOn: ['spaceId', 'recordType', 'operation'] },
            options: [], default: '', required: true,
          },
          {
            displayName: 'Targets Names or IDs', name: 'targets', type: 'multiOptions',
            typeOptions: { loadOptionsMethod: 'getRelationTargetsForCurrentField', loadOptionsDependsOn: ['spaceId', 'recordType', '&field'] },
            options: [], default: [],
            description: 'Choose authorized relation targets, or use an expression with stable LifeSpace IDs. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
          },
        ] }],
      },
      {
        displayName: 'Search', name: 'search', type: 'string', default: '',
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Full-text search across fields declared searchable by LifeSpace. Leave empty to disable search.',
      },
      {
        displayName: 'Filters', name: 'filters', type: 'fixedCollection', default: {},
        placeholder: 'Add Filter', typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        options: [
          { displayName: 'Text Filter', name: 'text', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getTextFilterableFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Value', name: 'value', type: 'string', default: '', required: true },
          ] },
          { displayName: 'Enum Filter', name: 'enum', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getEnumFilterableFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Value Names or IDs', name: 'values', type: 'multiOptions', description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getEnumValuesForCurrentFilter', loadOptionsDependsOn: ['spaceId', 'recordType', '&field'] }, options: [], default: [], required: true },
          ] },
          { displayName: 'Boolean Filter', name: 'boolean', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getBooleanFilterableFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Value', name: 'value', type: 'boolean', default: true },
          ] },
          { displayName: 'Number Filter', name: 'number', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getNumericFilterableFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },
            { displayName: 'Value', name: 'value', type: 'number', default: 0, required: true },
          ] },
          { displayName: 'Date / Time Filter', name: 'temporal', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getTemporalFilterableFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },
            { displayName: 'Value', name: 'value', type: 'dateTime', default: '', required: true },
          ] },
          { displayName: 'Number Comparison', name: 'numberComparison', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Fields and envelope values advertised by LifeSpace explicit comparison semantics. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.', typeOptions: { loadOptionsMethod: 'getNumericComparisonFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Operator Name or ID', name: 'parameter', type: 'options', description: 'The option value is the exact query parameter published by LifeSpace; the adapter does not derive transport names. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.', typeOptions: { loadOptionsMethod: 'getComparisonOperatorsForCurrentField', loadOptionsDependsOn: ['spaceId', 'recordType', '&field'] }, options: [], default: '', required: true },
            { displayName: 'Value', name: 'value', type: 'number', default: 0, required: true },
          ] },
          { displayName: 'Date / Time Comparison', name: 'temporalComparison', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Includes model date/datetime fields plus LifeSpace envelope timestamps such as createdAt/updatedAt when advertised. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.', typeOptions: { loadOptionsMethod: 'getTemporalComparisonFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Operator Name or ID', name: 'parameter', type: 'options', description: 'Uses the exact explicit comparison transport advertised by LifeSpace. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.', typeOptions: { loadOptionsMethod: 'getComparisonOperatorsForCurrentField', loadOptionsDependsOn: ['spaceId', 'recordType', '&field'] }, options: [], default: '', required: true },
            { displayName: 'Value', name: 'value', type: 'dateTime', default: '', required: true },
          ] },
          { displayName: 'Person Filter', name: 'person', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getPersonFilterableFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Person Name or ID', name: 'target', type: 'options', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getRelationTargetsForCurrentField', loadOptionsDependsOn: ['spaceId', 'recordType', '&field'] }, options: [], default: '', required: true },
          ] },
          { displayName: 'Raw / Legacy Filter', name: 'filter', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getFilterableFields' }, options: [], default: '', required: true, description: 'Compatibility and unsupported relation escape hatch. Prefer the typed filter variants above. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
            { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },
            { displayName: 'Value', name: 'value', type: 'string', default: '', required: true },
          ] },
        ],
      },
      {
        displayName: 'Local Date Windows', name: 'localDateWindows', type: 'fixedCollection', default: {},
        placeholder: 'Add Local Date Window', typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        options: [{ displayName: 'Window', name: 'window', values: [
          { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getLocalDateWindowFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true, description: 'Only datetime fields whose published comparison semantics include a local-date-window transport are offered. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
          { displayName: 'Start Date', name: 'dateStart', type: 'dateTime', default: '', required: true, description: 'Inclusive local calendar start date. The adapter submits YYYY-MM-DD and does not calculate UTC boundaries.' },
          { displayName: 'End Date (Exclusive)', name: 'dateEndExclusive', type: 'dateTime', default: '', required: true, description: 'Exclusive local calendar end date' },
          { displayName: 'Viewing Timezone', name: 'timezone', type: 'string', default: '', required: true, placeholder: 'Europe/Amsterdam', description: 'IANA timezone passed unchanged to LifeSpace Core' },
        ] }],
      },
      {
        displayName: 'Semantic Query Name or ID', name: 'semanticQueryKey', type: 'options',
        typeOptions: { loadOptionsMethod: 'getCapabilityQueries', loadOptionsDependsOn: ['spaceId', 'recordType'] },
        options: [], default: '',
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Optional grouped capability query published by LifeSpace, for example Calendar Window. The adapter does not hard-code Event fields. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Semantic Query Input', name: 'semanticQueryInput', type: 'resourceMapper',
        default: { mappingMode: 'defineBelow', value: null }, noDataExpression: true,
        typeOptions: {
          loadOptionsDependsOn: ['spaceId', 'recordType', 'semanticQueryKey'],
          resourceMapper: {
            resourceMapperMethod: 'getSemanticQueryInputFields', mode: 'add',
            fieldWords: { singular: 'parameter', plural: 'parameters' }, addAllFields: true, supportAutoMap: false,
            noFieldsError: 'Choose a Semantic Query to load its LifeSpace-published parameters.',
          },
        },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Parameters are projected directly from query.capabilityQueries. Calendar local dates/timezone are sent to Core unchanged; Core owns overlap and DST semantics.',
      },
      {
        displayName: 'Semantic Sort Name or ID', name: 'semanticSort', type: 'options',
        typeOptions: { loadOptionsMethod: 'getSemanticSorts', loadOptionsDependsOn: ['spaceId', 'recordType', 'semanticQueryKey'] },
        options: [], default: '',
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Optional capability-specific sort published with the selected Semantic Query. Do not combine with field Sorts. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Return All', name: 'returnAll', type: 'boolean', default: false,
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Whether to return all results or only up to a given limit',
      },
      {
        displayName: 'Limit', name: 'limit', type: 'number',
        typeOptions: { minValue: 1, maxValue: 200, numberPrecision: 0 }, default: 50,
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'], returnAll: [false] } },
        description: 'Max number of results to return',
      },
      {
        displayName: 'Sorts', name: 'sorts', type: 'fixedCollection', default: {},
        placeholder: 'Add Sort', typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        options: [{ displayName: 'Sort', name: 'sort', values: [
          { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getSortableFields' }, options: [], default: '', required: true, description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>' },
          { displayName: 'Direction', name: 'direction', type: 'options', options: [{ name: 'Ascending', value: 'asc' }, { name: 'Descending', value: 'desc' }], default: 'asc' },
        ] }],
        description: 'Add sort criteria in priority order. If omitted, LifeSpace applies the server-declared default order.',
      },
      {
        displayName: 'Options', name: 'options', type: 'collection', placeholder: 'Add Option', default: {},
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        options: [{ displayName: 'Cursor', name: 'cursor', type: 'string', default: '', description: 'Advanced manual pagination. Normally leave empty and use Return All or Limit.' }],
      },
      {
        displayName: 'Concurrency Options', name: 'mutationOptions', type: 'collection', placeholder: 'Add Option', default: {},
        displayOptions: { show: { resource: ['modelRecord'], operation: ['update', 'delete'] } },
        options: [{ displayName: 'Version', name: 'version', type: 'number', typeOptions: { minValue: 1, numberPrecision: 0 }, default: 1, description: 'Optional known record version. If omitted, the node reads the current record version immediately before the mutation.' }],
      },
      {
        displayName: 'Action Name or ID', name: 'actionKey', type: 'options',
        typeOptions: { loadOptionsMethod: 'getActions', loadOptionsDependsOn: ['spaceId', 'recordType'] },
        options: [], default: '', required: true,
        displayOptions: { show: { resource: ['modelRecord'], operation: ['executeAction'] } },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Action Input', name: 'actionInput', type: 'resourceMapper',
        default: { mappingMode: 'defineBelow', value: null }, noDataExpression: true,
        typeOptions: {
          loadOptionsDependsOn: ['spaceId', 'recordType', 'actionKey'],
          resourceMapper: { resourceMapperMethod: 'getActionInputFields', mode: 'add', fieldWords: { singular: 'input', plural: 'inputs' }, addAllFields: true, supportAutoMap: false, noFieldsError: 'This LifeSpace Action has no semantic input fields.' },
        },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['executeAction'] } },
        description: 'Only semantic/domain inputs from Runtime Discovery are shown. Concurrency metadata is resolved automatically.',
      },
      {
        displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
        displayOptions: { show: { resource: ['apiRequest'] } },
        options: [{ name: 'API Request', value: 'apiRequest', action: 'Make an API request', description: 'Call a path relative to the configured LifeSpace API Base URL' }],
        default: 'apiRequest',
      },
      {
        displayName: 'Method', name: 'method', type: 'options', displayOptions: { show: { resource: ['apiRequest'] } },
        options: [{ name: 'DELETE', value: 'DELETE' }, { name: 'GET', value: 'GET' }, { name: 'PATCH', value: 'PATCH' }, { name: 'POST', value: 'POST' }, { name: 'PUT', value: 'PUT' }], default: 'GET',
      },
      {
        displayName: 'Path', name: 'path', type: 'string', default: '/', required: true,
        displayOptions: { show: { resource: ['apiRequest'] } },
        description: 'Path relative to the configured LifeSpace API Base URL, for example /me/_discovery',
      },
      {
        displayName: 'JSON Body', name: 'jsonBody', type: 'json', default: '{}',
        displayOptions: { show: { resource: ['apiRequest'], method: ['POST', 'PATCH', 'PUT', 'DELETE'] } },
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
        const spaceId = loadOptionParameter(this, 'spaceId');
        if (!spaceId) return [];
        const discovery = await loadRuntimeDiscovery.call(this);
        const space = discoverySpace(discovery, spaceId);
        if (!space) return [];
        const operation = loadOptionParameter(this, 'operation') || 'list';
        return space.models
          .filter((model) => operation === 'executeAction'
            ? model.actions.length > 0
            : model.access.includes(requiredAccessForOperation(operation)))
          .map((model) => ({
            name: `${model.display.plural} (${model.key})`,
            value: model.key,
            description: model.description ?? undefined,
          }));
      },
      async getActions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        return selected ? selected.model.actions.map(actionOption) : [];
      },
      async getFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        if (!selected) return [];
        return selected.model.query.filterable.map((fieldKey) => {
          const field = selected.model.fields.find((entry) => entry.key === fieldKey);
          const rangeSupported = field && ['date', 'datetime', 'integer', 'number'].includes(field.type);
          return {
            name: field?.title?.trim() || humanizeKey(fieldKey), value: fieldKey,
            description: rangeSupported ? `${field?.type ?? 'field'} · equality and range filters` : `${field?.type ?? 'field'} · equality filter`,
          };
        });
      },
      async getWritableDateFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        if (!selected) return [];
        const operation = loadOptionParameter(this, 'operation') || 'create';
        return selected.model.fields
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
        const selected = await optionModel(this);
        const fieldKey = String(this.getCurrentNodeParameter('&field') ?? '').trim();
        if (!selected || !fieldKey) return [];
        const field = selected.model.fields.find((entry) => entry.key === fieldKey);
        if (!field) return [];
        const targets = await loadRelationTargets(this, selected.spaceId, selected.model.key, field);
        return (targets ?? []).map((target) => ({ name: target.label, value: target.id }));
      },
      async getTextFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return filterFieldOptions(this, ['string', 'text', 'timezone']); },
      async getEnumFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return filterFieldOptions(this, ['enum']); },
      async getBooleanFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return filterFieldOptions(this, ['boolean']); },
      async getNumericFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return filterFieldOptions(this, ['integer', 'number']); },
      async getTemporalFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return filterFieldOptions(this, ['date', 'datetime'], true); },
      async getNumericComparisonFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return comparisonFieldOptions(this, ['integer', 'number']); },
      async getTemporalComparisonFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return comparisonFieldOptions(this, ['date', 'datetime']); },
      async getComparisonOperatorsForCurrentField(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        const { field } = comparisonFieldParts(this.getCurrentNodeParameter('&field'));
        const comparison = selected?.model.query.comparisons?.find((entry) => entry.field === field);
        return (comparison?.operators ?? [])
          .filter((operator) => operator.transport === 'explicit')
          .map((operator) => ({
            name: COMPARISON_OPERATOR_LABELS[operator.operator] ?? humanizeKey(operator.operator),
            value: operator.parameter,
            description: `${operator.operator} · ${operator.transport} · ${operator.parameter}`,
          }));
      },
      async getLocalDateWindowFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        if (!selected) return [];
        return (selected.model.query.comparisons ?? [])
          .filter((comparison) => comparison.valueType === 'datetime' && comparison.localDateWindow)
          .map((comparison) => {
            const field = selected.model.fields.find((entry) => entry.key === comparison.field);
            return {
              name: field?.title?.trim() || humanizeKey(comparison.field),
              value: encodeLocalDateWindowSelector(comparison),
              description: `${comparison.source} · [start,end) local calendar window · Core resolves timezone/DST`,
            };
          });
      },
      async getCapabilityQueries(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        return (selected?.model.query.capabilityQueries ?? []).map((query) => ({
          name: `${humanizeKey(query.capability)} · ${humanizeKey(query.key)}`,
          value: query.key,
          description: `${query.semantics}${query.recurrenceExpansion === false ? ' · recurrence not expanded' : ''}`,
        }));
      },
      async getSemanticSorts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        const queryKey = loadOptionParameter(this, 'semanticQueryKey');
        const query = selected?.model.query.capabilityQueries?.find((entry) => entry.key === queryKey);
        return (query?.ordering?.values ?? []).map((value) => ({
          name: value === query?.ordering?.default ? `${value} (Default)` : value,
          value,
          description: `${query?.key ?? 'semantic query'} ordering`,
        }));
      },
      async getPersonFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return relationFieldOptions(this, undefined, true); },
      async getEnumValuesForCurrentFilter(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        const fieldKey = String(this.getCurrentNodeParameter('&field') ?? '').trim();
        const field = selected?.model.fields.find((entry) => entry.key === fieldKey);
        return field?.type === 'enum' ? (field.values ?? []).map((value) => ({ name: value, value })) : [];
      },
      async getSortableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        if (!selected) return [];
        return [
          ...selected.model.query.sort.envelopeFields.map((fieldKey) => ({ name: humanizeKey(fieldKey), value: fieldKey })),
          ...selected.model.query.sortable.map((fieldKey) => {
            const field = selected.model.fields.find((entry) => entry.key === fieldKey);
            return { name: field?.title?.trim() || humanizeKey(fieldKey), value: fieldKey };
          }),
        ];
      },
    },
    resourceMapping: {
      async getRecordFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const selected = await optionModel(this);
        if (!selected) return { fields: [] };
        const operation = loadOptionParameter(this, 'operation') || 'create';
        const writableFields = selected.model.fields
          .filter((field) => !field.readOnly && (operation !== 'update' || !field.immutable))
          .filter((field) => field.type !== 'date')
          .filter((field) => field.relation?.lookup.supported !== true);
        return {
          fields: writableFields.map((field) => mapperField(
            field,
            operation === 'create' && field.required === true && !hasServerDefault(selected.model, field.key),
          )),
        };
      },
      async getActionInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const selected = await optionModel(this);
        const actionKey = loadOptionParameter(this, 'actionKey');
        const action = selected?.model.actions.find((entry) => entry.key === actionKey);
        return action
          ? { fields: action.input.fields.map((field) => mapperField(field, field.required === true)) }
          : { fields: [] };
      },
      async getSemanticQueryInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const selected = await optionModel(this);
        const queryKey = loadOptionParameter(this, 'semanticQueryKey');
        const query = selected?.model.query.capabilityQueries?.find((entry) => entry.key === queryKey);
        return query ? { fields: query.parameters.map(semanticQueryMapperField) } : { fields: [] };
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
          const recordType = decodeRecordTypeSelector(this.getNodeParameter('recordType', itemIndex, ''));
          const legacyModelRoute = String(this.getNodeParameter('modelRoute', itemIndex, '') ?? '').trim();
          const rawModelKey = recordType?.modelKey ?? LEGACY_MODEL_ROUTE_TO_KEY[legacyModelRoute];
          if (!rawModelKey) {
            throw new NodeOperationError(
              this.getNode(),
              'LifeSpace Record Type selector is invalid. Choose a Record Type from Discovery or pass a Trigger recordType value.',
              { itemIndex },
            );
          }
          const spaceId = encodeURIComponent(rawSpaceId);
          const modelKey = encodeURIComponent(rawModelKey);
          const collectionPath = `/spaces/${spaceId}/models/${modelKey}/records`;

          if (operation === 'list') {
            const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
            if (!returnAll) {
              const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
              const qs = queryParameters(this, itemIndex, limit);
              const requestOptions: IHttpRequestOptions = { method: 'GET', url: `${baseUrl}${collectionPath}`, qs, json: true };
              if (Array.isArray(qs.sort)) requestOptions.arrayFormat = 'repeat';
              response = await this.helpers.httpRequestWithAuthentication.call(this, 'lifeSpaceApi', requestOptions);
            } else {
              const allItems: IDataObject[] = [];
              const seenCursors = new Set<string>();
              let cursor: string | undefined;
              do {
                const qs = queryParameters(this, itemIndex, 200, cursor);
                const requestOptions: IHttpRequestOptions = { method: 'GET', url: `${baseUrl}${collectionPath}`, qs, json: true };
                if (Array.isArray(qs.sort)) requestOptions.arrayFormat = 'repeat';
                const pageResponse = await this.helpers.httpRequestWithAuthentication.call(this, 'lifeSpaceApi', requestOptions);
                const page = queryPage(this, itemIndex, pageResponse);
                allItems.push(...page.items);
                if (!page.nextCursor) { cursor = undefined; break; }
                if (seenCursors.has(page.nextCursor)) {
                  throw new NodeOperationError(this.getNode(), 'LifeSpace returned the same nextCursor more than once', { itemIndex });
                }
                seenCursors.add(page.nextCursor);
                cursor = page.nextCursor;
              } while (cursor);
              response = { data: { items: allItems, nextCursor: null } };
            }
          } else if (operation === 'create') {
            const body = mutationMappedValues(this, itemIndex);
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'lifeSpaceApi',
              { method: 'POST', url: `${baseUrl}${collectionPath}`, body, json: true },
            );
          } else {
            const recordId = encodeURIComponent(String(this.getNodeParameter('recordId', itemIndex)));
            const recordPath = `${collectionPath}/${recordId}`;
            let options: IHttpRequestOptions;

            if (operation === 'get') {
              options = { method: 'GET', url: `${baseUrl}${recordPath}`, json: true };
            } else if (operation === 'update') {
              const body = mutationMappedValues(this, itemIndex);
              options = {
                method: 'PATCH',
                url: `${baseUrl}${recordPath}`,
                body: {
                  ...body,
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
                  rawModelKey,
                  recordPath,
                  rawActionKey,
                  mappedValue(this, itemIndex, 'actionInput'),
                ),
                json: true,
              };
            }
            response = await this.helpers.httpRequestWithAuthentication.call(this, 'lifeSpaceApi', options);
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
            options.body = parseJsonObject(this, itemIndex, this.getNodeParameter('jsonBody', itemIndex, '{}'), 'JSON Body');
          }
          response = await this.helpers.httpRequestWithAuthentication.call(this, 'lifeSpaceApi', options);
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
