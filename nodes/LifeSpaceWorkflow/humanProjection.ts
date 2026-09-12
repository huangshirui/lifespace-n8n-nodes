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
    if (predicate.enumValues?.length) {
      options = predicate.enumValues.map((value) => ({ name: value, value }));
    } else if (field?.relation?.lookup.supported && field.relation.cardinality === 'one') {
      options = relationOptions(await loadRelationTargets(this, selected.spaceId, selected.model.key, field));
    }
    result.push({
      id: queryPredicateSelector(predicate),
      displayName: predicateLabel(predicate),
      required: false,
      defaultMatch: false,
      canBeUsedToMatch: false,
      display: true,
      type: options ? 'options' : mapperType(field, predicate.valueType),
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

export function projectQueryFilters(value: unknown): Array<{ field: string; operator: 'exact'; value: unknown }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const result: Array<{ field: string; operator: 'exact'; value: unknown }> = [];
  for (const [selector, entry] of Object.entries(value as IDataObject)) {
    if (entry === undefined || entry === null || entry === '') continue;
    const predicate = parseQueryPredicateSelector(selector);
    if (!predicate) continue;
    let projected: unknown = entry;
    if (predicate.valueType === 'date') projected = dateOnly(entry);
    if (predicate.mode === 'enum-set' && Array.isArray(entry)) projected = entry.join(',');
    result.push({ field: predicate.parameter, operator: 'exact', value: projected });
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
