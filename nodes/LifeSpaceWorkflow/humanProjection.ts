import type {
  FieldType,
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodePropertyOptions,
  ResourceMapperField,
  ResourceMapperFields,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
  decodeRecordTypeSelector,
  discoveryModel,
  loadOptionParameter,
  loadRelationTargets,
  loadRuntimeDiscovery,
  type DiscoveryField,
  type DiscoveryModel,
  type RelationTarget,
} from '../lifespaceDiscovery';
import {
  mutationFieldSelector,
  parseMutationFieldSelector,
  writableMutationFields,
} from '../shared/lifeSpaceAdapterSemantics';
import {
  parseQueryPredicateSelector,
  queryPredicateSelector,
  queryPredicates,
  type QueryPredicate,
} from '../shared/lifeSpaceQuerySemantics';
import { projectLifeSpaceHttpError } from './lifeSpaceErrorProjection';

function mapperType(field: DiscoveryField | undefined, valueType?: QueryPredicate['valueType']): FieldType {
  const type = String(valueType ?? field?.type ?? 'string');
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'date' || type === 'instant' || type === 'datetime') return 'dateTime';
  if ([
    'range<date>',
    'range<instant>',
    'temporal_range',
    'date-range',
    'instant-range',
    'temporal-range',
  ].includes(type)) return 'object';
  if (type === 'person_list' || type === 'record_list') return 'array';
  if (type === 'enum') return 'options';
  return 'string';
}

function hasServerDefault(model: DiscoveryModel, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(model.defaults ?? {}, key);
}

function serverDefaultHint(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'set by LifeSpace';
}

async function selectedModel(context: ILoadOptionsFunctions): Promise<{ model: DiscoveryModel; spaceId: string } | null> {
  const spaceId = loadOptionParameter(context, 'spaceId');
  const recordType = decodeRecordTypeSelector(loadOptionParameter(context, 'recordType'));
  if (!spaceId || !recordType) return null;
  const discovery = await loadRuntimeDiscovery.call(context);
  const model = discoveryModel(discovery, spaceId, recordType.modelKey);
  return model ? { model, spaceId } : null;
}

function relationOptions(targets: RelationTarget[] | null): INodePropertyOptions[] | undefined {
  return targets?.map((target) => ({ name: target.label, value: target.id }));
}

function mapperField(
  field: DiscoveryField,
  id: string,
  required: boolean,
  options?: INodePropertyOptions[],
  defaultHint?: string,
): ResourceMapperField {
  const label = field.title?.trim() || field.key;
  return {
    id,
    displayName: defaultHint === undefined ? label : `${label} (default: ${defaultHint})`,
    required,
    defaultMatch: false,
    canBeUsedToMatch: false,
    display: true,
    type: options ? 'options' : mapperType(field),
    options: options ?? (field.type === 'enum'
      ? (field.values ?? []).map((value) => ({ name: value, value }))
      : []),
  };
}

export async function getHumanRecordFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
  const selected = await selectedModel(this);
  if (!selected) return { fields: [] };
  const operation = (loadOptionParameter(this, 'operation') || 'create') as 'create' | 'update';
  const result: ResourceMapperField[] = [];

  for (const field of writableMutationFields(selected.model, operation)) {
    if (String(field.type) === 'temporal_range') continue;
    if (field.relation?.lookup.supported && field.relation.cardinality === 'many') continue;
    let options: INodePropertyOptions[] | undefined;
    if (field.relation?.lookup.supported && field.relation.cardinality === 'one') {
      options = relationOptions(await loadRelationTargets(this, selected.spaceId, selected.model.key, field));
    }
    const defaultExists = operation === 'create' && hasServerDefault(selected.model, field.key);
    result.push(mapperField(
      field,
      mutationFieldSelector(field),
      operation === 'create' && field.required === true && !defaultExists,
      options,
      defaultExists ? serverDefaultHint(selected.model.defaults[field.key]) : undefined,
    ));
  }

  if (operation !== 'create') return { fields: result };
  return {
    fields: [
      ...result.filter((field) => field.required),
      ...result.filter((field) => !field.required),
    ],
  };
}

