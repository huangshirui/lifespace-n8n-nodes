import type { DiscoveryField, DiscoveryModel } from '../lifespaceDiscovery';

export type MutationOperation = 'create' | 'update';

export function writableMutationFields(model: DiscoveryModel, operation: MutationOperation): DiscoveryField[] {
  return model.fields
    .filter((field) => !field.readOnly)
    .filter((field) => operation === 'create' || !field.immutable);
}
