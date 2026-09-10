import type {
  DiscoveryAction,
  DiscoveryCapabilityQuery,
  DiscoveryComparison,
  DiscoveryField,
  DiscoveryModel,
} from '../lifespaceDiscovery';

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

const RECORD_ID = 'recordId';
const TOOL_NAME_MAX_LENGTH = 64;
const COMPARABLE_TYPES = new Set(['date', 'datetime', 'integer', 'number']);

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
    return `${base} Supply a stable LifeSpace record ID.`;
  }
  if (field.type === 'person_list' || field.type === 'record_list') {
    return `${base} Supply stable LifeSpace record IDs.`;
  }
  return base;
}

function scalarSchema(field: DiscoveryField): JsonSchema {
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
    case 'person_list':
    case 'record_list':
      schema = { type: 'array', items: { type: 'string', minLength: 1 } };
      break;
    case 'date':
      schema = { type: 'string', format: 'date' };
      break;
    case 'datetime':
      schema = { type: 'string', format: 'date-time' };
      break;
    case 'timezone':
      schema = { type: 'string', minLength: 1 };
      break;
    case 'string':
    case 'text':
    case 'person':
    case 'record':
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
  schema.description = fieldDescription(field);

  if (field.nullable === true) {
    return {
      description: schema.description,
      oneOf: [schema, { type: 'null' }],
    };
  }
  return schema;
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
    const schema = scalarSchema({ ...field, nullable: false });
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
    const schema = scalarSchema(field);
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
    properties[field.key] = scalarSchema(field);
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
  return `${purpose} in Space "${space}".${modelDescription ? ` ${modelDescription}` : ''} Use only when this configured operation and Space match the user's intent.`;
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

function schemaAllowsNull(schema: JsonSchema): boolean {
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true;
  return schema.oneOf?.some((entry) => entry.type === 'null') === true;
}

function validatePrimitive(schema: JsonSchema, value: unknown, key: string): void {
  if (value === null) {
    if (!schemaAllowsNull(schema)) throw new Error(`${key} cannot be null`);
    return;
  }
  if (schema.oneOf) {
    const candidates = schema.oneOf.filter((entry) => entry.type !== 'null');
    if (candidates.length === 1) return validatePrimitive(candidates[0], value, key);
  }
  const type = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== 'null') : schema.type;
  if (type === 'string') {
    if (typeof value !== 'string') throw new Error(`${key} must be a string`);
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${key} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(`${key} is too long`);
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
    if (schema.items) value.forEach((entry, index) => validatePrimitive(schema.items!, entry, `${key}[${index}]`));
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
    validatePrimitive(propertySchema, value, key);
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

function semanticBody(schema: AgentToolSchema, input: Record<string, unknown>, excluded: string[] = []): Record<string, unknown> {
  const validated = validateAgentToolInput(schema, input);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(validated)) {
    if (excluded.includes(key) || value === undefined) continue;
    result[key] = value;
  }
  return result;
}

export function buildAgentToolRequest(
  model: DiscoveryModel,
  config: AgentToolConfig,
  input: unknown,
  currentVersion?: number,
): AgentToolRequest {
  const schema = toolSchema(model, config);
  const validated = validateAgentToolInput(schema, input);

  if (config.operation === 'query') return queryRequest(model, config, validated);
  if (config.operation === 'create') {
    return { method: 'POST', path: collectionPath(model, config), body: semanticBody(schema, validated) };
  }

  const path = recordPath(model, config, validated);
  if (config.operation === 'update') {
    const body = semanticBody(schema, validated, [RECORD_ID]);
    if (currentVersion === undefined) return { method: 'PATCH', path, body, needsCurrentVersion: true, versionParameter: 'version' };
    return { method: 'PATCH', path, body: { ...body, version: currentVersion } };
  }
  if (config.operation === 'delete') {
    if (currentVersion === undefined) return { method: 'DELETE', path, needsCurrentVersion: true, versionParameter: 'version' };
    return { method: 'DELETE', path, body: { version: currentVersion } };
  }

  const action = selectedAction(model, text(config.actionKey));
  const body = semanticBody(schema, validated, [RECORD_ID]);
  if (!action.concurrency?.required) {
    return { method: 'POST', path: `${path}/actions/${encodeURIComponent(action.key)}`, body };
  }
  const concurrency = action.concurrency;
  if (concurrency.strategy !== 'record-version' || concurrency.transport.in !== 'body' || !concurrency.transport.name) {
    throw new Error(`LifeSpace Action ${action.key} uses an unsupported concurrency contract`);
  }
  if (currentVersion === undefined) {
    return {
      method: 'POST',
      path: `${path}/actions/${encodeURIComponent(action.key)}`,
      body,
      needsCurrentVersion: true,
      versionParameter: concurrency.transport.name,
    };
  }
  return {
    method: 'POST',
    path: `${path}/actions/${encodeURIComponent(action.key)}`,
    body: { ...body, [concurrency.transport.name]: currentVersion },
  };
}
