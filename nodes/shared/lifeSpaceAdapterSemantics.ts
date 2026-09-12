import type { DiscoveryField, DiscoveryModel } from '../lifespaceDiscovery';

export type MutationOperation = 'create' | 'update';

const MUTATION_SELECTOR_PREFIX = 'lsf:';

export function writableMutationFields(model: DiscoveryModel, operation: MutationOperation): DiscoveryField[] {
  return model.fields
    .filter((field) => !field.readOnly)
    .filter((field) => operation === 'create' || !field.immutable);
}

export function mutationFieldSelector(field: DiscoveryField): string {
  return `${MUTATION_SELECTOR_PREFIX}${field.type}:${field.key}`;
}

export function parseMutationFieldSelector(value: unknown): { field: string; type: DiscoveryField['type'] } | null {
  const raw = String(value ?? '');
  if (!raw.startsWith(MUTATION_SELECTOR_PREFIX)) return null;
  const rest = raw.slice(MUTATION_SELECTOR_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0 || separator === rest.length - 1) return null;
  return {
    type: rest.slice(0, separator) as DiscoveryField['type'],
    field: rest.slice(separator + 1),
  };
}
