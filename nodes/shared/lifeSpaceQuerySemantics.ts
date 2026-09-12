import type { DiscoveryField, DiscoveryModel } from '../lifespaceDiscovery';

export type QueryPredicate = {
  field: string;
  fieldLabel: string;
  operator: string;
  operatorLabel: string;
  parameter: string;
  valueType: DiscoveryField['type'] | 'datetime' | 'number';
  enumValues?: string[];
  mode: 'scalar' | 'enum-set';
};

const OPERATOR_LABELS: Record<string, string> = {
  eq: 'Equals',
  in: 'Is One Of',
  lt: 'Before / Less Than',
  lte: 'Before or Equal / Less Than or Equal',
  gt: 'After / Greater Than',
  gte: 'After or Equal / Greater Than or Equal',
};

function label(field: DiscoveryField | undefined, key: string): string {
  if (field?.title?.trim()) return field.title.trim();
  const spaced = key.replace(/_/gu, ' ').replace(/([a-z0-9])([A-Z])/gu, '$1 $2').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

function fieldFor(model: DiscoveryModel, key: string): DiscoveryField | undefined {
  return model.fields.find((field) => field.key === key);
}

function pushUnique(target: QueryPredicate[], predicate: QueryPredicate): void {
  if (!target.some((entry) => entry.parameter === predicate.parameter)) target.push(predicate);
}

export function queryPredicates(model: DiscoveryModel): QueryPredicate[] {
  const result: QueryPredicate[] = [];
  const compared = new Set((model.query.comparisons ?? []).map((entry) => entry.field));

  for (const filter of model.query.filters ?? []) {
    if (compared.has(filter.field)) continue;
    const field = fieldFor(model, filter.field);
    if (!field) continue;
    const fieldLabel = label(field, filter.field);
    if (filter.mode === 'enum-set') {
      pushUnique(result, {
        field: filter.field,
        fieldLabel,
        operator: 'in',
        operatorLabel: OPERATOR_LABELS.in,
        parameter: filter.parameter,
        valueType: field.type,
        enumValues: field.values,
        mode: 'enum-set',
      });
      continue;
    }
    pushUnique(result, {
      field: filter.field,
      fieldLabel,
      operator: 'eq',
      operatorLabel: OPERATOR_LABELS.eq,
      parameter: filter.parameter,
      valueType: field.type,
      enumValues: field.values,
      mode: 'scalar',
    });
    if (filter.range) {
      pushUnique(result, {
        field: filter.field,
        fieldLabel,
        operator: 'gte',
        operatorLabel: OPERATOR_LABELS.gte,
        parameter: filter.range.fromParameter,
        valueType: field.type,
        enumValues: field.values,
        mode: 'scalar',
      });
      pushUnique(result, {
        field: filter.field,
        fieldLabel,
        operator: 'lte',
        operatorLabel: OPERATOR_LABELS.lte,
        parameter: filter.range.toParameter,
        valueType: field.type,
        enumValues: field.values,
        mode: 'scalar',
      });
    }
  }

  for (const comparison of model.query.comparisons ?? []) {
    const field = fieldFor(model, comparison.field);
    for (const transport of comparison.operators.filter((entry) => entry.transport === 'explicit')) {
      pushUnique(result, {
        field: comparison.field,
        fieldLabel: label(field, comparison.field),
        operator: transport.operator,
        operatorLabel: OPERATOR_LABELS[transport.operator] ?? transport.operator,
        parameter: transport.parameter,
        valueType: comparison.valueType,
        enumValues: field?.values,
        mode: 'scalar',
      });
    }
  }

  return result;
}

export function queryPredicateSelector(predicate: QueryPredicate): string {
  return ['lsq', predicate.operator, predicate.parameter, predicate.field, predicate.valueType, predicate.mode].join(':');
}

export function parseQueryPredicateSelector(value: unknown): QueryPredicate | null {
  const parts = String(value ?? '').split(':');
  if (parts.length !== 6 || parts[0] !== 'lsq') return null;
  return {
    operator: parts[1],
    operatorLabel: OPERATOR_LABELS[parts[1]] ?? parts[1],
    parameter: parts[2],
    field: parts[3],
    fieldLabel: parts[3],
    valueType: parts[4] as QueryPredicate['valueType'],
    mode: parts[5] as QueryPredicate['mode'],
  };
}
