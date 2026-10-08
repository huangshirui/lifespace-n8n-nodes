import type { IDataObject, ISupplyDataFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
  searchRelationTargetsForAgent,
  type AgentRelationRequester,
  type DiscoveryField,
  type DiscoveryModel,
} from '../lifespaceDiscovery';
import {
  buildAgentToolDefinition,
  buildAgentToolRequest,
  validateAgentToolInput,
  type AgentToolConfig,
  type AgentToolOperation,
  type AgentToolSchema,
} from './lifeSpaceToolFactory';

export type AgentMutationMode = 'single' | 'bulk' | 'atomic';
export type AgentMutationOperation = 'create' | 'update' | 'delete';

export type MultiMutationDefinition = {
  name: string;
  description: string;
  schema: AgentToolSchema;
  modelKey: string;
  operation: AgentMutationOperation;
  mode: Exclude<AgentMutationMode, 'single'>;
};

export type MultiMutationRequest = {
  method: 'POST';
  path: string;
  body: {
    operations: Array<Record<string, unknown>>;
  };
};

function relationField(field: DiscoveryField): boolean {
  return ['person', 'person_list', 'record', 'record_list'].includes(field.type);
}

function stableReferenceId(field: DiscoveryField, value: string): boolean {
  if (field.type === 'person' || field.type === 'person_list') return /^per_[A-Za-z0-9_-]+$/u.test(value);
  return /^rec_[A-Za-z0-9_-]+$/u.test(value);
}

function referenceInput(value: unknown): { id?: string; name?: string } {
  if (typeof value === 'string') return { id: value.trim() };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
  };
}

async function resolveOneReference(
  context: ISupplyDataFunctions,
  baseUrl: string,
  spaceId: string,
  model: DiscoveryModel,
  field: DiscoveryField,
  value: unknown,
  requester: AgentRelationRequester,
): Promise<string> {
  const parsed = referenceInput(value);
  const raw = parsed.id ?? parsed.name ?? '';
  if (!raw) {
    throw new NodeOperationError(context.getNode(), `LifeSpace ${field.key} reference is missing`);
  }
  if (parsed.id && stableReferenceId(field, parsed.id)) return parsed.id;

  const name = parsed.name ?? parsed.id ?? '';
  if (!field.relation?.lookup.supported) {
    throw new NodeOperationError(
      context.getNode(),
      `LifeSpace relation lookup is unavailable for ${field.key}; supply a stable target ID`,
    );
  }
  const candidates = await searchRelationTargetsForAgent(
    context,
    baseUrl,
    spaceId,
    model.key,
    field,
    name,
    requester,
  );
  const normalized = name.toLocaleLowerCase();
  const exact = candidates.filter((candidate) => candidate.label.trim().toLocaleLowerCase() === normalized);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1 || candidates.length > 1) {
    const visible = (exact.length > 1 ? exact : candidates).slice(0, 10);
    throw new NodeOperationError(
      context.getNode(),
      `Multiple LifeSpace references matched "${name}" for ${field.key}: ${visible.map((entry) => `${entry.label} (${entry.id})`).join(', ')}`,
    );
  }
  if (candidates.length === 1) return candidates[0].id;
  throw new NodeOperationError(
    context.getNode(),
    `No LifeSpace reference matched "${name}" for ${field.key}`,
  );
}

async function resolveFieldReference(
  context: ISupplyDataFunctions,
  baseUrl: string,
  spaceId: string,
  model: DiscoveryModel,
  field: DiscoveryField,
  value: unknown,
  requester: AgentRelationRequester,
): Promise<unknown> {
  if (value === null || value === undefined) return value;
  if (field.type === 'person_list' || field.type === 'record_list') {
    if (!Array.isArray(value)) return value;
    return await Promise.all(value.map((entry) => resolveOneReference(
      context,
      baseUrl,
      spaceId,
      model,
      field,
      entry,
      requester,
    )));
  }
  return await resolveOneReference(context, baseUrl, spaceId, model, field, value, requester);
}

function singleConfig(
  config: AgentToolConfig,
  operation: AgentMutationOperation,
): AgentToolConfig {
  return { ...config, operation };
}

function itemSchema(
  model: DiscoveryModel,
  config: AgentToolConfig,
  operation: AgentMutationOperation,
): AgentToolSchema {
  return buildAgentToolDefinition(model, singleConfig(config, operation)).schema;
}

