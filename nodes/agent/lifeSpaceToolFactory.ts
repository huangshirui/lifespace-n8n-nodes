import type {
  DiscoveryAction,
  DiscoveryCapabilityQuery,
  DiscoveryComparison,
  DiscoveryField,
  DiscoveryModel,
} from '../lifespaceDiscovery';
import {
  canonicalQueryPath,
  compileGenericQuery,
  genericQuerySchema as canonicalGenericQuerySchema,
} from './lifeSpaceGenericQueryTool';

export type AgentToolOperation = 'query' | 'create' | 'update' | 'delete' | 'action';
export type AgentToolQueryMode = 'generic' | 'capability';

export type AgentToolConfig = {
  spaceId: string;
  spaceName?: string | null;
  operation: AgentToolOperation;
  queryMode?: AgentToolQueryMode;
  capabilityQueryKey?: string;
  actionKey?: string;
  descriptionOverride?: string;
  viewingTimezone?: string;
};

export type AgentToolSchema = {
  type: 'object';
  properties: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties: false;
  dependentRequired?: Record<string, string[]>;
};

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: Array<string | number | boolean | null>;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
  default?: unknown;
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

export type LifeSpaceAgentToolDefinition = {
  name: string;
  description: string;
  schema: AgentToolSchema;
  modelKey: string;
  operation: AgentToolOperation;
  actionKey?: string;
  capabilityQueryKey?: string;
};

export type AgentToolRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  qs?: Record<string, string | number | boolean | Array<string | number | boolean>>;
  body?: Record<string, unknown>;
  repeatQueryArrays?: boolean;
  needsCurrentVersion?: boolean;
  versionParameter?: string;
};

export type AgentQueryFailure = {
  code: 'INVALID_QUERY_SORT' | 'INVALID_QUERY_SORT_DIRECTION' | 'INVALID_QUERY_FILTER_FIELD' | 'INVALID_QUERY_FILTER_OPERATOR';
  message: string;
  field?: string;
  operator?: string;
  allowedFields?: string[];
  allowedOperators?: string[];
  hint: string;
};

const RECORD_ID = 'recordId';
const TOOL_NAME_MAX_LENGTH = 64;
const QUERY_ERROR_PREFIX = 'LIFESPACE_AGENT_QUERY:';

function queryFailure(failure: AgentQueryFailure): never {
  throw new Error(QUERY_ERROR_PREFIX + JSON.stringify(failure));
}

