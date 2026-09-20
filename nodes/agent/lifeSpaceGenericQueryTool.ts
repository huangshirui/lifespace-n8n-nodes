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

function calendarTimeWindowTarget(
  model: DiscoveryModel,
): { field: DiscoveryField; target: DiscoveryCanonicalFilterTarget } | null {
  const binding = model.capabilityBindings?.calendar;
  if (!binding || !('rangeField' in binding)) return null;

  const field = model.fields.find((entry) => entry.key === binding.rangeField);
  const target = descriptor(model).filter.targets.find(
    (entry) => entry.field === binding.rangeField && entry.operators.includes('overlaps'),
  );
  if (!field || field.type !== 'temporal_range' || !target) return null;
  return { field, target };
}

function calendarAttendeeTarget(
  model: DiscoveryModel,
): { field: DiscoveryField; target: DiscoveryCanonicalFilterTarget } | null {
  const binding = model.capabilityBindings?.calendar;
  if (!binding || !('attendeePersonField' in binding) || !binding.attendeePersonField) return null;

  const field = model.fields.find((entry) => entry.key === binding.attendeePersonField);
  const target = descriptor(model).filter.targets.find(
    (entry) => entry.field === binding.attendeePersonField && entry.operators.includes('contains'),
  );
  if (!field || !['person', 'person_list'].includes(field.type) || !target) return null;
  return { field, target };
}

function searchDescription(model: DiscoveryModel): string {
  const canonical = descriptor(model);
  if (!canonical.search) return '';
  const fields = canonical.search.fields;
  let description = `Searches ${fields.join(', ')} only.`;
  const attendee = calendarAttendeeTarget(model);
  if (attendee && !fields.includes(attendee.field.key)) {
    description += ` Never attendee names; use ${attendee.field.key} contains {"name":"..."}.`;
  }
  return description;
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

function filterFieldDescription(field: DiscoveryField | undefined, target: DiscoveryCanonicalFilterTarget): string {
  return field?.description?.trim() || field?.title?.trim() || target.field;
}

function filterOperatorDescription(operators: string[]): string {
  if (operators.length === 1) {
    const [operator] = operators;
    if (operator === 'overlaps') return 'Range intersects the supplied range.';
    if (operator === 'contains') return 'Field/range contains the supplied value.';
    if (operator === 'before') return 'Range occurs before the supplied range.';
    if (operator === 'after') return 'Range occurs after the supplied range.';
    if (operator === 'kindIs') return 'TemporalRange kind: date (all-day) or instant (timed).';
    return `LifeSpace operator "${operator}".`;
  }
  return `Allowed range operators: ${operators.join(', ')}.`;
}

function calendarTimeWindowSchema(field: DiscoveryField): JsonSchema {
  const semantic = field.title?.trim() || field.key;
  return {
    type: 'object',
    description: `${semantic} calendar window for today/tomorrow/this week/date ranges. Inclusive local dates; workflow timezone; matches overlaps.`,
    properties: {
      startDate: { type: 'string', format: 'date' },
      endDate: { type: 'string', format: 'date', description: 'Inclusive.' },
    },
    required: ['startDate', 'endDate'],
    additionalProperties: false,
  };
}

function rangeValueSchema(target: DiscoveryCanonicalFilterTarget, includeLocalDateWindow: boolean): JsonSchema {
  const branches: JsonSchema[] = [];
  const valueType = String(target.valueType);
  if (includeLocalDateWindow) {
    branches.push({
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['local_date_window'] },
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date', description: 'Inclusive.' },
      },
      required: ['kind', 'startDate', 'endDate'],
      additionalProperties: false,
    });
  }
  if (['date', 'date-range', 'range<date>', 'temporal-range', 'temporal_range'].includes(valueType)) {
    branches.push({
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['date'] },
        start: { type: 'string', format: 'date' },
        end: { type: 'string', format: 'date', description: 'Inclusive.' },
      },
      required: ['kind', 'start', 'end'],
      additionalProperties: false,
    });
  }
  if (['instant', 'datetime', 'instant-range', 'range<instant>', 'temporal-range', 'temporal_range'].includes(valueType)) {
    branches.push({
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['instant'] },
        start: { type: 'string', format: 'date-time' },
        end: { type: 'string', format: 'date-time' },
      },
      required: ['kind', 'start', 'end'],
      additionalProperties: false,
    });
  }
  if (!branches.length) throw new Error(`LifeSpace range filter ${target.field} has unsupported value type ${valueType}`);
  return branches.length === 1 ? branches[0]! : { oneOf: branches };
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
    if (endDateExclusive <= startDate) {
      throw new Error(`${target.field} local date window end must be after start`);
    }
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

function isRangeOperator(target: DiscoveryCanonicalFilterTarget, operator: string): boolean {
  const valueType = String(target.valueType);
  return ['within', 'overlaps', 'before', 'after'].includes(operator)
    || (
      operator === 'contains'
      && ['date-range', 'instant-range', 'range<date>', 'range<instant>', 'temporal-range', 'temporal_range'].includes(valueType)
    );
}

