import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { DiscoveryCalendarCapabilityBinding, DiscoveryModel } from './lifespaceDiscovery';

function meaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function fieldLabel(model: DiscoveryModel, fieldKey: string): string {
  return model.fields.find((field) => field.key === fieldKey)?.title?.trim() || fieldKey;
}

function calendarMode(value: unknown): 'all-day' | 'timed' | null {
  if (value === true || value === 'true') return 'all-day';
  if (value === false || value === 'false') return 'timed';
  return null;
}

function conflictingFields(
  model: DiscoveryModel,
  binding: DiscoveryCalendarCapabilityBinding,
  state: IDataObject,
  mode: 'all-day' | 'timed',
): string[] {
  const keys = mode === 'all-day'
    ? [
        binding.timedStartField,
        binding.timedEndField,
        binding.startTimezoneField,
        binding.endTimezoneField,
      ]
    : [binding.allDayStartField, binding.allDayEndExclusiveField];

  return keys
    .filter((fieldKey) => meaningful(state[fieldKey]))
    .map((fieldKey) => fieldLabel(model, fieldKey));
}

export function validateCalendarMutation(
  context: IExecuteFunctions,
  itemIndex: number,
  model: DiscoveryModel,
  payload: IDataObject,
  currentRecord?: IDataObject,
): void {
  const binding = model.capabilityBindings?.calendar;
  if (!binding) return;

  const state: IDataObject = {
    ...model.defaults,
    ...(currentRecord ?? {}),
    ...payload,
  };
  const mode = calendarMode(state[binding.allDayField]);
  if (!mode) return;

  const conflicts = conflictingFields(model, binding, state, mode);
  if (!conflicts.length) return;

  const allDayLabel = fieldLabel(model, binding.allDayField);
  const opposite = mode === 'all-day' ? 'timed instant/timezone' : 'all-day date';
  throw new NodeOperationError(
    context.getNode(),
    `${allDayLabel} selects ${mode} Calendar semantics, but ${opposite} fields are also set: ${conflicts.join(', ')}. Clear the conflicting fields or switch the Calendar mode before sending the mutation.`,
    { itemIndex },
  );
}