export function parseAgentQueryFailure(error: unknown): AgentQueryFailure | null {
  if (!(error instanceof Error)) return null;
  const index = error.message.indexOf(QUERY_ERROR_PREFIX);
  if (index < 0) return null;
  try {
    const value = JSON.parse(error.message.slice(index + QUERY_ERROR_PREFIX.length)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const failure = value as Record<string, unknown>;
    if (
      !['INVALID_QUERY_SORT', 'INVALID_QUERY_SORT_DIRECTION', 'INVALID_QUERY_FILTER_FIELD', 'INVALID_QUERY_FILTER_OPERATOR'].includes(String(failure.code))
      || typeof failure.message !== 'string'
      || typeof failure.hint !== 'string'
    ) return null;
    return value as AgentQueryFailure;
  } catch {
    return null;
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function cleanToken(value: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9_]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase();
  return normalized || 'value';
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function toolName(parts: string[], spaceId: string): string {
  const suffix = `s${stableHash(spaceId).slice(0, 7)}`;
  const semantic = parts.map(cleanToken).filter(Boolean).join('_');
  const prefix = `lifespace_${semantic}`;
  const room = TOOL_NAME_MAX_LENGTH - suffix.length - 1;
  return `${prefix.slice(0, Math.max(1, room)).replace(/_+$/u, '')}_${suffix}`;
}

function fieldLabel(field: DiscoveryField): string {
  return field.title?.trim() || field.key;
}

function fieldDescription(field: DiscoveryField): string {
  const base = field.description?.trim() || `${fieldLabel(field)} (${field.type}).`;
  if (field.type === 'person' || field.type === 'record') {
    return `${base} Prefer {"name":"..."} when the user names the target; {"id":"..."} or a stable ID string is also accepted.`;
  }
  if (field.type === 'person_list' || field.type === 'record_list') {
    return `${base} Supply an array of references. Prefer {"name":"..."} values when the user names targets; {"id":"..."} or stable ID strings are also accepted.`;
  }
  if (field.type === 'temporal_range') {
    return `${base} Supply one object with kind, start, and end. kind=date uses inclusive YYYY-MM-DD dates; kind=instant uses absolute RFC3339 date-times.`;
  }
  return base;
}

function referenceSchema(): JsonSchema {
  return {
    oneOf: [
      {
        type: 'object',
        properties: { name: { type: 'string', minLength: 1 } },
        required: ['name'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { id: { type: 'string', minLength: 1 } },
        required: ['id'],
        additionalProperties: false,
      },
      { type: 'string', minLength: 1 },
    ],
  };
}

function fixedRangeSchema(kind: 'date' | 'instant'): JsonSchema {
  const format = kind === 'date' ? 'date' : 'date-time';
  return {
    type: 'object',
    properties: {
      start: { type: 'string', format },
      endExclusive: { type: 'string', format },
    },
    required: ['start', 'endExclusive'],
    additionalProperties: false,
  };
}

function temporalRangeSchema(): JsonSchema {
  return {
    oneOf: [
      {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['date'] },
          start: { type: 'string', format: 'date' },
          end: { type: 'string', format: 'date' },
        },
        required: ['kind', 'start', 'end'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['instant'] },
          start: { type: 'string', format: 'date-time' },
          end: { type: 'string', format: 'date-time' },
        },
        required: ['kind', 'start', 'end'],
        additionalProperties: false,
      },
    ],
  };
}

function withNullable(field: DiscoveryField, schema: JsonSchema): JsonSchema {
  schema.description = fieldDescription(field);
  if (field.nullable === true) {
    return {
      description: schema.description,
      oneOf: [schema, { type: 'null' }],
    };
  }
  return schema;
}

function fieldSchema(field: DiscoveryField): JsonSchema {
  let schema: JsonSchema;
  switch (field.type) {
    case 'boolean':
      schema = { type: 'boolean' };
      break;
    case 'integer':
      schema = { type: 'integer' };
      break;
    case 'number':
      schema = { type: 'number' };
      break;
    case 'enum':
      if (!field.values?.length) throw new Error(`LifeSpace enum field ${field.key} has no published values`);
      schema = { type: 'string', enum: [...field.values] };
      break;
    case 'person':
    case 'record':
      schema = referenceSchema();
      break;
    case 'person_list':
    case 'record_list':
      schema = { type: 'array', items: referenceSchema() };
      break;
    case 'date':
      schema = { type: 'string', format: 'date' };
      break;
    case 'instant':
    case 'datetime':
      schema = { type: 'string', format: 'date-time' };
      break;
    case 'range<date>':
      schema = fixedRangeSchema('date');
      break;
    case 'range<instant>':
      schema = fixedRangeSchema('instant');
      break;
    case 'temporal_range':
      schema = temporalRangeSchema();
      break;
    case 'timezone':
      schema = { type: 'string', minLength: 1 };
      break;
    case 'string':
    case 'text':
      schema = { type: 'string' };
      break;
    default: {
      const exhaustive: never = field.type;
      throw new Error(`Unsupported LifeSpace field type ${String(exhaustive)}`);
    }
  }

  if (typeof field.minLength === 'number') schema.minLength = field.minLength;
  if (typeof field.maxLength === 'number') schema.maxLength = field.maxLength;
  if (typeof field.minimum === 'number') schema.minimum = field.minimum;
  if (typeof field.maximum === 'number') schema.maximum = field.maximum;
  return withNullable(field, schema);
}

function nextDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) throw new Error(`Invalid date ${date}`);
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return next.toISOString().slice(0, 10);
}

