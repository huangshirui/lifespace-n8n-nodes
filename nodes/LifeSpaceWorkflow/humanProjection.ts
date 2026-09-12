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
): ResourceMapperField {
  return {
    id,
    displayName: field.title?.trim() || field.key,
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
    result.push(mapperField(
      field,
      mutationFieldSelector(field),
      operation === 'create' && field.required === true && !hasServerDefault(selected.model, field.key),
      options,
    ));
  }

  return { fields: result };
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

export function projectMutationValues(value: unknown): IDataObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: IDataObject = {};
  for (const [selector, entry] of Object.entries(value as IDataObject)) {
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

export function humanExecutionContext(context: IExecuteFunctions): IExecuteFunctions {
  return new Proxy(context, {
    get(target, property, receiver) {
      if (property !== 'getNodeParameter') return Reflect.get(target, property, receiver);
      return (name: string, itemIndex: number, fallback?: unknown, options?: unknown) => {
        if (name === 'fields.value') {
          return projectMutationValues(target.getNodeParameter(name, itemIndex, fallback as never, options as never));
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