export async function getHumanTemporalRangeFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const selected = await selectedModel(this);
  if (!selected) return [];
  const operation = (loadOptionParameter(this, 'operation') || 'create') as 'create' | 'update';

  return writableMutationFields(selected.model, operation)
    .filter((field) => String(field.type) === 'temporal_range')
    .map((field) => ({
      name: `${field.title?.trim() || field.key}${operation === 'create' && field.required === true ? ' (Required)' : ''}`,
      value: field.key,
      description: field.description,
    }));
}

export async function getHumanActionInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
  const selected = await selectedModel(this);
  if (!selected) return { fields: [] };
  const actionKey = loadOptionParameter(this, 'actionKey');
  const action = selected.model.actions.find((entry) => entry.key === actionKey);
  return action
    ? { fields: action.input.fields.map((field) => mapperField(field, field.key, field.required === true)) }
    : { fields: [] };
}

function predicateLabel(predicate: QueryPredicate): string {
  return `${predicate.fieldLabel} — ${predicate.operatorLabel}`;
}

export async function getCanonicalFilterFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const selected = await selectedModel(this);
  if (!selected) return [];

  const fields = new Map<string, string>();
  for (const predicate of queryPredicates(selected.model)) {
    if (!fields.has(predicate.field)) fields.set(predicate.field, predicate.fieldLabel);
  }

  return [...fields.entries()].map(([value, name]) => ({ name, value }));
}

const HUMAN_OPERATOR_SELECTOR_PREFIX = 'lsqh1:';
const TEMPORAL_SORT_SELECTOR_PREFIX = 'lsqts1.';

function rangeLikeValueType(valueType: QueryPredicate['valueType']): boolean {
  return [
    'range<date>',
    'range<instant>',
    'temporal_range',
    'date-range',
    'instant-range',
    'temporal-range',
  ].includes(String(valueType));
}

export function humanFilterOperatorSelector(
  predicate: QueryPredicate,
  role = predicate.operator,
): string {
  const payload = Buffer.from(queryPredicateSelector(predicate)).toString('base64url');
  return `${HUMAN_OPERATOR_SELECTOR_PREFIX}${role}.${payload}`;
}

function parseHumanFilterOperatorSelector(value: unknown): {
  predicate: QueryPredicate;
  overlapBoundary?: 'start' | 'end';
} | null {
  const raw = String(value ?? '');
  if (!raw.startsWith(HUMAN_OPERATOR_SELECTOR_PREFIX)) {
    const predicate = parseQueryPredicateSelector(raw);
    return predicate ? { predicate } : null;
  }

  const rest = raw.slice(HUMAN_OPERATOR_SELECTOR_PREFIX.length);
  const separator = rest.indexOf('.');
  if (separator < 1) return null;
  const role = rest.slice(0, separator);
  try {
    const selector = Buffer.from(rest.slice(separator + 1), 'base64url').toString('utf8');
    const predicate = parseQueryPredicateSelector(selector);
    if (!predicate) return null;
    if (role === 'overlapsStart') return { predicate, overlapBoundary: 'start' };
    if (role === 'overlapsEnd') return { predicate, overlapBoundary: 'end' };
    return role === predicate.operator ? { predicate } : null;
  } catch {
    return null;
  }
}

export function temporalSortFieldSelector(field: string): string {
  return TEMPORAL_SORT_SELECTOR_PREFIX + Buffer.from(field).toString('base64url');
}

function parseTemporalSortFieldSelector(value: unknown): { field: string; temporalRange: boolean } {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith(TEMPORAL_SORT_SELECTOR_PREFIX)) return { field: raw, temporalRange: false };
  try {
    const field = Buffer.from(raw.slice(TEMPORAL_SORT_SELECTOR_PREFIX.length), 'base64url').toString('utf8').trim();
    return { field, temporalRange: Boolean(field) };
  } catch {
    return { field: raw, temporalRange: false };
  }
}

export async function getHumanSortableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const selected = await selectedModel(this);
  if (!selected) return [];
  const canonicalFields = selected.model.query.canonical?.sort.fields;
  const fields = canonicalFields?.length
    ? canonicalFields
    : [...selected.model.query.sort.envelopeFields, ...selected.model.query.sortable];
  const temporalFields = new Set(
    (selected.model.query.canonical?.filter.targets ?? [])
      .filter((target) => ['temporal_range', 'temporal-range'].includes(String(target.valueType)))
      .map((target) => target.field),
  );

  return [...new Set(fields)].map((fieldKey) => {
    const field = selected.model.fields.find((entry) => entry.key === fieldKey);
    return {
      name: field?.title?.trim() || fieldKey,
      value: temporalFields.has(fieldKey) ? temporalSortFieldSelector(fieldKey) : fieldKey,
    };
  });
}