function normalizeTemporalRange(field: DiscoveryField, value: unknown): unknown {
  if (value === null || field.type !== 'temporal_range') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field.key} must be a TemporalRange object`);
  }
  const input = value as Record<string, unknown>;
  const kind = String(input.kind ?? '');
  const start = String(input.start ?? '');
  const end = String(input.end ?? '');
  if (kind === 'date') {
    if (end < start) throw new Error(`${field.key}.end must not be earlier than start`);
    return { kind: 'date', start, endExclusive: nextDate(end) };
  }
  if (kind === 'instant') {
    if (Date.parse(end) <= Date.parse(start)) throw new Error(`${field.key}.end must be later than start`);
    return { kind: 'instant', start, endExclusive: end };
  }
  throw new Error(`${field.key}.kind must be date or instant`);
}


function queryScalarSchema(type: string, description: string): JsonSchema {
  if (type === 'boolean') return { type: 'boolean', description };
  if (type === 'integer') return { type: 'integer', description };
  if (type === 'number') return { type: 'number', description };
  if (type === 'date') return { type: 'string', format: 'date', description };
  if (type === 'datetime') return { type: 'string', format: 'date-time', description };
  return { type: 'string', description };
}

function comparisonSchema(comparison: DiscoveryComparison): JsonSchema {
  return queryScalarSchema(
    comparison.valueType,
    `${comparison.source === 'envelope' ? 'LifeSpace envelope' : 'Model'} ${comparison.valueType} comparison.`,
  );
}

function genericQuerySchema(model: DiscoveryModel): AgentToolSchema {
  if (model.query.canonical) return canonicalGenericQuerySchema(model) as AgentToolSchema;
  const properties: Record<string, JsonSchema> = {};
  const dependentRequired: Record<string, string[]> = {};
  const comparableFields = new Set((model.query.comparisons ?? []).map((comparison) => comparison.field));

  if (model.query.search) {
    properties[model.query.search.parameter] = {
      type: 'string',
      minLength: model.query.search.minLength,
      maxLength: model.query.search.maxLength,
      description: `Full-text search across: ${model.query.searchable.join(', ')}.`,
    };
  }

  for (const filter of model.query.filters ?? []) {
    if (comparableFields.has(filter.field)) continue;
    const field = model.fields.find((entry) => entry.key === filter.field);
    if (!field) throw new Error(`LifeSpace query filter ${filter.parameter} references unknown field ${filter.field}`);
    if (filter.mode === 'enum-set') {
      if (!field.values?.length) throw new Error(`LifeSpace enum filter ${filter.parameter} has no published values`);
      properties[filter.parameter] = {
        type: 'array',
        items: { type: 'string', enum: [...field.values] },
        minItems: 1,
        description: `${fieldDescription(field)} Match any supplied enum value.`,
      };
      continue;
    }
    const schema = fieldSchema({ ...field, nullable: false });
    if (filter.acceptsCurrentActorPersonAlias === 'me') {
      schema.description = `${schema.description ?? ''} The special value "me" means the current actor's Person.`.trim();
    }
    properties[filter.parameter] = schema;
  }

  for (const comparison of model.query.comparisons ?? []) {
    for (const transport of comparison.operators.filter((entry) => entry.transport === 'explicit')) {
      properties[transport.parameter] = {
        ...comparisonSchema(comparison),
        description: `${comparison.field} ${transport.operator} comparison. Use this exact LifeSpace query parameter; do not derive another suffix.`,
      };
    }
    const window = comparison.localDateWindow;
    if (!window) continue;
    const names = [window.dateStartParameter, window.dateEndExclusiveParameter, window.timezoneParameter];
    properties[window.dateStartParameter] = {
      type: 'string',
      format: 'date',
      description: `${comparison.field} local calendar window start date (inclusive). Supply with the end-exclusive date and IANA viewing timezone.`,
    };
    properties[window.dateEndExclusiveParameter] = {
      type: 'string',
      format: 'date',
      description: `${comparison.field} local calendar window end date (exclusive). Supply with the start date and IANA viewing timezone.`,
    };
    properties[window.timezoneParameter] = {
      type: 'string',
      minLength: 1,
      description: `${comparison.field} IANA viewing timezone. LifeSpace Core converts local dates to DST-safe instant boundaries.`,
    };
    for (const name of names) dependentRequired[name] = names.filter((candidate) => candidate !== name);
  }

  if (model.query.sort.genericValues?.length) {
    properties[model.query.sort.parameter] = {
      type: 'array',
      items: { type: 'string', enum: [...model.query.sort.genericValues] },
      minItems: 1,
      maxItems: model.query.sort.maxCriteria,
      description: `Ordered LifeSpace sort criteria. Default when omitted: ${model.query.sort.default.join(', ')}.`,
    };
  }

  properties[model.query.pagination.limit.parameter] = {
    type: 'integer',
    minimum: model.query.pagination.limit.minimum,
    maximum: model.query.pagination.limit.maximum,
    default: model.query.pagination.limit.default,
    description: 'Maximum records to return in this page.',
  };
  properties[model.query.pagination.cursor.parameter] = {
    type: 'string',
    minLength: 1,
    description: 'Opaque LifeSpace cursor returned by a previous query page.',
  };

  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(Object.keys(dependentRequired).length ? { dependentRequired } : {}),
  };
}

