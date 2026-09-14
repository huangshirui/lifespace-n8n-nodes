import type {
  FieldType,
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodePropertyOptions,
  ResourceMapperField,
  ResourceMapperFields,
} from 'n8n-workflow';
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
  const type = valueType ?? field?.type ?? 'string';
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'date' || type === 'datetime') return 'dateTime';
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

function predicateLabel(predicate: QueryPredicate): string {
  return `${predicate.fieldLabel} — ${predicate.operatorLabel}`;
}

export async function getHumanQueryFilterFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
  const selected = await selectedModel(this);
  if (!selected) return { fields: [] };
  const result: ResourceMapperField[] = [];

  for (const predicate of queryPredicates(selected.model)) {
    const field = selected.model.fields.find((entry) => entry.key === predicate.field);
    let options: INodePropertyOptions[] | undefined;
    const rangeValue = ['date-range', 'instant-range', 'temporal-range'].includes(predicate.valueType);
    if (['within', 'overlaps', 'before', 'after'].includes(predicate.operator)
      || (rangeValue && predicate.operator === 'contains')) continue;
    if (predicate.enumValues?.length) {
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
    result[parsed.field] = parsed.type === 'date' ? dateOnly(entry) : entry;
  }
  return result;
}

export type CanonicalFilter =
  | { field: string; op: string; value?: unknown }
  | { and: CanonicalFilter[] }
  | { or: CanonicalFilter[] };

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
        if (name === 'canonicalFilters') {
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
          return projectMutationValues(value, schema);
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
