import type {
  DiscoveryCanonicalFilterTarget,
  DiscoveryField,
  DiscoveryModel,
} from '../lifespaceDiscovery';

export type QueryPredicate = {
  field: string;
  fieldLabel: string;
  operator: string;
  operatorLabel: string;
  parameter: string;
  valueType: DiscoveryCanonicalFilterTarget['valueType'];
  enumValues?: string[];
  mode: 'scalar' | 'enum-set';
};

const SELECTOR_PREFIX = 'lsqc1.';
const OPERATOR_LABELS: Record<string, string> = {
  eq: 'Equals',
  ne: 'Does Not Equal',
  in: 'Is One Of',
  lt: 'Before / Less Than',
  lte: 'Before or Equal / Less Than or Equal',
  gt: 'After / Greater Than',
  gte: 'After or Equal / Greater Than or Equal',
  contains: 'Contains',
  isNull: 'Is Empty',
  isNotNull: 'Is Not Empty',
  within: 'Within',
  overlaps: 'Overlaps',
  before: 'Before',
  after: 'After',
  kindIs: 'Range Kind Is',
};

function label(field: DiscoveryField | undefined, key: string): string {
  if (field?.title?.trim()) return field.title.trim();
  const spaced = key.replace(/_/gu, ' ').replace(/([a-z0-9])([A-Z])/gu, '$1 $2').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

function fieldFor(model: DiscoveryModel, key: string): DiscoveryField | undefined {
  return model.fields.find((field) => field.key === key);
}

function canonicalPredicates(model: DiscoveryModel): QueryPredicate[] {
  const descriptor = model.query.canonical;
  if (!descriptor) return [];
  return descriptor.filter.targets.flatMap((target) => {
    const field = fieldFor(model, target.field);
    return target.operators.map((operator) => ({
      field: target.field,
      fieldLabel: label(field, target.field),
      operator,
      operatorLabel: OPERATOR_LABELS[operator] ?? operator,
      parameter: target.field,
      valueType: target.valueType,
      enumValues: field?.values,
      mode: 'scalar' as const,
    }));
  });
}

function pushUnique(target: QueryPredicate[], predicate: QueryPredicate): void {
  if (!target.some((entry) => entry.field === predicate.field && entry.operator === predicate.operator)) {
    target.push(predicate);
  }
}

function legacyPredicates(model: DiscoveryModel): QueryPredicate[] {
  const result: QueryPredicate[] = [];
  const compared = new Set((model.query.comparisons ?? []).map((entry) => entry.field));

  for (const filter of model.query.filters ?? []) {
    if (compared.has(filter.field)) continue;
    const field = fieldFor(model, filter.field);
    if (!field) continue;
    const fieldLabel = label(field, filter.field);
    pushUnique(result, {
      field: filter.field,
      fieldLabel,
      operator: filter.mode === 'enum-set' ? 'in' : 'eq',
      operatorLabel: filter.mode === 'enum-set' ? OPERATOR_LABELS.in : OPERATOR_LABELS.eq,
      parameter: filter.parameter,
      valueType: field.type,
      enumValues: field.values,
      mode: filter.mode === 'enum-set' ? 'enum-set' : 'scalar',
    });
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

export function queryPredicates(model: DiscoveryModel): QueryPredicate[] {
  return model.query.canonical ? canonicalPredicates(model) : legacyPredicates(model);
}

export function queryPredicateSelector(predicate: QueryPredicate): string {
  return SELECTOR_PREFIX + Buffer.from(JSON.stringify([
    predicate.field,
    predicate.operator,
    predicate.valueType,
    predicate.mode,
  ])).toString('base64url');
}

export function parseQueryPredicateSelector(value: unknown): QueryPredicate | null {
  const raw = String(value ?? '');
  if (raw.startsWith(SELECTOR_PREFIX)) {
    try {
      const decoded = JSON.parse(Buffer.from(raw.slice(SELECTOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
      if (!Array.isArray(decoded) || decoded.length !== 4 || decoded.some((entry) => typeof entry !== 'string')) return null;
      return {
        field: decoded[0],
        fieldLabel: decoded[0],
        operator: decoded[1],
        operatorLabel: OPERATOR_LABELS[decoded[1]] ?? decoded[1],
        parameter: decoded[0],
        valueType: decoded[2] as QueryPredicate['valueType'],
        mode: decoded[3] as QueryPredicate['mode'],
      };
    } catch {
      return null;
    }
  }

  // Stored workflows may still contain the pre-canonical Resource Mapper selector.
  const parts = raw.split(':');
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