function capabilityQuery(model: DiscoveryModel, key: string): DiscoveryCapabilityQuery {
  const query = model.query.capabilityQueries?.find((entry) => entry.key === key);
  if (!query) throw new Error(`LifeSpace capability query ${key} is not available on ${model.key}`);
  return query;
}

function capabilityQuerySchema(model: DiscoveryModel, key: string): AgentToolSchema {
  const query = capabilityQuery(model, key);
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const parameter of query.parameters) {
    properties[parameter.parameter] = {
      ...queryScalarSchema(
        parameter.type,
        `${parameter.role ? `${parameter.role}. ` : ''}${query.semantics}`,
      ),
      ...(parameter.default !== undefined ? { default: parameter.default } : {}),
    };
    if (parameter.required) required.push(parameter.parameter);
  }

  if (query.ordering?.values.length) {
    properties[query.ordering.parameter] = {
      type: 'string',
      enum: [...query.ordering.values],
      ...(query.ordering.default !== undefined ? { default: query.ordering.default } : {}),
      description: `${query.key} semantic ordering.`,
    };
  }

  properties[model.query.pagination.limit.parameter] = {
    type: 'integer',
    minimum: model.query.pagination.limit.minimum,
    maximum: model.query.pagination.limit.maximum,
    default: model.query.pagination.limit.default,
    description: 'Maximum records to return in this page.',
  };
  properties[model.query.pagination.cursor.parameter] = {
    type: 'string',
    minLength: 1,
    description: 'Opaque LifeSpace cursor returned by a previous query page.',
  };

  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function mutationFields(model: DiscoveryModel, operation: 'create' | 'update'): DiscoveryField[] {
  return model.fields
    .filter((field) => !field.readOnly)
    .filter((field) => operation === 'create' || !field.immutable);
}

function mutationSchema(model: DiscoveryModel, operation: 'create' | 'update'): AgentToolSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  if (operation === 'update') {
    properties[RECORD_ID] = { type: 'string', minLength: 1, description: 'Stable LifeSpace record ID to update.' };
    required.push(RECORD_ID);
  }

  for (const field of mutationFields(model, operation)) {
    const schema = fieldSchema(field);
    if (operation === 'create' && hasOwn(model.defaults ?? {}, field.key)) {
      const defaultValue = model.defaults[field.key];
      schema.description = `${schema.description ?? ''} Optional: LifeSpace applies its published default when omitted.`.trim();
      if (defaultValue !== undefined) schema.default = defaultValue;
    }
    properties[field.key] = schema;
    if (operation === 'create' && field.required && !hasOwn(model.defaults ?? {}, field.key)) required.push(field.key);
  }

  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function deleteSchema(): AgentToolSchema {
  return {
    type: 'object',
    properties: {
      [RECORD_ID]: { type: 'string', minLength: 1, description: 'Stable LifeSpace record ID to delete.' },
    },
    required: [RECORD_ID],
    additionalProperties: false,
  };
}

function selectedAction(model: DiscoveryModel, actionKey: string): DiscoveryAction {
  const action = model.actions.find((entry) => entry.key === actionKey);
  if (!action) throw new Error(`LifeSpace Action ${actionKey} is not available on ${model.key}`);
  return action;
}