export async function getCanonicalFilterOperators(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const selected = await selectedModel(this);
  if (!selected) return [];

  const field = String(this.getCurrentNodeParameter('&field') ?? '').trim();
  const predicates = queryPredicates(selected.model).filter((predicate) => !field || predicate.field === field);
  const result: INodePropertyOptions[] = [];

  for (const predicate of predicates) {
    if (rangeLikeValueType(predicate.valueType) && predicate.operator === 'overlaps') {
      result.push(
        { name: 'Overlaps Start', value: humanFilterOperatorSelector(predicate, 'overlapsStart') },
        { name: 'Overlaps End', value: humanFilterOperatorSelector(predicate, 'overlapsEnd') },
      );
      continue;
    }
    // Contains still requires a structured range operand. Keep stored workflows executable,
    // but do not expose JSON-only input in the Human Workflow UI.
    if (rangeLikeValueType(predicate.valueType) && predicate.operator === 'contains') continue;
    result.push({
      name: predicate.operatorLabel,
      value: humanFilterOperatorSelector(predicate),
    });
  }
  return result;
}

// 0.1.11/0.1.12 compatibility for stored workflows authored with the combined selector.
export async function getCanonicalFilterOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const selected = await selectedModel(this);
  if (!selected) return [];
  return queryPredicates(selected.model).map((predicate) => ({
    name: predicateLabel(predicate),
    value: queryPredicateSelector(predicate),
  }));
}

export async function getHumanQueryFilterFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
  const selected = await selectedModel(this);
  if (!selected) return { fields: [] };
  const result: ResourceMapperField[] = [];

  for (const predicate of queryPredicates(selected.model)) {
    const field = selected.model.fields.find((entry) => entry.key === predicate.field);
    let options: INodePropertyOptions[] | undefined;
    if (predicate.operator === 'within') continue;
    if (predicate.operator === 'kindIs'
      && ['temporal_range', 'temporal-range'].includes(predicate.valueType)) {
      options = [
        { name: 'Date', value: 'date' },
        { name: 'Instant', value: 'instant' },
      ];
    } else if (predicate.enumValues?.length) {
      options = predicate.enumValues.map((value) => ({ name: value, value }));
    } else if (field?.relation?.lookup.supported) {
      options = relationOptions(await loadRelationTargets(this, selected.spaceId, selected.model.key, field));
    }
    result.push({
      id: queryPredicateSelector(predicate),
      displayName: predicateLabel(predicate),
      required: false,
      defaultMatch: false,
      canBeUsedToMatch: false,
      display: true,
      type: ['isNull', 'isNotNull'].includes(predicate.operator)
        ? 'boolean'
        : options ? 'options' : mapperType(field, predicate.valueType),
      options: options ?? [],
    });
  }

  return { fields: result };
}

function dateOnly(value: IDataObject[string]): IDataObject[string] {
  if (value === null || value === undefined || value === '') return value;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/u.exec(String(value).trim());
  return match ? match[1] : value;
}

function objectValue(value: unknown): IDataObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as IDataObject : null;
}

function normalizeMutationValue(type: string, value: IDataObject[string]): IDataObject[string] {
  if (type === 'date') return dateOnly(value);
  const object = objectValue(value);
  if (!object) return value;

  if (type === 'range<date>') {
    return {
      ...object,
      start: dateOnly(object.start),
      endExclusive: dateOnly(object.endExclusive),
    };
  }
  if (type === 'temporal_range' && object.kind === 'date') {
    return {
      ...object,
      start: dateOnly(object.start),
      endExclusive: dateOnly(object.endExclusive),
    };
  }
  return value;
}

function normalizeQueryRangeValue(
  valueType: QueryPredicate['valueType'],
  value: IDataObject[string],
): IDataObject[string] {
  const object = objectValue(value);
  if (!object) return value;
  if (['range<date>', 'date-range'].includes(valueType) || object.kind === 'date') {
    return {
      ...object,
      start: dateOnly(object.start),
      endExclusive: dateOnly(object.endExclusive),
    };
  }
  return value;
}

