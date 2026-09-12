import type { DiscoveryField, DiscoveryModel } from '../lifespaceDiscovery';
import { localDateWindows } from '../shared/lifeSpaceLocalDateSemantics';
import { queryPredicates, type QueryPredicate } from '../shared/lifeSpaceQuerySemantics';

export type JsonSchema = {
  type?: string;
  description?: string;
  enum?: Array<string | number | boolean>;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
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

function valueSchema(field: DiscoveryField | undefined, predicate: QueryPredicate): JsonSchema {
  if (predicate.mode === 'enum-set' && predicate.enumValues?.length) {
    return {
      type: 'array',
      items: { type: 'string', enum: [...predicate.enumValues] },
      minItems: 1,
      description: `Values for ${predicate.fieldLabel}.`,
    };
  }
  if (predicate.enumValues?.length) {
    return { type: 'string', enum: [...predicate.enumValues], description: predicate.fieldLabel };
  }
  const type = predicate.valueType;
  if (type === 'integer') return { type: 'integer', description: predicate.fieldLabel };
  if (type === 'number') return { type: 'number', description: predicate.fieldLabel };
  if (type === 'boolean') return { type: 'boolean', description: predicate.fieldLabel };
  if (type === 'date') return { type: 'string', format: 'date', description: predicate.fieldLabel };
  if (type === 'datetime') return { type: 'string', format: 'date-time', description: predicate.fieldLabel };
  if (type === 'person_list' || type === 'record_list') {
    return { type: 'array', items: { type: 'string' }, minItems: 1, description: predicate.fieldLabel };
  }
  return {
    type: 'string',
    description: field?.description?.trim() || predicate.fieldLabel,
  };
}

function filterBranch(model: DiscoveryModel, predicate: QueryPredicate): JsonSchema {
  const field = model.fields.find((entry) => entry.key === predicate.field);
  return {
    type: 'object',
    properties: {
      field: { type: 'string', enum: [predicate.field] },
      operator: { type: 'string', enum: [predicate.operator] },
      value: valueSchema(field, predicate),
    },
    required: ['field', 'operator', 'value'],
    additionalProperties: false,
  };
}

function localDateWindowBranches(model: DiscoveryModel): JsonSchema[] {
  return localDateWindows(model).map((window) => ({
    type: 'object',
    properties: {
      field: { type: 'string', enum: [window.field] },
      dateStart: { type: 'string', format: 'date' },
      dateEndExclusive: { type: 'string', format: 'date' },
      timezone: { type: 'string', minLength: 1, description: 'IANA timezone' },
    },
    required: ['field', 'dateStart', 'dateEndExclusive', 'timezone'],
    additionalProperties: false,
  }));
}

function sortBranches(model: DiscoveryModel): JsonSchema[] {
  return (model.query.sort.genericValues ?? []).map((value) => {
    const separator = value.lastIndexOf(':');
    const field = separator > 0 ? value.slice(0, separator) : value;
    const direction = separator > 0 ? value.slice(separator + 1) : 'asc';
    return {
      type: 'object',
      properties: {
        field: { type: 'string', enum: [field] },
        direction: { type: 'string', enum: [direction] },
      },
      required: ['field', 'direction'],
      additionalProperties: false,
    };
  });
}

export function genericQuerySchema(model: DiscoveryModel): GenericQuerySchema {
  const properties: Record<string, JsonSchema> = {};
  if (model.query.search) {
    properties.search = {
      type: 'string',
      minLength: model.query.search.minLength,
      description: `Full-text search across ${model.query.searchable.join(', ')}.`,
    };
  }

  const predicates = queryPredicates(model);
  if (predicates.length) {
    properties.filters = {
      type: 'array',
      items: { oneOf: predicates.map((predicate) => filterBranch(model, predicate)) },
      description: 'Semantic LifeSpace filters. Choose only field/operator pairs listed by the schema.',
    };
  }

  const windows = localDateWindowBranches(model);
  if (windows.length) {
    properties.localDateWindows = {
      type: 'array',
      items: { oneOf: windows },
      description: 'Local calendar windows. LifeSpace Core owns timezone and DST conversion.',
    };
  }

  const sorts = sortBranches(model);
  if (sorts.length) {
    properties.sort = {
      type: 'array',
      items: { oneOf: sorts },
      maxItems: model.query.sort.maxCriteria,
      description: 'Ordered sort criteria.',
    };
  }

  properties.limit = {
    type: 'integer',
    minimum: model.query.pagination.limit.minimum,
    maximum: model.query.pagination.limit.maximum,
    description: 'Maximum records to return.',
  };
  properties.cursor = { type: 'string', minLength: 1, description: 'Opaque pagination cursor.' };

  return { type: 'object', properties, additionalProperties: false };
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('LifeSpace query input must be an object');
  return input as Record<string, unknown>;
}

function predicateFor(model: DiscoveryModel, field: string, operator: string): QueryPredicate {
  const predicate = queryPredicates(model).find((entry) => entry.field === field && entry.operator === operator);
  if (!predicate) throw new Error(`LifeSpace query does not allow ${field} ${operator}`);
  return predicate;
}

export function compileGenericQuery(model: DiscoveryModel, input: unknown): Record<string, string | number | boolean | Array<string>> {
  const value = asObject(input);
  const qs: Record<string, string | number | boolean | Array<string>> = {};

  if (value.search !== undefined) {
    if (!model.query.search || typeof value.search !== 'string') throw new Error('LifeSpace search is not available for this Record Type');
    qs[model.query.search.parameter] = value.search;
  }

  for (const raw of Array.isArray(value.filters) ? value.filters : []) {
    const filter = asObject(raw);
    const field = String(filter.field ?? '');
    const operator = String(filter.operator ?? '');
    const predicate = predicateFor(model, field, operator);
    const filterValue = filter.value;
    if (filterValue === undefined || filterValue === null) throw new Error(`${field} ${operator} requires a value`);
    if (predicate.mode === 'enum-set') {
      if (!Array.isArray(filterValue) || filterValue.length === 0) throw new Error(`${field} ${operator} requires one or more values`);
      qs[predicate.parameter] = filterValue.map(String).join(',');
    } else if (Array.isArray(filterValue)) {
      qs[predicate.parameter] = filterValue.map(String);
    } else if (typeof filterValue === 'string' || typeof filterValue === 'number' || typeof filterValue === 'boolean') {
      qs[predicate.parameter] = filterValue;
    } else {
      throw new Error(`${field} ${operator} has an unsupported value`);
    }
  }

  const windows = localDateWindows(model);
  for (const raw of Array.isArray(value.localDateWindows) ? value.localDateWindows : []) {
    const windowInput = asObject(raw);
    const field = String(windowInput.field ?? '');
    const window = windows.find((entry) => entry.field === field);
    if (!window) throw new Error(`LifeSpace local-date window is not available for ${field}`);
    qs[window.dateStartParameter] = String(windowInput.dateStart ?? '');
    qs[window.dateEndExclusiveParameter] = String(windowInput.dateEndExclusive ?? '');
    qs[window.timezoneParameter] = String(windowInput.timezone ?? '');
  }

  if (Array.isArray(value.sort) && value.sort.length) {
    const allowed = new Set(model.query.sort.genericValues ?? []);
    const sorts = value.sort.map((raw) => {
      const sort = asObject(raw);
      const encoded = `${String(sort.field ?? '')}:${String(sort.direction ?? '')}`;
      if (!allowed.has(encoded)) throw new Error(`LifeSpace sort does not allow ${encoded}`);
      return encoded;
    });
    qs[model.query.sort.parameter] = sorts;
  }

  if (value.limit !== undefined) qs[model.query.pagination.limit.parameter] = Number(value.limit);
  if (value.cursor !== undefined) qs[model.query.pagination.cursor.parameter] = String(value.cursor);
  return qs;
}