function actionSchema(model: DiscoveryModel, actionKey: string): AgentToolSchema {
  const action = selectedAction(model, actionKey);
  const properties: Record<string, JsonSchema> = {
    [RECORD_ID]: { type: 'string', minLength: 1, description: 'Stable LifeSpace record ID on which to execute the Action.' },
  };
  const required = [RECORD_ID];
  for (const field of action.input.fields) {
    properties[field.key] = fieldSchema(field);
    if (field.required) required.push(field.key);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

function requiredAccess(config: AgentToolConfig, model: DiscoveryModel): 'read' | 'write' | 'manage' {
  if (config.operation === 'query') return 'read';
  if (config.operation === 'action') return selectedAction(model, text(config.actionKey)).access;
  return 'write';
}

function ensureConfiguredAccess(model: DiscoveryModel, config: AgentToolConfig): void {
  const required = requiredAccess(config, model);
  if (!model.access.includes(required)) {
    throw new Error(`LifeSpace ${model.key} does not expose ${required} access in Space ${config.spaceId}`);
  }
}

function toolSchema(model: DiscoveryModel, config: AgentToolConfig): AgentToolSchema {
  if (config.operation === 'query') {
    if (config.queryMode === 'capability') return capabilityQuerySchema(model, text(config.capabilityQueryKey));
    return genericQuerySchema(model);
  }
  if (config.operation === 'create') return mutationSchema(model, 'create');
  if (config.operation === 'update') return mutationSchema(model, 'update');
  if (config.operation === 'delete') return deleteSchema();
  return actionSchema(model, text(config.actionKey));
}

function operationNameParts(model: DiscoveryModel, config: AgentToolConfig): string[] {
  if (config.operation === 'action') return ['action', text(config.actionKey), model.key];
  if (config.operation === 'query' && config.queryMode === 'capability') {
    return ['query', model.key, text(config.capabilityQueryKey)];
  }
  return [config.operation, model.key];
}

function defaultDescription(model: DiscoveryModel, config: AgentToolConfig): string {
  const space = config.spaceName?.trim() || config.spaceId;
  const modelName = model.display.singular?.trim() || model.key;
  const modelDescription = model.description?.trim();
  let purpose: string;
  if (config.operation === 'query' && config.queryMode === 'capability') {
    const query = capabilityQuery(model, text(config.capabilityQueryKey));
    purpose = `Query ${model.display.plural || modelName} using LifeSpace semantic query ${query.key}: ${query.semantics}`;
  } else if (config.operation === 'query') {
    purpose = `Query ${model.display.plural || modelName} using the published LifeSpace query contract`;
  } else if (config.operation === 'create') {
    purpose = `Create a ${modelName} record`;
  } else if (config.operation === 'update') {
    purpose = `Update an existing ${modelName} record`;
  } else if (config.operation === 'delete') {
    purpose = `Delete an existing ${modelName} record`;
  } else {
    const action = selectedAction(model, text(config.actionKey));
    purpose = `Execute LifeSpace ${action.kind} Action "${action.key}" on a ${modelName} record`;
  }
  const timezone = config.viewingTimezone?.trim();
  const recordLookupHint = ['update', 'delete', 'action'].includes(config.operation)
    ? ' If the stable recordId is not already known, use the matching LifeSpace Query Tool first; never guess a record ID.'
    : '';
  const timezoneHint = timezone
    ? ` Interpret local/relative dates in workflow timezone ${timezone}; timed values must be absolute RFC3339 date-times.`
    : '';
  const calendarBinding = model.capabilityBindings?.calendar;
  const calendarRangeField = calendarBinding && 'rangeField' in calendarBinding
    ? calendarBinding.rangeField
    : null;
  const calendarAttendeeField = calendarBinding && 'attendeePersonField' in calendarBinding
    ? calendarBinding.attendeePersonField
    : null;
  const canonical = model.query.canonical;
  const hasCalendarWindow = Boolean(
    config.operation === 'query'
    && config.queryMode !== 'capability'
    && calendarRangeField
    && canonical?.filter.targets.some(
      (target) => target.field === calendarRangeField && target.operators.includes('overlaps'),
    ),
  );
  const searchFields = canonical?.search?.fields ?? [];
  const attendeeFilterAvailable = Boolean(
    calendarAttendeeField
    && canonical?.filter.targets.some(
      (target) => target.field === calendarAttendeeField && target.operators.includes('contains'),
    ),
  );
  const calendarExample = hasCalendarWindow && attendeeFilterAvailable
    ? ` Example date+attendee+chronological query: {"timeWindow":{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"},"filters":[{"field":"${calendarAttendeeField}","operator":"contains","value":{"name":"Person"}}],"sort":[{"field":"${calendarRangeField}","direction":"asc"}]}.`
    : '';
  const calendarQueryHint = hasCalendarWindow
    ? ` Calendar query guidance: use timeWindow for today/tomorrow/this week/date ranges; ${attendeeFilterAvailable ? `for a named attendee use filters with field "${calendarAttendeeField}", operator "contains", value {"name":"..."}; ` : ''}for chronological order sort by "${calendarRangeField}" directly. ${searchFields.length ? `Search matches only ${searchFields.join(', ')}${attendeeFilterAvailable ? ' and must not be used for attendee names' : ''}. ` : ''}Never invent nested sort paths such as "${calendarRangeField}.start" or "${calendarRangeField}.start.instant".${calendarExample}`
    : '';
  return `${purpose} in Space "${space}".${modelDescription ? ` ${modelDescription}` : ''} Use only when this configured operation and Space match the user's intent.${recordLookupHint}${timezoneHint}${calendarQueryHint}`;
}

export function buildAgentToolDefinition(model: DiscoveryModel, config: AgentToolConfig): LifeSpaceAgentToolDefinition {
  if (!text(config.spaceId)) throw new Error('LifeSpace Agent Tool requires a Space ID');
  ensureConfiguredAccess(model, config);
  const descriptionOverride = config.descriptionOverride?.trim();
  return {
    name: toolName(operationNameParts(model, config), config.spaceId),
    description: descriptionOverride || defaultDescription(model, config),
    schema: toolSchema(model, config),
    modelKey: model.key,
    operation: config.operation,
    ...(config.operation === 'action' ? { actionKey: text(config.actionKey) } : {}),
    ...(config.operation === 'query' && config.queryMode === 'capability'
      ? { capabilityQueryKey: text(config.capabilityQueryKey) }
      : {}),
  };
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() + 1 === Number(match[2])
    && parsed.getUTCDate() === Number(match[3]);
}

function validateValue(schema: JsonSchema, value: unknown, key: string): void {
  if (schema.oneOf?.length) {
    let matches = 0;
    for (const candidate of schema.oneOf) {
      try {
        validateValue(candidate, value, key);
        matches += 1;
      } catch {
        // Try the next published shape.
      }
    }
    if (matches !== 1) throw new Error(`${key} must match exactly one published shape`);
    return;
  }

  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  if (value === null) {
    if (!types.includes('null')) throw new Error(`${key} cannot be null`);
    return;
  }

  const type = types.find((entry) => entry !== 'null');
  if (type === 'string') {
    if (typeof value !== 'string') throw new Error(`${key} must be a string`);
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${key} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(`${key} is too long`);
    if (schema.format === 'date' && !validDate(value)) throw new Error(`${key} must be a YYYY-MM-DD date`);
    if (schema.format === 'date-time' && (!value.includes('T') || !Number.isFinite(Date.parse(value)))) {
      throw new Error(`${key} must be a valid RFC3339 date-time`);
    }
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number`);
  } else if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${key} must be an integer`);
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
  } else if (type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${key} contains too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${key} contains too many items`);
    if (schema.items) value.forEach((entry, index) => validateValue(schema.items!, entry, `${key}[${index}]`));
  } else if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${key} must be an object`);
    const input = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!hasOwn(input, required) || input[required] === undefined) throw new Error(`${key} requires ${required}`);
    }
    for (const [property, entry] of Object.entries(input)) {
      const propertySchema = schema.properties?.[property];
      if (!propertySchema) {
        if (schema.additionalProperties === false) throw new Error(`${key} contains unknown property ${property}`);
        continue;
      }
      validateValue(propertySchema, entry, `${key}.${property}`);
    }
  }

  if (schema.enum && !schema.enum.includes(value as never)) throw new Error(`${key} must be one of the published values`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${key} is below the minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`${key} is above the maximum`);
  }
}