export function projectMutationValues(
  value: unknown,
  schema: ResourceMapperField[] = [],
): IDataObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const activeFields = schema.length
    ? new Set(schema.filter((field) => field.removed !== true).map((field) => field.id))
    : null;
  const result: IDataObject = {};
  for (const [selector, entry] of Object.entries(value as IDataObject)) {
    if (activeFields && !activeFields.has(selector)) continue;
    const parsed = parseMutationFieldSelector(selector);
    if (!parsed) {
      result[selector] = entry;
      continue;
    }
    if (entry === undefined) continue;
    result[parsed.field] = normalizeMutationValue(parsed.type, entry);
  }
  return result;
}

export type CanonicalFilter =
  | { field: string; op: string; value?: unknown }
  | { and: CanonicalFilter[] }
  | { or: CanonicalFilter[] };


type HumanFilterCondition = {
  field?: unknown;
  operator?: unknown;
  predicate?: unknown;
  value?: unknown;
};

type HumanFilterGroup = {
  match?: unknown;
  conditions?: unknown;
};

function humanFilterConditions(value: unknown): HumanFilterCondition[] {
  if (Array.isArray(value)) return value as HumanFilterCondition[];
  if (!value || typeof value !== 'object') return [];
  const rows = (value as IDataObject).condition;
  return Array.isArray(rows) ? rows as HumanFilterCondition[] : [];
}

function structuredQueryValue(predicate: QueryPredicate): boolean {
  if (predicate.operator === 'within') return true;
  if (predicate.operator === 'kindIs') return false;
  return rangeLikeValueType(predicate.valueType);
}

function exactHumanDate(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
  return raw;
}

function nextHumanDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function absoluteHumanInstant(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(raw)) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function humanDateInput(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/u.exec(raw);
  return match ? exactHumanDate(match[1]) : null;
}

type HumanTemporalRangeRow = {
  field?: unknown;
  kind?: unknown;
  dateStart?: unknown;
  dateEnd?: unknown;
  instantStart?: unknown;
  instantEnd?: unknown;
};

function humanTemporalRangeRows(value: unknown): HumanTemporalRangeRow[] {
  if (Array.isArray(value)) return value as HumanTemporalRangeRow[];
  if (!value || typeof value !== 'object') return [];
  const rows = (value as IDataObject).range;
  return Array.isArray(rows) ? rows as HumanTemporalRangeRow[] : [];
}

export function projectHumanTemporalRanges(
  context: Pick<IExecuteFunctions, 'getNode'>,
  value: unknown,
): IDataObject {
  const result: IDataObject = {};

  for (const row of humanTemporalRangeRows(value)) {
    const field = String(row.field ?? '').trim();
    if (!field) continue;
    if (Object.prototype.hasOwnProperty.call(result, field)) {
      throw new NodeOperationError(context.getNode(), `Temporal range field ${field} is configured more than once`);
    }

    const kind = String(row.kind ?? '').trim();
    if (kind === 'date') {
      const start = humanDateInput(row.dateStart);
      const end = humanDateInput(row.dateEnd);
      if (!start || !end) {
        throw new NodeOperationError(context.getNode(), `Temporal range ${field} requires valid Start and End dates`);
      }
      if (end < start) {
        throw new NodeOperationError(context.getNode(), `Temporal range ${field} End must not be earlier than Start`);
      }
      result[field] = {
        kind: 'date',
        start,
        endExclusive: nextHumanDate(end),
      };
      continue;
    }

    if (kind === 'instant') {
      const start = absoluteHumanInstant(String(row.instantStart ?? '').trim());
      const end = absoluteHumanInstant(String(row.instantEnd ?? '').trim());
      if (!start || !end) {
        throw new NodeOperationError(
          context.getNode(),
          `Temporal range ${field} requires absolute RFC3339 Start and End date-times`,
        );
      }
      if (Date.parse(end) <= Date.parse(start)) {
        throw new NodeOperationError(context.getNode(), `Temporal range ${field} End must be later than Start`);
      }
      result[field] = {
        kind: 'instant',
        start,
        endExclusive: end,
      };
      continue;
    }

    throw new NodeOperationError(context.getNode(), `Temporal range ${field} requires Type Date or Date & Time`);
  }

  return result;
}