function filterBranch(
  model: DiscoveryModel,
  target: DiscoveryCanonicalFilterTarget,
  operators: string[],
  valueSchema?: JsonSchema,
): JsonSchema {
  const field = model.fields.find((entry) => entry.key === target.field);
  const properties: Record<string, JsonSchema> = {
    field: {
      type: 'string',
      enum: [target.field],
      description: filterFieldDescription(field, target),
    },
    operator: {
      type: 'string',
      enum: operators,
      description: filterOperatorDescription(operators),
    },
  };
  const required = ['field', 'operator'];
  if (valueSchema) {
    properties.value = valueSchema;
    required.push('value');
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

function filterBranches(model: DiscoveryModel, target: DiscoveryCanonicalFilterTarget): JsonSchema[] {
  const field = model.fields.find((entry) => entry.key === target.field);
  const noValue = target.operators.filter((operator) => operator === 'isNull' || operator === 'isNotNull');
  const kind = target.operators.filter((operator) => operator === 'kindIs');
  const range = target.operators.filter((operator) => isRangeOperator(target, operator));
  const noValueSet = new Set<string>(noValue);
  const kindSet = new Set<string>(kind);
  const rangeSet = new Set<string>(range);
  const scalar = target.operators.filter(
    (operator) => !noValueSet.has(operator) && !kindSet.has(operator) && !rangeSet.has(operator),
  );
  const branches: JsonSchema[] = [];
  if (noValue.length) branches.push(filterBranch(model, target, noValue));
  if (range.length) {
    const calendarRangeField = calendarTimeWindowTarget(model)?.target.field;
    branches.push(filterBranch(
      model,
      target,
      range,
      rangeValueSchema(target, target.field !== calendarRangeField),
    ));
  }
  if (kind.length) branches.push(filterBranch(model, target, kind, { type: 'string', enum: ['date', 'instant'] }));
  if (scalar.length) branches.push(filterBranch(model, target, scalar, scalarValueSchema(field, target)));
  return branches;
}

function sortItemSchema(model: DiscoveryModel): JsonSchema {
  const canonical = descriptor(model);
  const calendar = calendarTimeWindowTarget(model);
  const temporalHint = calendar && canonical.sort.fields.includes(calendar.field.key)
    ? ` Chronological calendar order = "${calendar.field.key}". Never use nested paths.`
    : '';
  return {
    type: 'object',
    properties: {
      field: {
        type: 'string',
        enum: [...canonical.sort.fields],
        description: `Published sort field.${temporalHint}`,
      },
      direction: {
        type: 'string',
        enum: [...canonical.sort.directions],
        description: 'Sort direction for the selected published field.',
      },
    },
    required: ['field', 'direction'],
    additionalProperties: false,
  };
}

export function genericQuerySchema(model: DiscoveryModel): GenericQuerySchema {
  const canonical = descriptor(model);
  const properties: Record<string, JsonSchema> = {};
  if (canonical.search) {
    properties.search = {
      type: 'string',
      minLength: canonical.search.minLength,
      maxLength: canonical.search.maxLength,
      description: searchDescription(model),
    };
  }

  const calendarWindow = calendarTimeWindowTarget(model);
  if (calendarWindow) {
    properties.timeWindow = calendarTimeWindowSchema(calendarWindow.field);
  }

  const branches = canonical.filter.targets.flatMap((target) => filterBranches(model, target));
  if (branches.length) {
    properties.filters = {
      type: 'array',
      items: { oneOf: branches },
      maxItems: canonical.filter.maxNodes,
      description: 'Published predicates. match=all means AND; match=any means OR.',
    };
    properties.match = {
      type: 'string',
      enum: ['all', 'any'],
      description: 'Combine filters: all=AND (default), any=OR.',
    };
  }

  if (canonical.sort.fields.length && canonical.sort.directions.length) {
    properties.sort = {
      type: 'array',
      items: sortItemSchema(model),
      maxItems: canonical.sort.maxCriteria,
      description: 'Ordered sort. Use exact published field names only.',
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

function calendarTimeWindowPredicate(
  model: DiscoveryModel,
  raw: unknown,
  viewingTimezone?: string,
): CanonicalPredicate {
  const calendarWindow = calendarTimeWindowTarget(model);
  if (!calendarWindow) throw new Error('LifeSpace Calendar timeWindow is not available for this Record Type');

  const input = asObject(raw);
  const startDate = String(input.startDate ?? '');
  const endDate = String(input.endDate ?? '');
  if (!startDate || !endDate) throw new Error('LifeSpace timeWindow requires startDate and endDate');

  return {
    field: calendarWindow.target.field,
    op: 'overlaps',
    value: normalizeRangeValue(
      calendarWindow.target,
      { kind: 'local_date_window', startDate, endDate },
      viewingTimezone,
    ),
  };
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
  const selectionFilters: unknown[] = [];

  if (value.timeWindow !== undefined) {
    selectionFilters.push(calendarTimeWindowPredicate(model, value.timeWindow, viewingTimezone));
  }

  if (filters.length === 1) selectionFilters.push(filters[0]);
  if (filters.length > 1) {
    if (String(value.match ?? 'all') === 'any') selectionFilters.push({ or: filters });
    else selectionFilters.push(...filters);
  }

  if (selectionFilters.length === 1) result.filter = selectionFilters[0];
  if (selectionFilters.length > 1) result.filter = { and: selectionFilters };

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