export function validateAgentToolInput(schema: AgentToolSchema, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('LifeSpace Tool input must be an object');
  const result: Record<string, unknown> = {};
  for (const key of schema.required ?? []) {
    if (!hasOwn(input, key) || (input as Record<string, unknown>)[key] === undefined) throw new Error(`LifeSpace Tool input requires ${key}`);
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined) continue;
    const propertySchema = schema.properties[key];
    if (!propertySchema) throw new Error(`LifeSpace Tool input contains unknown property ${key}`);
    validateValue(propertySchema, value, key);
    result[key] = value;
  }
  for (const [key, dependencies] of Object.entries(schema.dependentRequired ?? {})) {
    if (!hasOwn(result, key)) continue;
    for (const dependency of dependencies) {
      if (!hasOwn(result, dependency)) throw new Error(`${key} requires ${dependency}`);
    }
  }
  return result;
}

function collectionPath(model: DiscoveryModel, config: AgentToolConfig): string {
  return `/spaces/${encodeURIComponent(config.spaceId)}/models/${encodeURIComponent(model.key)}/records`;
}

function recordPath(model: DiscoveryModel, config: AgentToolConfig, input: Record<string, unknown>): string {
  const recordId = text(input[RECORD_ID]);
  if (!recordId) throw new Error('LifeSpace Tool input requires recordId');
  return `${collectionPath(model, config)}/${encodeURIComponent(recordId)}`;
}