function overlapWindowValue(
  context: Pick<IExecuteFunctions, 'getNode'>,
  field: string,
  startValue: unknown,
  endValue: unknown,
  timezone: string,
): IDataObject {
  const startRaw = String(startValue ?? '').trim();
  const endRaw = String(endValue ?? '').trim();
  const startDate = exactHumanDate(startRaw);
  const endDate = exactHumanDate(endRaw);

  if (startDate && endDate) {
    if (endDate < startDate) {
      throw new NodeOperationError(context.getNode(), `Filter ${field} Overlaps End must not be earlier than Overlaps Start`);
    }
    return {
      kind: 'local_date_window',
      startDate,
      endDateExclusive: nextHumanDate(endDate),
      timezone,
    };
  }

  const startInstant = absoluteHumanInstant(startRaw);
  const endInstant = absoluteHumanInstant(endRaw);
  if (startInstant && endInstant) {
    if (Date.parse(endInstant) <= Date.parse(startInstant)) {
      throw new NodeOperationError(context.getNode(), `Filter ${field} Overlaps End must be later than Overlaps Start`);
    }
    return { kind: 'instant', start: startInstant, endExclusive: endInstant };
  }

  throw new NodeOperationError(
    context.getNode(),
    `Filter ${field} Overlaps Start and End must both be YYYY-MM-DD dates or both be absolute RFC3339 date-times`,
  );
}

function singleRangeBoundaryValue(
  context: Pick<IExecuteFunctions, 'getNode'>,
  predicate: QueryPredicate,
  value: unknown,
  timezone: string,
): IDataObject {
  const raw = String(value ?? '').trim();
  const date = exactHumanDate(raw);
  if (date) {
    return {
      kind: 'local_date_window',
      startDate: date,
      endDateExclusive: nextHumanDate(date),
      timezone,
    };
  }

  const instant = absoluteHumanInstant(raw);
  if (instant) {
    const time = Date.parse(instant);
    if (predicate.operator === 'before') {
      return {
        kind: 'instant',
        start: instant,
        endExclusive: new Date(time + 1).toISOString(),
      };
    }
    if (predicate.operator === 'after') {
      return {
        kind: 'instant',
        start: new Date(time - 1).toISOString(),
        endExclusive: instant,
      };
    }
  }

  throw new NodeOperationError(
    context.getNode(),
    `Filter ${predicate.field} — ${predicate.operatorLabel} requires YYYY-MM-DD or an absolute RFC3339 date-time`,
  );
}

function parseHumanFilterValue(
  context: Pick<IExecuteFunctions, 'getNode'>,
  predicate: QueryPredicate,
  value: unknown,
  timezone: string,
): unknown {
  const raw = String(value ?? '').trim();
  if (!raw) {
    throw new NodeOperationError(
      context.getNode(),
      `Filter ${predicate.field} — ${predicate.operatorLabel} requires a value`,
    );
  }

  if (rangeLikeValueType(predicate.valueType) && ['before', 'after'].includes(predicate.operator)) {
    return singleRangeBoundaryValue(context, predicate, raw, timezone);
  }

  if (structuredQueryValue(predicate)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new NodeOperationError(
        context.getNode(),
        `Filter ${predicate.field} — ${predicate.operatorLabel} requires a JSON object value`,
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new NodeOperationError(
        context.getNode(),
        `Filter ${predicate.field} — ${predicate.operatorLabel} requires a JSON object value`,
      );
    }
    return normalizeQueryRangeValue(predicate.valueType, parsed as IDataObject[string]);
  }

  if (predicate.valueType === 'integer') {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
      throw new NodeOperationError(context.getNode(), `Filter ${predicate.field} requires an integer value`);
    }
    return parsed;
  }

  if (predicate.valueType === 'number') {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new NodeOperationError(context.getNode(), `Filter ${predicate.field} requires a numeric value`);
    }
    return parsed;
  }

  if (predicate.valueType === 'boolean') {
    if (raw.toLowerCase() === 'true') return true;
    if (raw.toLowerCase() === 'false') return false;
    throw new NodeOperationError(context.getNode(), `Filter ${predicate.field} requires true or false`);
  }

  if (predicate.valueType === 'date') return dateOnly(raw);
  return raw;
}

