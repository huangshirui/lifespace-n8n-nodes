import type { DiscoveryField, DiscoveryModel } from '../lifespaceDiscovery';

export type AgentToolSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
};

export type LifeSpaceAgentToolDefinition = {
  name: string;
  description: string;
  schema: AgentToolSchema;
  modelKey: string;
  actionKey: string;
};

function fieldToJsonSchema(field: DiscoveryField): Record<string, unknown> {
  switch (field.type) {
    case 'boolean':
      return { type: 'boolean', description: field.description ?? field.title };
    case 'integer':
    case 'number':
      return { type: 'number', description: field.description ?? field.title };
    case 'enum':
      return {
        type: 'string',
        enum: field.values ?? [],
        description: field.description ?? field.title,
      };
    case 'person_list':
    case 'record_list':
      return {
        type: 'array',
        items: { type: 'string' },
        description: field.description ?? field.title,
      };
    default:
      return {
        type: 'string',
        description: field.description ?? field.title,
      };
  }
}

export function buildAgentToolDefinition(
  model: DiscoveryModel,
  actionKey: string,
): LifeSpaceAgentToolDefinition {
  const action = model.actions.find((item) => item.key === actionKey);
  const fields = action?.input.fields ?? model.fields;

  return {
    name: `lifespace_${actionKey}_${model.key}`,
    description: `${actionKey} ${model.display.singular} in LifeSpace.`,
    modelKey: model.key,
    actionKey,
    schema: {
      type: 'object',
      properties: Object.fromEntries(fields.map((field) => [field.key, fieldToJsonSchema(field)])),
      required: fields.filter((field) => field.required).map((field) => field.key),
    },
  };
}