function queryRequest(model: DiscoveryModel, config: AgentToolConfig, input: Record<string, unknown>): AgentToolRequest {
  if (model.query.canonical && config.queryMode !== 'capability') {
    return {
      method: 'POST',
      path: canonicalQueryPath(model, config.spaceId),
      body: compileGenericQuery(model, input, config.viewingTimezone),
    };
  }
  const qs: NonNullable<AgentToolRequest['qs']> = {};
  const schema = toolSchema(model, config);
  const validated = validateAgentToolInput(schema, input);
  const query = config.queryMode === 'capability' ? capabilityQuery(model, text(config.capabilityQueryKey)) : null;
  const enumSetParameters = new Set<string>();
  if (!query) {
    for (const filter of model.query.filters ?? []) {
      if (filter.mode === 'enum-set') enumSetParameters.add(filter.parameter);
    }
  }

  for (const [key, value] of Object.entries(validated)) {
    if (Array.isArray(value)) {
      if (enumSetParameters.has(key)) {
        qs[key] = value.map(String).join(',');
      } else {
        qs[key] = value as Array<string | number | boolean>;
      }
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      qs[key] = value;
    } else if (value !== null) {
      throw new Error(`LifeSpace query property ${key} must be scalar or an allowed array`);
    }
  }
  return {
    method: 'GET',
    path: collectionPath(model, config),
    qs,
    repeatQueryArrays: Object.values(qs).some(Array.isArray),
  };
}

function semanticBody(
  schema: AgentToolSchema,
  input: Record<string, unknown>,
  fields: DiscoveryField[],
  excluded: string[] = [],
): Record<string, unknown> {
  const validated = validateAgentToolInput(schema, input);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(validated)) {
    if (excluded.includes(key) || value === undefined) continue;
    const field = byKey.get(key);
    result[key] = field ? normalizeTemporalRange(field, value) : value;
  }
  return result;
}