function validateConditionField(
  context: Pick<IExecuteFunctions, 'getNode'>,
  row: HumanFilterCondition,
  predicate: QueryPredicate,
): void {
  const field = String(row.field ?? '').trim();
  if (field && field !== predicate.field) {
    throw new NodeOperationError(
      context.getNode(),
      `Filter operator "${predicate.operatorLabel}" does not belong to field "${field}"`,
    );
  }
}

function projectHumanFilterCondition(
  context: Pick<IExecuteFunctions, 'getNode'>,
  row: HumanFilterCondition,
  predicate: QueryPredicate,
  timezone: string,
): CanonicalFilter | null {
  validateConditionField(context, row, predicate);

  if (predicate.operator === 'isNull' || predicate.operator === 'isNotNull') {
    return { field: predicate.field, op: predicate.operator };
  }

  if (predicate.operator === 'in') {
    const values = String(row.value ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) {
      throw new NodeOperationError(
        context.getNode(),
        `Filter ${predicate.field} — ${predicate.operatorLabel} requires a value`,
      );
    }
    const children = values.map((value) => ({
      field: predicate.field,
      op: 'eq',
      value,
    }));
    return children.length === 1 ? children[0] : { or: children };
  }

  return {
    field: predicate.field,
    op: predicate.operator,
    value: parseHumanFilterValue(context, predicate, row.value, timezone),
  };
}

function combineHumanFilters(match: unknown, filters: CanonicalFilter[]): CanonicalFilter | null {
  if (!filters.length) return null;
  if (filters.length === 1) return filters[0];
  return String(match ?? 'all') === 'any' ? { or: filters } : { and: filters };
}

function projectHumanFilterRows(
  context: Pick<IExecuteFunctions, 'getNode'>,
  match: unknown,
  rows: HumanFilterCondition[],
  timezone: string,
): CanonicalFilter | null {
  const filters: CanonicalFilter[] = [];
  const overlapBounds = new Map<string, {
    predicate: QueryPredicate;
    start?: unknown;
    end?: unknown;
  }>();

  for (const row of rows) {
    const selection = parseHumanFilterOperatorSelector(row.operator ?? row.predicate);
    if (!selection) continue;
    validateConditionField(context, row, selection.predicate);

    if (selection.overlapBoundary) {
      const current = overlapBounds.get(selection.predicate.field) ?? { predicate: selection.predicate };
      if (current[selection.overlapBoundary] !== undefined) {
        throw new NodeOperationError(
          context.getNode(),
          `Filter ${selection.predicate.field} may contain only one Overlaps ${selection.overlapBoundary === 'start' ? 'Start' : 'End'} in a Filter Group`,
        );
      }
      current[selection.overlapBoundary] = row.value;
      overlapBounds.set(selection.predicate.field, current);
      continue;
    }

    const filter = projectHumanFilterCondition(context, row, selection.predicate, timezone);
    if (filter) filters.push(filter);
  }

  for (const [field, pair] of overlapBounds) {
    if (pair.start === undefined || pair.end === undefined) {
      throw new NodeOperationError(
        context.getNode(),
        `Filter ${field} requires Overlaps Start and Overlaps End in the same Filter Group`,
      );
    }
    filters.push({
      field,
      op: 'overlaps',
      value: overlapWindowValue(context, field, pair.start, pair.end, timezone),
    });
  }

  return combineHumanFilters(match, filters);
}

export function projectHumanFilterBuilder(
  context: Pick<IExecuteFunctions, 'getNode'>,
  match: unknown,
  conditions: unknown,
  groups: unknown,
  timezone = 'UTC',
): CanonicalFilter[] {
  const legacyRows = humanFilterConditions(conditions);
  const groupRows = Array.isArray(groups)
    ? groups as HumanFilterGroup[]
    : groups && typeof groups === 'object' && Array.isArray((groups as IDataObject).group)
      ? (groups as IDataObject).group as HumanFilterGroup[]
      : [];

  const projectedGroups = groupRows
    .map((group) => projectHumanFilterRows(
      context,
      group.match,
      humanFilterConditions(group.conditions),
      timezone,
    ))
    .filter((entry): entry is CanonicalFilter => entry !== null);

  // Compatibility: workflows authored before 0.1.14 may still contain top-level
  // Conditions + Match. Preserve their previous Boolean semantics.
  if (legacyRows.length) {
    const legacy = projectHumanFilterRows(context, match, legacyRows, timezone);
    const children = [...(legacy ? [legacy] : []), ...projectedGroups];
    const combined = combineHumanFilters(match, children);
    return combined ? [combined] : [];
  }

  // New Human UI exposes only Filter Groups. Groups compose by AND.
  const combined = combineHumanFilters('all', projectedGroups);
  return combined ? [combined] : [];
}

