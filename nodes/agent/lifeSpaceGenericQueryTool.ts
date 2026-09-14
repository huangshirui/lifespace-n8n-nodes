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

function scalarValueSchema(field: DiscoveryField | undefined, target: DiscoveryCanonicalFilterTarget): JsonSchema {
  if (field?.values?.length) return { type: 'string', enum: [...field.values] };
  const type = target.valueType;
  if (type === 'integer') return { type: 'integer' };
  if (type === 'number') return { type: 'number' };
  if (type === 'boolean') return { type: 'boolean' };
  if (type === 'date') return { type: 'string', format: 'date' };
  if (type === 'datetime') return { type: 'string', format: 'date-time' };
  return { type: 'string', minLength: 1 };
}

function localDateWindowSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['local_date_window'] },
      startDate: { type: 'string', format: 'date' },
      endDateExclusive: { type: 'string', format: 'date' },
      timezone: { type: 'string', minLength: 1, description: 'IANA timezone' },
    },
    required: ['kind', 'startDate', 'endDateExclusive', 'timezone'],
    additionalProperties: false,
  };
}

function rangeValueSchema(target: DiscoveryCanonicalFilterTarget): JsonSchema {
  const branches: JsonSchema[] = [localDateWindowSchema()];
  if (target.valueType === 'date' || target.valueType === 'date-range' || target.valueType === 'temporal-range') {
    branches.push({
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['date'] },
        start: { type: 'string', format: 'date' },
        endExclusive: { type: 'string', format: 'date' },
      },
      required: ['kind', 'start', 'endExclusive'],
      additionalProperties: false,
    });
  }
  if (target.valueType === 'datetime' || target.valueType === 'instant-range' || target.valueType === 'temporal-range') {
    branches.push({
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['instant'] },
        start: { type: 'string', format: 'date-time' },
        endExclusive: { type: 'string', format: 'date-time' },
      },
      required: ['kind', 'start', 'endExclusive'],
      additionalProperties: false,
    });
  }
  return { oneOf: branches };
}

function filterBranch(model: DiscoveryModel, target: DiscoveryCanonicalFilterTarget, operator: string): JsonSchema {
  const field = model.fields.find((entry) => entry.key === target.field);
  const properties: Record<string, JsonSchema> = {
    field: { type: 'string', enum: [target.field] },
    operator: { type: 'string', enum: [operator] },
  };
  const required = ['field', 'operator'];
  if (operator !== 'isNull' && operator !== 'isNotNull') {
    const rangeOperator = ['within', 'overlaps', 'before', 'after'].includes(operator)
      || (operator === 'contains' && ['date-range', 'instant-range', 'temporal-range'].includes(target.valueType));
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
      description: 'Canonical LifeSpace predicates combined with AND.',
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

function predicate(model: DiscoveryModel, raw: unknown): CanonicalPredicate {
  const input = asObject(raw);
  const field = String(input.field ?? '');
  const op = String(input.operator ?? input.op ?? '');
  const target = descriptor(model).filter.targets.find((entry) => entry.field === field);
  if (!target?.operators.includes(op)) throw new Error(`LifeSpace query does not allow ${field} ${op}`);
  if (op === 'isNull' || op === 'isNotNull') return { field, op };
  if (input.value === undefined || input.value === null) throw new Error(`${field} ${op} requires a value`);
  return { field, op, value: input.value };
}

export function compileGenericQuery(model: DiscoveryModel, input: unknown): Record<string, unknown> {
  const canonical = descriptor(model);
  const value = asObject(input);
  const result: Record<string, unknown> = {};

  if (value.search !== undefined) {
    if (!canonical.search || typeof value.search !== 'string') {
      throw new Error('LifeSpace search is not available for this Record Type');
    }
    result.search = { text: value.search };
  }

  const filters = (Array.isArray(value.filters) ? value.filters : []).map((entry) => predicate(model, entry));
  if (filters.length === 1) result.filter = filters[0];
  if (filters.length > 1) result.filter = { and: filters };

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