export function buildMultiMutationDefinition(
  model: DiscoveryModel,
  config: AgentToolConfig,
  operation: AgentMutationOperation,
  mode: Exclude<AgentMutationMode, 'single'>,
): MultiMutationDefinition {
  const single = buildAgentToolDefinition(model, singleConfig(config, operation));
  const plural = model.display.plural?.trim() || `${model.display.singular?.trim() || model.key}s`;
  const verb = operation === 'create' ? 'Create' : operation === 'update' ? 'Update' : 'Delete';
  const modeDescription = mode === 'bulk'
    ? 'Each item succeeds or fails independently; partial success is preserved and LifeSpace returns one blk_* correlation.'
    : 'All items commit together or roll back together in one cgs_* ChangeSet.';
  const description = config.descriptionOverride?.trim()
    || `${verb} 1-20 ${plural} in Space "${config.spaceName?.trim() || config.spaceId}" using LifeSpace ${mode === 'bulk' ? 'non-atomic Bulk' : 'Atomic Batch'}. ${modeDescription} Update/Delete versions are resolved set-wise by LifeSpace Core when omitted. Use stable record IDs; never guess them.`;
  return {
    name: `${single.name}_${mode}`,
    description,
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: itemSchema(model, config, operation),
          description: `1-20 ${operation} inputs for the pinned ${model.key} contract.`,
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
    modelKey: model.key,
    operation,
    mode,
  };
}

export async function prepareMultiMutationInput(
  context: ISupplyDataFunctions,
  baseUrl: string,
  model: DiscoveryModel,
  config: AgentToolConfig,
  operation: AgentMutationOperation,
  schema: AgentToolSchema,
  raw: unknown,
  requester: AgentRelationRequester,
): Promise<Record<string, unknown>> {
  const validated = validateAgentToolInput(schema, raw);
  const items = validated.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace multi-mutation requires 1-20 items');
  }

  const writable = operation === 'delete'
    ? []
    : model.fields
      .filter((field) => !field.readOnly)
      .filter((field) => operation === 'create' || !field.immutable);
  const preparedItems: Array<Record<string, unknown>> = [];
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      throw new NodeOperationError(context.getNode(), 'Each LifeSpace multi-mutation item must be an object');
    }
    const item = { ...(rawItem as Record<string, unknown>) };
    for (const field of writable) {
      if (!relationField(field) || item[field.key] === undefined) continue;
      item[field.key] = await resolveFieldReference(
        context,
        baseUrl,
        config.spaceId,
        model,
        field,
        item[field.key],
        requester,
      );
    }
    preparedItems.push(item);
  }
  return { items: preparedItems };
}

export function buildMultiMutationRequest(
  model: DiscoveryModel,
  config: AgentToolConfig,
  operation: AgentMutationOperation,
  mode: Exclude<AgentMutationMode, 'single'>,
  prepared: Record<string, unknown>,
  delegationId = '',
): MultiMutationRequest {
  const items = prepared.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new Error('LifeSpace multi-mutation requires 1-20 items');
  }
  const baseConfig = singleConfig(config, operation);
  const operations = items.map((rawItem) => {
    const item = rawItem as Record<string, unknown>;
    const request = buildAgentToolRequest(model, baseConfig, item);
    if (operation === 'create') {
      return {
        operation: 'create',
        modelKey: model.key,
        data: (request.body ?? {}) as IDataObject,
        ...(delegationId ? { delegationId } : {}),
      };
    }
    const recordId = String(item.recordId ?? '').trim();
    if (!recordId) throw new Error(`LifeSpace ${operation} item requires recordId`);
    if (operation === 'delete') {
      return {
        operation: 'delete',
        modelKey: model.key,
        recordId,
        ...(delegationId ? { delegationId } : {}),
      };
    }
    const data = request.body ?? {};
    if (!Object.keys(data).length) throw new Error('LifeSpace multi-update requires at least one field to change per item');
    return {
      operation: 'update',
      modelKey: model.key,
      recordId,
      data,
      ...(delegationId ? { delegationId } : {}),
    };
  });
  return {
    method: 'POST',
    path: `/spaces/${encodeURIComponent(config.spaceId)}/models/${mode === 'bulk' ? 'bulk' : 'batch'}`,
    body: { operations },
  };
}
