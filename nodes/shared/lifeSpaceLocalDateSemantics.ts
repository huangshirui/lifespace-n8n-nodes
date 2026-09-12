import type { DiscoveryModel } from '../lifespaceDiscovery';

export type LocalDateWindow = {
  field: string;
  fieldLabel: string;
  dateStartParameter: string;
  dateEndExclusiveParameter: string;
  timezoneParameter: string;
};

function label(key: string): string {
  const spaced = key.replace(/_/gu, ' ').replace(/([a-z0-9])([A-Z])/gu, '$1 $2').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

export function localDateWindows(model: DiscoveryModel): LocalDateWindow[] {
  return (model.query.comparisons ?? [])
    .filter((comparison) => comparison.valueType === 'datetime' && comparison.localDateWindow)
    .map((comparison) => ({
      field: comparison.field,
      fieldLabel: model.fields.find((field) => field.key === comparison.field)?.title?.trim() || label(comparison.field),
      dateStartParameter: comparison.localDateWindow!.dateStartParameter,
      dateEndExclusiveParameter: comparison.localDateWindow!.dateEndExclusiveParameter,
      timezoneParameter: comparison.localDateWindow!.timezoneParameter,
    }));
}