function preflightCanonicalQueryInput(model: DiscoveryModel, input: unknown): void {
  const canonical = model.query.canonical;
  if (!canonical || !input || typeof input !== 'object' || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  const calendarBinding = model.capabilityBindings?.calendar;
  const calendarRangeField = calendarBinding && 'rangeField' in calendarBinding ? calendarBinding.rangeField : null;

  if (Array.isArray(value.sort)) {
    for (const rawSort of value.sort) {
      if (!rawSort || typeof rawSort !== 'object' || Array.isArray(rawSort)) continue;
      const sort = rawSort as Record<string, unknown>;
      const field = String(sort.field ?? '');
      const direction = String(sort.direction ?? '');
      if (field && !canonical.sort.fields.includes(field)) {
        const hint = calendarRangeField && canonical.sort.fields.includes(calendarRangeField)
          ? `For chronological calendar ordering, use field "${calendarRangeField}" directly with direction "asc" or "desc". Do not construct nested paths.`
          : `Use one of the published sort fields: ${canonical.sort.fields.join(', ')}.`;
        queryFailure({
          code: 'INVALID_QUERY_SORT',
          message: `LifeSpace query does not allow sort field "${field}".`,
          field,
          allowedFields: [...canonical.sort.fields],
          hint,
        });
      }
      if (direction && !canonical.sort.directions.includes(direction as 'asc' | 'desc')) {
        queryFailure({
          code: 'INVALID_QUERY_SORT_DIRECTION',
          message: `LifeSpace query does not allow sort direction "${direction}".`,
          field: field || undefined,
          allowedFields: [...canonical.sort.directions],
          hint: `Use one of the published sort directions: ${canonical.sort.directions.join(', ')}.`,
        });
      }
    }
  }

  if (Array.isArray(value.filters)) {
    for (const rawFilter of value.filters) {
      if (!rawFilter || typeof rawFilter !== 'object' || Array.isArray(rawFilter)) continue;
      const filter = rawFilter as Record<string, unknown>;
      const field = String(filter.field ?? '');
      const operator = String(filter.operator ?? filter.op ?? '');
      const target = canonical.filter.targets.find((entry) => entry.field === field);
      if (field && !target) {
        const allowedFields = canonical.filter.targets.map((entry) => entry.field);
        queryFailure({
          code: 'INVALID_QUERY_FILTER_FIELD',
          message: `LifeSpace query does not allow filter field "${field}".`,
          field,
          allowedFields,
          hint: `Use one of the published filter fields: ${allowedFields.join(', ')}.`,
        });
      }
      if (target && operator && !target.operators.includes(operator)) {
        queryFailure({
          code: 'INVALID_QUERY_FILTER_OPERATOR',
          message: `LifeSpace query does not allow operator "${operator}" for field "${field}".`,
          field,
          operator,
          allowedOperators: [...target.operators],
          hint: `Use one of the published operators for "${field}": ${target.operators.join(', ')}.`,
        });
      }
    }
  }
}

export function buildAgentToolRequest(
  model: DiscoveryModel,
  config: AgentToolConfig,
  input: unknown,
  currentVersion?: number,
): AgentToolRequest {
  if (config.operation === 'query' && model.query.canonical && config.queryMode !== 'capability') {
    preflightCanonicalQueryInput(model, input);
  }
  const schema = toolSchema(model, config);
  const validated = validateAgentToolInput(schema, input);

  if (config.operation === 'query') return queryRequest(model, config, validated);
  if (config.operation === 'create') {
    return { method: 'POST', path: collectionPath(model, config), body: semanticBody(schema, validated, mutationFields(model, 'create')) };
  }

  const path = recordPath(model, config, validated);
  if (config.operation === 'update') {
    const body = semanticBody(schema, validated, mutationFields(model, 'update'), [RECORD_ID]);
    if (!Object.keys(body).length) throw new Error('LifeSpace Update requires at least one field to change');
    if (currentVersion === undefined) return { method: 'PATCH', path, body, needsCurrentVersion: true, versionParameter: 'version' };
    return { method: 'PATCH', path, body: { ...body, version: currentVersion } };
  }
  if (config.operation === 'delete') {
    if (currentVersion === undefined) return { method: 'DELETE', path, needsCurrentVersion: true, versionParameter: 'version' };
    return { method: 'DELETE', path, body: { version: currentVersion } };
  }

  const action = selectedAction(model, text(config.actionKey));
  if (!action.concurrency || action.concurrency.strategy !== 'record-version' || action.concurrency.transport.in !== 'body') {
    throw new Error(`LifeSpace Action ${action.key} uses an unsupported concurrency contract`);
  }
  const actionPath = `${path}/actions/${encodeURIComponent(action.key)}`;
  const body = semanticBody(schema, validated, action.input.fields, [RECORD_ID]);
  if (currentVersion === undefined) {
    return {
      method: 'POST',
      path: actionPath,
      body,
      needsCurrentVersion: true,
      versionParameter: action.concurrency.transport.name,
    };
  }
  return {
    method: 'POST',
    path: actionPath,
    body: { ...body, [action.concurrency.transport.name]: currentVersion },
  };
}