export function projectQueryFilters(value: unknown): CanonicalFilter[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const result: CanonicalFilter[] = [];
  for (const [selector, entry] of Object.entries(value as IDataObject)) {
    const predicate = parseQueryPredicateSelector(selector);
    if (!predicate) continue;
    if (predicate.operator === 'isNull' || predicate.operator === 'isNotNull') {
      if (entry === true) result.push({ field: predicate.field, op: predicate.operator });
      continue;
    }
    if (entry === undefined || entry === null || entry === '') continue;
    let projected: unknown = entry;
    if (predicate.valueType === 'date') projected = dateOnly(entry);
    else projected = normalizeQueryRangeValue(predicate.valueType, entry);
    if (predicate.operator === 'in') {
      const values = Array.isArray(entry) ? entry : [entry];
      const children = values
        .filter((candidate) => candidate !== undefined && candidate !== null && candidate !== '')
        .map((candidate) => ({ field: predicate.field, op: 'eq', value: candidate }));
      if (children.length === 1) result.push(children[0]);
      if (children.length > 1) result.push({ or: children });
      continue;
    }
    result.push({ field: predicate.field, op: predicate.operator, value: projected });
  }
  return result;
}

const TIME_WINDOW_SELECTOR_PREFIX = 'lsqtw1.';

export function canonicalTimeWindowSelector(field: string, operator: string): string {
  return TIME_WINDOW_SELECTOR_PREFIX
    + Buffer.from(JSON.stringify([field, operator])).toString('base64url');
}

function parseCanonicalTimeWindowSelector(value: unknown): { field: string; operator: string } | null {
  const raw = String(value ?? '');
  if (!raw.startsWith(TIME_WINDOW_SELECTOR_PREFIX)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw.slice(TIME_WINDOW_SELECTOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 2 || decoded.some((entry) => typeof entry !== 'string' || !entry)) return null;
    return { field: decoded[0], operator: decoded[1] };
  } catch {
    return null;
  }
}

export async function getCanonicalTimeWindowFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const selected = await selectedModel(this);
  if (!selected?.model.query.canonical) return [];
  const operators = new Set(['within', 'overlaps', 'contains', 'before', 'after']);
  return selected.model.query.canonical.filter.targets.flatMap((target) =>
    target.operators
      .filter((operator) => operators.has(operator))
      .map((operator) => ({
        name: `${target.field} — ${operator}`,
        value: canonicalTimeWindowSelector(target.field, operator),
      })));
}

export function projectCanonicalTimeWindows(value: unknown): CanonicalFilter[] {
  const rows = Array.isArray(value) ? value : [];
  const result: CanonicalFilter[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as IDataObject;
    const target = parseCanonicalTimeWindowSelector(row.target);
    if (!target) continue;
    const startDate = dateOnly(row.startDate);
    const endDateExclusive = dateOnly(row.endDateExclusive);
    const timezone = String(row.timezone ?? '').trim();
    if (!startDate || !endDateExclusive || !timezone) continue;
    result.push({
      field: target.field,
      op: target.operator,
      value: { kind: 'local_date_window', startDate, endDateExclusive, timezone },
    });
  }
  return result;
}

function queryTimezone(context: IExecuteFunctions, itemIndex: number): string {
  const configured = context.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const explicit = String(configured.viewingTimezone ?? '').trim();
  if (explicit) return explicit;
  const legacy = String(context.getNodeParameter('queryViewingTimezone', itemIndex, '') ?? '').trim();
  return legacy || context.getTimezone();
}

