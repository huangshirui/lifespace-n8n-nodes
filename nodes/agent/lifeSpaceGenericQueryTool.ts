import type {
  DiscoveryCanonicalFilterTarget,
  DiscoveryField,
  DiscoveryModel,
} from '../lifespaceDiscovery';

export type JsonSchema = {
  type?: string;
  description?: string;
  enum?: Array<string | number | boolean>;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  oneOf?: JsonSchema[];
};

export type GenericQuerySchema = JsonSchema & {
  type: 'object';
  properties: Record<string, JsonSchema>;
  additionalProperties: false;
};

type CanonicalPredicate = {
  field: string;
  op: string;
  value?: unknown;
};

function descriptor(model: DiscoveryModel) {
  if (!model.query.canonical) {
    throw new Error(`LifeSpace model ${model.key} does not publish query.canonical; Core Kernel 0.36.0 or newer is required`);
  }
  return model.query.canonical;
}

function referenceValueSchema(field: DiscoveryField, target: DiscoveryCanonicalFilterTarget): JsonSchema {
  const reference: JsonSchema = {
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
  if (target.acceptsCurrentActorPersonAlias === 'me' && ['person', 'person_list'].includes(field.type)) {
    reference.description = 'Reference by name or stable ID. The string "me" means the current actor Person.';
  } else {
    reference.description = 'Reference by {"name":"..."} when the user supplies a label, or by {"id":"..."} / stable ID when already known.';
  }
  return reference;
}

function scalarValueSchema(field: DiscoveryField | undefined, target: DiscoveryCanonicalFilterTarget): JsonSchema {
  if (field && ['person', 'person_list', 'record', 'record_list'].includes(field.type)) {
    return referenceValueSchema(field, target);
  }
  if (field?.values?.length) return { type: 'string', enum: [...field.values] };
  const type = target.valueType;
  if (type === 'integer') return { type: 'integer' };
  if (type === 'number') return { type: 'number' };
  if (type === 'boolean') return { type: 'boolean' };
  if (type === 'date') return { type: 'string', format: 'date' };
  if (type === 'instant' || type === 'datetime') return { type: 'string', format: 'date-time' };
  return { type: 'string', minLength: 1 };
}

function localDateWindowSchemas(): JsonSchema[] {
  return [
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['local_date_window'] },
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date', description: 'Inclusive human end date.' },
      },
      required: ['kind', 'startDate', 'endDate'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['local_date_window'] },
        startDate: { type: 'string', format: 'date' },
        endDateExclusive: { type: 'string', format: 'date' },
        timezone: { type: 'string', minLength: 1, description: 'IANA timezone' },
      },
      required: ['kind', 'startDate', 'endDateExclusive', 'timezone'],
      additionalProperties: false,
    },
  ];
}

function rangeValueSchema(target: DiscoveryCanonicalFilterTarget): JsonSchema {
  const branches: JsonSchema[] = localDateWindowSchemas();
  const valueType = String(target.valueType);
  if (['date', 'date-range', 'range<date>', 'temporal-range', 'temporal_range'].includes(valueType)) {
    branches.push(
      {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['date'] },
          start: { type: 'string', format: 'date' },
          end: { type: 'string', format: 'date', description: 'Inclusive human end date.' },
        },
        required: ['kind', 'start', 'end'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['date'] },
          start: { type: 'string', format: 'date' },
          endExclusive: { type: 'string', format: 'date' },
        },
        required: ['kind', 'start', 'endExclusive'],
        additionalProperties: false,
      },
    );
  }
  if (['instant', 'datetime', 'instant-range', 'range<instant>', 'temporal-range', 'temporal_range'].includes(valueType)) {
    branches.push(
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
      {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['instant'] },
          start: { type: 'string', format: 'date-time' },
          endExclusive: { type: 'string', format: 'date-time' },
        },
        required: ['kind', 'start', 'endExclusive'],
        additionalProperties: false,
      },
    );
  }
  return { oneOf: branches };
}

function nextDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) throw new Error(`Invalid date ${date}`);
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return next.toISOString().slice(0, 10);
}

function asRangeObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be a range object`);
  return value as Record<string, unknown>;
}

function normalizeRangeValue(
  target: DiscoveryCanonicalFilterTarget,
  raw: unknown,
  viewingTimezone?: string,
): Record<string, unknown> {
  const value = asRangeObject(raw, `${target.field}.value`);
  const kind = String(value.kind ?? '');
  if (kind === 'local_date_window') {
    const startDate = String(value.startDate ?? '');
    const endDateExclusive = value.endDateExclusive !== undefined
      ? String(value.endDateExclusive)
      : nextDate(String(value.endDate ?? ''));
    const timezone = String(value.timezone ?? viewingTimezone ?? '').trim();
    if (!timezone) throw new Error(`${target.field} local_date_window requires a viewing timezone`);
    return { kind, startDate, endDateExclusive, timezone };
  }

  const start = String(value.start ?? '');
  if (kind === 'date') {
    const endExclusive = value.endExclusive !== undefined
      ? String(value.endExclusive)
      : nextDate(String(value.end ?? ''));
    if (endExclusive <= start) throw new Error(`${target.field} date range end must be after start`);
    return { kind, start, endExclusive };
  }
  if (kind === 'instant') {
    const endExclusive = String(value.endExclusive ?? value.end ?? '');
    if (Date.parse(endExclusive) <= Date.parse(start)) {
      throw new Error(`${target.field} instant range end must be after start`);
    }
    return { kind, start, endExclusive };
  }
  throw new Error(`${target.field} range kind is invalid`);
}

function filterBranch(model: DiscoveryModel, target: DiscoveryCanonicalFilterTarget, operator: string): JsonSchema {
  const field = model.fields.find((entry) => entry.key === target.field);
  const properties: Record<string, JsonSchema> = {
    field: { type: 'string', enum: [target.field] },
    operator: { type: 'string', enum: [operator] },
  };
  const required = ['field', 'operator'];
  if (operator !== 'isNull' && operator !== 'isNotNull') {
    const valueType = String(target.valueType);
    const rangeOperator = ['within', 'overlaps', 'before', 'after'].includes(operator)
      || (operator === 'contains' && ['date-range', 'instant-range', 'range<date>', 'range<instant>', 'temporal-range', 'temporal_range'].includes(valueType));
    properties.value = rangeOperator
      ? rangeValueSchema(target)
      : operator === 'kindIs'
        ? { type: 'string', enum: ['date', 'instant'] }
        : scalarValueSchema(field, target);
    required.push('value');
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

function sortBranches(model: DiscoveryModel): JsonSchema[] {
  const canonical = descriptor(model);
  return canonical.sort.fields.flatMap((field) => canonical.sort.directions.map((direction) => ({
    type: 'object',
    properties: {
      field: { type: 'string', enum: [field] },
      direction: { type: 'string', enum: [direction] },
    },
    required: ['field', 'direction'],
    additionalProperties: false,
  })));
}

export function genericQuerySchema(model: DiscoveryModel): GenericQuerySchema {
  const canonical = descriptor(model);
  const properties: Record<string, JsonSchema> = {};
  if (canonical.search) {
    properties.search = {
      type: 'string',
      minLength: canonical.search.minLength,
      maxLength: canonical.search.maxLength,
      description: `Full-text search across ${canonical.search.fields.join(', ')}.`,
    };
  }

  const branches = canonical.filter.targets.flatMap((target) =>
    target.operators.map((operator) => filterBranch(model, target, operator)));
  if (branches.length) {
    properties.filters = {
      type: 'array',
      items: { oneOf: branches },
      maxItems: canonical.filter.maxNodes,
      description: 'LifeSpace predicates. Use match=all for AND or match=any for OR.',
    };
    properties.match = {
      type: 'string',
      enum: ['all', 'any'],
      description: 'How multiple filters combine. Defaults to all (AND).',
    };
  }

  const sorts = sortBranches(model);
  if (sorts.length) {
    properties.sort = {
      type: 'array',
      items: { oneOf: sorts },
      maxItems: canonical.sort.maxCriteria,
      description: 'Ordered canonical sort criteria.',
    };
  }

  properties.limit = {
    type: 'integer',
    minimum: canonical.pagination.limit.minimum,
    maximum: canonical.pagination.limit.maximum,
    description: 'Maximum records to return.',
  };
  properties.cursor = { type: 'string', minLength: 1, description: 'Opaque pagination cursor.' };
  return { type: 'object', properties, additionalProperties: false };
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('LifeSpace query input must be an object');
  return input as Record<string, unknown>;
}

function predicate(model: DiscoveryModel, raw: unknown, viewingTimezone?: string): CanonicalPredicate {
  const input = asObject(raw);
  const field = String(input.field ?? '');
  const op = String(input.operator ?? input.op ?? '');
  const target = descriptor(model).filter.targets.find((entry) => entry.field === field);
  if (!target?.operators.includes(op)) throw new Error(`LifeSpace query does not allow ${field} ${op}`);
  if (op === 'isNull' || op === 'isNotNull') return { field, op };
  if (input.value === undefined || input.value === null) throw new Error(`${field} ${op} requires a value`);
  const valueType = String(target.valueType);
  const rangeOperator = ['within', 'overlaps', 'before', 'after'].includes(op)
    || (op === 'contains' && ['date-range', 'instant-range', 'range<date>', 'range<instant>', 'temporal-range', 'temporal_range'].includes(valueType));
  return {
    field,
    op,
    value: rangeOperator ? normalizeRangeValue(target, input.value, viewingTimezone) : input.value,
  };
}

export function compileGenericQuery(model: DiscoveryModel, input: unknown, viewingTimezone?: string): Record<string, unknown> {
  const canonical = descriptor(model);
  const value = asObject(input);
  const result: Record<string, unknown> = {};

  if (value.search !== undefined) {
    if (!canonical.search || typeof value.search !== 'string') {
      throw new Error('LifeSpace search is not available for this Record Type');
    }
    result.search = { text: value.search };
  }

  const filters = (Array.isArray(value.filters) ? value.filters : [])
    .map((entry) => predicate(model, entry, viewingTimezone));
  if (filters.length === 1) result.filter = filters[0];
  if (filters.length > 1) {
    result.filter = String(value.match ?? 'all') === 'any' ? { or: filters } : { and: filters };
  }

  if (Array.isArray(value.sort) && value.sort.length) {
    const used = new Set<string>();
    result.sort = value.sort.map((raw) => {
      const sort = asObject(raw);
      const field = String(sort.field ?? '');
      const direction = String(sort.direction ?? '');
      if (!canonical.sort.fields.includes(field) || !canonical.sort.directions.includes(direction as 'asc' | 'desc')) {
        throw new Error(`LifeSpace sort does not allow ${field}:${direction}`);
      }
      if (used.has(field)) throw new Error(`LifeSpace sort field ${field} may be supplied only once`);
      used.add(field);
      return { field, direction };
    });
    const temporalFields = new Set(
      model.fields.filter((field) => field.type === 'temporal_range').map((field) => field.key),
    );
    if ((result.sort as Array<{ field: string }>).some((sort) => temporalFields.has(sort.field))) {
      const timezone = String(viewingTimezone ?? '').trim();
      if (!timezone) throw new Error('TemporalRange sorting requires the n8n workflow timezone');
      result.context = { viewingTimezone: timezone };
    }
  }

  const page: Record<string, unknown> = {};
  if (value.limit !== undefined) page.limit = Number(value.limit);
  if (value.cursor !== undefined) page.cursor = String(value.cursor);
  if (Object.keys(page).length) result.page = page;
  return result;
}

export function canonicalQueryPath(model: DiscoveryModel, spaceId: string): string {
  const template = descriptor(model).invocation.pathTemplate;
  return template
    .replace('{spaceId}', encodeURIComponent(spaceId))
    .replace('{modelKey}', encodeURIComponent(model.key))
    .replace(/^\/api\/v1(?=\/)/u, '');
}