function rawSortRows(context: IExecuteFunctions, itemIndex: number, options?: unknown): Array<{ field?: unknown; direction?: unknown }> {
  const rows = context.getNodeParameter('sorts.sort', itemIndex, [], options as never);
  return Array.isArray(rows) ? rows as Array<{ field?: unknown; direction?: unknown }> : [];
}

function hasTemporalRangeSort(context: IExecuteFunctions, itemIndex: number, options?: unknown): boolean {
  return rawSortRows(context, itemIndex, options)
    .some((row) => parseTemporalSortFieldSelector(row.field).temporalRange);
}

function errorAwareHelpers(context: IExecuteFunctions) {
  return new Proxy(context.helpers, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== 'httpRequestWithAuthentication' || typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(value, context, args);
        } catch (error) {
          throw projectLifeSpaceHttpError(context, error);
        }
      };
    },
  });
}

export function humanExecutionContext(context: IExecuteFunctions): IExecuteFunctions {
  return new Proxy(context, {
    get(target, property, receiver) {
      if (property === 'helpers') return errorAwareHelpers(target);
      if (property !== 'getNodeParameter') return Reflect.get(target, property, receiver);
      return (name: string, itemIndex: number, fallback?: unknown, options?: unknown) => {
        if (name === 'queryMode') {
          const operation = String(target.getNodeParameter('operation', itemIndex, '') ?? '');
          if (operation === 'list') {
            const stored = String(target.getNodeParameter(name, itemIndex, '') ?? '');
            return stored === 'capability' ? 'capability' : 'canonical';
          }
        }
        if (name === 'sorts.sort') {
          return rawSortRows(target, itemIndex, options).map((row) => ({
            ...row,
            field: parseTemporalSortFieldSelector(row.field).field,
          }));
        }
        if (name === 'options') {
          const base = target.getNodeParameter(name, itemIndex, fallback as never, options as never);
          const value = base && typeof base === 'object' && !Array.isArray(base)
            ? { ...(base as IDataObject) }
            : {};
          const operation = String(target.getNodeParameter('operation', itemIndex, '') ?? '');
          if (operation !== 'list' || !hasTemporalRangeSort(target, itemIndex, options)) {
            delete value.viewingTimezone;
            return value;
          }
          value.viewingTimezone = queryTimezone(target, itemIndex);
          return value;
        }
        if (name === 'canonicalFilters') {
          const conditions = target.getNodeParameter('queryFilterConditions.condition', itemIndex, [], options as never);
          const groups = target.getNodeParameter('queryFilterGroups.group', itemIndex, [], options as never);
          const hasBuilder = (Array.isArray(conditions) && conditions.length > 0)
            || (Array.isArray(groups) && groups.length > 0);
          if (hasBuilder) {
            const match = target.getNodeParameter('queryFilterMatch', itemIndex, 'all', options as never);
            return projectHumanFilterBuilder(
              target,
              match,
              conditions,
              groups,
              queryTimezone(target, itemIndex),
            );
          }
          const mapped = target.getNodeParameter('queryFilters.value', itemIndex, {}, options as never);
          return projectQueryFilters(mapped);
        }
        if (name === 'canonicalTimeWindows') {
          const rows = target.getNodeParameter('queryTimeWindows.window', itemIndex, [], options as never);
          return projectCanonicalTimeWindows(rows);
        }
        if (name === 'fields.value') {
          const value = target.getNodeParameter(name, itemIndex, fallback as never, options as never);
          const schema = target.getNodeParameter('fields.schema', itemIndex, []) as ResourceMapperField[];
          const projected = projectMutationValues(value, schema);
          const temporalRows = target.getNodeParameter('humanTemporalRanges.range', itemIndex, [], options as never);
          const temporal = projectHumanTemporalRanges(target, temporalRows);
          for (const [field, entry] of Object.entries(temporal)) {
            if (Object.prototype.hasOwnProperty.call(projected, field)) {
              throw new NodeOperationError(target.getNode(), `Field ${field} is configured more than once`);
            }
            projected[field] = entry;
          }
          return projected;
        }
        if (name === 'filters.filter') {
          const mapped = target.getNodeParameter('queryFilters.value', itemIndex, {}, options as never);
          const projected = projectQueryFilters(mapped);
          if (projected.length) return projected;
        }
        return target.getNodeParameter(name, itemIndex, fallback as never, options as never);
      };
    },
  });
}
