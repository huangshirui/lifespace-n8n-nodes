import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  ISupplyDataFunctions,
  JsonObject,
  SupplyData,
} from 'n8n-workflow';
import {
  NodeApiError,
  NodeConnectionTypes,
  nodeNameToToolName,
  NodeOperationError,
} from 'n8n-workflow';
import {
  decodeRecordTypeSelector,
  discoveryModel,
  discoverySpace,
  loadDesignTimeSemanticDetail,
  loadOptionParameter,
  loadRuntimeDiscovery,
  loadRuntimeDiscoveryInventory,
  normalizeBaseUrl,
  searchRelationTargetsForAgent,
  type DiscoveryAccess,
  type DiscoveryField,
  type DiscoveryModel,
} from '../lifespaceDiscovery';
import {
  buildAgentToolDefinition,
  buildAgentToolRequest,
  parseAgentQueryFailure,
  type AgentToolConfig,
  type AgentToolOperation,
  type AgentToolQueryMode,
  type AgentToolRequest,
  type AgentToolSchema,
} from '../agent/lifeSpaceToolFactory';
import {
  decodeAgentToolSemanticSnapshot,
  encodeAgentToolSemanticSnapshot,
} from '../agent/lifeSpaceToolSnapshot';

type StructuralAiTool = {
  name: string;
  description: string;
  schema: AgentToolSchema;
  metadata: Record<string, unknown>;
  invoke: (query: unknown) => Promise<string>;
};

type AgentRuntimeContext = IExecuteFunctions | ISupplyDataFunctions;

type AgentRuntime = {
  baseUrl: string;
  model: DiscoveryModel;
  config: AgentToolConfig;
  definition: ReturnType<typeof buildAgentToolDefinition>;
};

function requiredAccess(operation: string): DiscoveryAccess | null {
  if (operation === 'query') return 'read';
  if (['create', 'update', 'delete'].includes(operation)) return 'write';
  return null;
}

async function selectedOptionModel(context: ILoadOptionsFunctions): Promise<{ model: DiscoveryModel; spaceId: string } | null> {
  const spaceId = loadOptionParameter(context, 'spaceId');
  const rawRecordType = loadOptionParameter(context, 'recordType');
  if (!spaceId || !rawRecordType) return null;

  const snapshot = decodeAgentToolSemanticSnapshot(rawRecordType);
  if (snapshot) {
    return snapshot.spaceId === spaceId ? { model: snapshot.model, spaceId } : null;
  }

  // Legacy editor compatibility only. Runtime execution never refreshes semantics.
  const recordType = decodeRecordTypeSelector(rawRecordType);
  if (!recordType) return null;
  const discovery = await loadRuntimeDiscovery.call(context);
  const model = discoveryModel(discovery, spaceId, recordType.modelKey);
  return model ? { model, spaceId } : null;
}

function modelSupportsOperation(model: DiscoveryModel, operation: string): boolean {
  const access = requiredAccess(operation);
  if (access) return model.access.includes(access);
  if (operation === 'action') return model.actions.some((action) => model.access.includes(action.access));
  return false;
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return JSON.stringify({ success: true });
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function inputForLog(value: unknown): IDataObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as IDataObject
    : { value: String(value ?? '') };
}

function semanticToolInput(schema: AgentToolSchema, value: IDataObject): IDataObject {
  // n8n Tools Agent V3 executes connected Tool nodes with an envelope that merges
  // the parent Agent input, the LLM-provided Tool arguments and a toolCallId.
  // Only fields published by this Tool schema belong to the LifeSpace semantic
  // input. Project the execution envelope back onto that schema before validation.
  if (typeof value.toolCallId !== 'string') return value;

  const input: IDataObject = {};
  for (const key of Object.keys(schema.properties)) {
    if (Object.prototype.hasOwnProperty.call(value, key)) input[key] = value[key];
  }
  return input;
}

function currentRecordPath(request: AgentToolRequest): string {
  const actionIndex = request.path.indexOf('/actions/');
  return actionIndex >= 0 ? request.path.slice(0, actionIndex) : request.path;
}

function currentRecordVersion(context: AgentRuntimeContext, response: unknown): number {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace record lookup returned an invalid response');
  }
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace record lookup returned an invalid data envelope');
  }
  const version = (data as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new NodeOperationError(
      context.getNode(),
      'LifeSpace record did not expose a usable version for optimistic concurrency',
    );
  }
  return version;
}

function requestOptions(baseUrl: string, request: AgentToolRequest): IHttpRequestOptions {
  const options: IHttpRequestOptions = {
    method: request.method,
    url: `${baseUrl}${request.path}`,
    json: true,
  };
  if (request.qs && Object.keys(request.qs).length) options.qs = request.qs;
  if (request.body) options.body = request.body as IDataObject;
  if (request.repeatQueryArrays) options.arrayFormat = 'repeat';
  return options;
}

async function performRequest(
  context: AgentRuntimeContext,
  baseUrl: string,
  request: AgentToolRequest,
): Promise<unknown> {
  return await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceApi',
    requestOptions(baseUrl, request),
  );
}

type AgentReferenceFailure = {
  code: 'REFERENCE_NOT_FOUND' | 'AMBIGUOUS_REFERENCE' | 'REFERENCE_LOOKUP_UNAVAILABLE';
  field: string;
  input: string;
  candidates?: Array<{ id: string; label: string }>;
};

const REFERENCE_ERROR_PREFIX = 'LIFESPACE_AGENT_REFERENCE:';

function referenceErrorMessage(
  code: AgentReferenceFailure['code'],
  field: string,
  input: string,
  candidates: Array<{ id: string; label: string }> = [],
): string {
  const message = code === 'REFERENCE_NOT_FOUND'
    ? `No LifeSpace reference matched "${input}" for ${field}`
    : code === 'AMBIGUOUS_REFERENCE'
      ? `Multiple LifeSpace references matched "${input}" for ${field}`
      : `LifeSpace reference lookup is unavailable for ${field}`;
  return REFERENCE_ERROR_PREFIX + JSON.stringify({
    code,
    field,
    input,
    message,
    ...(candidates.length ? { candidates } : {}),
  });
}

function parseReferenceFailure(error: unknown): AgentReferenceFailure & { message: string } | null {
  if (!(error instanceof Error)) return null;
  const index = error.message.indexOf(REFERENCE_ERROR_PREFIX);
  if (index < 0) return null;
  try {
    const value = JSON.parse(error.message.slice(index + REFERENCE_ERROR_PREFIX.length)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const failure = value as Record<string, unknown>;
    if (
      !['REFERENCE_NOT_FOUND', 'AMBIGUOUS_REFERENCE', 'REFERENCE_LOOKUP_UNAVAILABLE'].includes(String(failure.code))
      || typeof failure.field !== 'string'
      || typeof failure.input !== 'string'
      || typeof failure.message !== 'string'
    ) return null;
    return value as AgentReferenceFailure & { message: string };
  } catch {
    return null;
  }
}

function relationField(field: DiscoveryField): boolean {
  return ['person', 'person_list', 'record', 'record_list'].includes(field.type);
}

function stableReferenceId(field: DiscoveryField, value: string): boolean {
  if (field.type === 'person' || field.type === 'person_list') return /^per_[A-Za-z0-9_-]+$/u.test(value);
  return /^rec_[A-Za-z0-9_-]+$/u.test(value);
}

function referenceInput(value: unknown): { id?: string; name?: string } {
  if (typeof value === 'string') return { id: value };
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
  context: AgentRuntimeContext,
  baseUrl: string,
  spaceId: string,
  model: DiscoveryModel,
  field: DiscoveryField,
  value: unknown,
  allowMe = false,
): Promise<string> {
  const parsed = referenceInput(value);
  const raw = parsed.id ?? parsed.name ?? '';
  if (!raw) {
    throw new NodeOperationError(
      context.getNode(),
      referenceErrorMessage('REFERENCE_NOT_FOUND', field.key, String(value ?? '')),
    );
  }

  if (allowMe && raw === 'me') return 'me';
  if (parsed.id && stableReferenceId(field, parsed.id)) return parsed.id;

  const name = parsed.name ?? parsed.id ?? '';
  const lookup = field.relation?.lookup;
  if (!lookup?.supported) {
    throw new NodeOperationError(
      context.getNode(),
      referenceErrorMessage('REFERENCE_LOOKUP_UNAVAILABLE', field.key, name),
    );
  }

  const candidates = await searchRelationTargetsForAgent(context, baseUrl, spaceId, model.key, field, name);
  const normalized = name.toLocaleLowerCase();
  const exact = candidates.filter((candidate) => candidate.label.trim().toLocaleLowerCase() === normalized);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) {
    throw new NodeOperationError(
      context.getNode(),
      referenceErrorMessage('AMBIGUOUS_REFERENCE', field.key, name, exact),
    );
  }
  if (candidates.length === 1) return candidates[0].id;
  if (!candidates.length) {
    throw new NodeOperationError(
      context.getNode(),
      referenceErrorMessage('REFERENCE_NOT_FOUND', field.key, name),
    );
  }
  throw new NodeOperationError(
    context.getNode(),
    referenceErrorMessage('AMBIGUOUS_REFERENCE', field.key, name, candidates.slice(0, 10)),
  );
}

async function resolveFieldReference(
  context: AgentRuntimeContext,
  baseUrl: string,
  spaceId: string,
  model: DiscoveryModel,
  field: DiscoveryField,
  value: unknown,
  allowMe = false,
): Promise<unknown> {
  if (value === null || value === undefined) return value;
  if (field.type === 'person_list' || field.type === 'record_list') {
    if (!Array.isArray(value)) return value;
    return await Promise.all(
      value.map((entry) => resolveOneReference(context, baseUrl, spaceId, model, field, entry, allowMe)),
    );
  }
  return await resolveOneReference(context, baseUrl, spaceId, model, field, value, allowMe);
}

async function prepareAgentInput(
  context: AgentRuntimeContext,
  baseUrl: string,
  model: DiscoveryModel,
  config: AgentToolConfig,
  raw: unknown,
): Promise<unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const input = { ...(raw as Record<string, unknown>) };

  if (config.operation === 'query' && model.query.canonical && config.queryMode !== 'capability') {
    if (!Array.isArray(input.filters)) return input;
    const filters = [];
    for (const rawFilter of input.filters) {
      if (!rawFilter || typeof rawFilter !== 'object' || Array.isArray(rawFilter)) {
        filters.push(rawFilter);
        continue;
      }
      const filter = { ...(rawFilter as Record<string, unknown>) };
      const fieldKey = String(filter.field ?? '');
      const target = model.query.canonical.filter.targets.find((entry) => entry.field === fieldKey);
      const field = model.fields.find((entry) => entry.key === fieldKey);
      if (field && target && relationField(field) && filter.value !== undefined) {
        filter.value = await resolveOneReference(
          context,
          baseUrl,
          config.spaceId,
          model,
          field,
          filter.value,
          target.acceptsCurrentActorPersonAlias === 'me',
        );
      }
      filters.push(filter);
    }
    input.filters = filters;
    return input;
  }

  const fields = config.operation === 'action'
    ? model.actions.find((action) => action.key === config.actionKey)?.input.fields ?? []
    : config.operation === 'create' || config.operation === 'update'
      ? model.fields
      : [];

  for (const field of fields) {
    if (!relationField(field) || input[field.key] === undefined) continue;
    input[field.key] = await resolveFieldReference(
      context,
      baseUrl,
      config.spaceId,
      model,
      field,
      input[field.key],
    );
  }
  return input;
}

function referenceFailureInstruction(reference: AgentReferenceFailure): string {
  if (reference.code === 'REFERENCE_NOT_FOUND') {
    return 'Do not retry this Tool with the same or a guessed name/ID. Tell the user no matching LifeSpace reference exists in this Space and ask them to provide or choose an existing reference.';
  }
  if (reference.code === 'AMBIGUOUS_REFERENCE') {
    return 'Do not guess among candidates or retry unchanged. Ask the user to choose the intended reference from the returned candidates.';
  }
  return 'Do not retry name lookup unchanged. Ask the user for clarification or a stable reference ID if they have one.';
}

function toolFailureOutput(error: unknown, executionError: NodeOperationError): string {
  const reference = parseReferenceFailure(error);
  if (reference) {
    return JSON.stringify({
      ok: false,
      error: {
        ...reference,
        retryable: false,
        nextAction: 'ask_user',
        instruction: referenceFailureInstruction(reference),
      },
    });
  }
  const queryFailure = parseAgentQueryFailure(error);
  if (queryFailure) {
    return JSON.stringify({
      ok: false,
      error: {
        ...queryFailure,
        retryable: true,
        nextAction: 'retry_with_corrected_arguments',
      },
    });
  }
  return JSON.stringify({
    ok: false,
    error: {
      code: 'LIFESPACE_TOOL_CALL_FAILED',
      message: executionError.message,
      retryable: false,
      nextAction: 'report_failure',
    },
  });
}

function toolError(context: AgentRuntimeContext, error: unknown): NodeOperationError {
  if (error instanceof NodeOperationError) return error;
  if (error && typeof error === 'object') {
    try {
      const apiError = new NodeApiError(context.getNode(), error as JsonObject);
      return new NodeOperationError(context.getNode(), apiError.message);
    } catch {
      // Fall through to a bounded generic message.
    }
  }
  return new NodeOperationError(
    context.getNode(),
    error instanceof Error ? error.message : 'LifeSpace Tool call failed',
  );
}

export class LifeSpaceTool implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace Tool',
    name: 'lifeSpaceTool',
    icon: {
      light: 'file:lifespace.svg',
      dark: 'file:lifespace.dark.svg',
    },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + " · " + $parameter["recordType"]}}',
    description: 'Expose one metadata-driven LifeSpace operation to an AI Agent',
    defaults: {
      name: 'LifeSpace Tool',
    },
    inputs: [],
    outputs: [NodeConnectionTypes.AiTool],
    outputNames: ['Tool'],
    credentials: [
      {
        name: 'lifeSpaceApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Space Name or ID',
        name: 'spaceId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getSpaces' },
        options: [],
        default: '',
        required: true,
        noDataExpression: true,
        description: 'Fixes this Tool instance to one authorized LifeSpace Space. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Create Record',
            value: 'create',
            description: 'Create one record using fields published by Runtime Discovery',
												action: 'Create one record using fields published by runtime discovery',
          },
          {
            name: 'Delete Record',
            value: 'delete',
            description: 'Delete one record using current optimistic concurrency',
												action: 'Delete one record using current optimistic concurrency',
          },
          {
            name: 'Execute Action',
            value: 'action',
            description: 'Execute one published semantic Action on a record',
												action: 'Execute one published semantic action on a record',
          },
          {
            name: 'Query Records',
            value: 'query',
            description: 'Query records using the published LifeSpace query contract',
												action: 'Query records using the published life space query contract',
          },
          {
            name: 'Update Record',
            value: 'update',
            description: 'Update only fields the Agent explicitly supplies',
												action: 'Update only fields the agent explicitly supplies',
          },
        ],
        default: 'query',
      },
      {
        displayName: 'Record Type Name or ID',
        name: 'recordType',
        type: 'options',
        noDataExpression: true,
        typeOptions: { loadOptionsMethod: 'getRecordTypes', loadOptionsDependsOn: ['spaceId', 'operation'] },
        options: [],
        default: '',
        required: true,
        description: 'Fixes this Tool instance to one LifeSpace Record Type and pins its current semantic contract into the workflow. Reselect the Record Type to refresh the pinned contract after a LifeSpace model change.',
      },
      {
        displayName: 'Query Mode',
        name: 'queryMode',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Generic Query',
            value: 'generic',
            description: 'Use search, filters, explicit comparisons, local-date windows, sort, and pagination published by LifeSpace',
          },
          {
            name: 'Capability Query',
            value: 'capability',
            description: 'Use one grouped capability-owned query such as Calendar viewing window',
          },
        ],
        default: 'generic',
        displayOptions: { show: { operation: ['query'] } },
      },
      {
        displayName: 'Capability Query Name or ID',
        name: 'capabilityQueryKey',
        type: 'options',
        noDataExpression: true,
        typeOptions: {
          loadOptionsMethod: 'getCapabilityQueries',
          loadOptionsDependsOn: ['spaceId', 'recordType'],
        },
        options: [],
        default: '',
        required: true,
        displayOptions: { show: { operation: ['query'], queryMode: ['capability'] } },
        description: 'Choose a semantic query published by the selected LifeSpace model. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Action Name or ID',
        name: 'actionKey',
        type: 'options',
        noDataExpression: true,
        typeOptions: {
          loadOptionsMethod: 'getActions',
          loadOptionsDependsOn: ['spaceId', 'recordType'],
        },
        options: [],
        default: '',
        required: true,
        displayOptions: { show: { operation: ['action'] } },
        description: 'Choose one published Action. Concurrency/version metadata is handled by the Adapter, not by the AI. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Description Override',
        name: 'descriptionOverride',
        type: 'string',
        default: '',
        typeOptions: { rows: 3 },
        description: 'Optional. Leave empty to use the deterministic description generated from Space, model, operation, and LifeSpace semantics.',
      },
    ],
  };

  methods = {
    loadOptions: {
      async getSpaces(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const discovery = await loadRuntimeDiscoveryInventory.call(this);
        return discovery.data.spaces.map((space) => ({
          name: space.spaceName?.trim() || space.spaceId,
          value: space.spaceId,
        }));
      },
      async getRecordTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const spaceId = loadOptionParameter(this, 'spaceId');
        const operation = loadOptionParameter(this, 'operation') || 'query';
        if (!spaceId) return [];

        const discovery = await loadRuntimeDiscoveryInventory.call(this);
        const space = discoverySpace(discovery, spaceId);
        if (!space) return [];

        const candidates = space.models.filter((model) => modelSupportsOperation(model, operation));
        const models = await Promise.all(
          candidates.map((model) => loadDesignTimeSemanticDetail.call(this, spaceId, model)),
        );

        return models.map((model) => ({
          name: model.display.singular?.trim() || model.key,
          value: encodeAgentToolSemanticSnapshot({
            format: 1,
            spaceId,
            spaceName: space.spaceName ?? null,
            model,
          }),
          description: model.description ?? undefined,
        }));
      },
      async getActions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await selectedOptionModel(this);
        if (!selected) return [];
        return selected.model.actions
          .filter((action) => selected.model.access.includes(action.access))
          .map((action) => ({
            name: action.key,
            value: action.key,
            description: `${action.kind} Action · requires ${action.access} access`,
          }));
      },
      async getCapabilityQueries(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await selectedOptionModel(this);
        if (!selected) return [];
        return (selected.model.query.capabilityQueries ?? []).map((query) => ({
          name: `${query.capability} · ${query.key}`,
          value: query.key,
          description: query.semantics,
        }));
      },
    },
  };

  private async agentRuntime(
    context: AgentRuntimeContext,
    itemIndex: number,
  ): Promise<AgentRuntime> {
    const credentials = await context.getCredentials('lifeSpaceApi', itemIndex);
    const baseUrl = normalizeBaseUrl(credentials.baseUrl);
    const spaceId = String(context.getNodeParameter('spaceId', itemIndex)).trim();
    const snapshot = decodeAgentToolSemanticSnapshot(context.getNodeParameter('recordType', itemIndex, ''));
    if (!snapshot) {
      throw new NodeOperationError(
        context.getNode(),
        'This LifeSpace Tool has no saved design-time semantic contract. Open the node, reselect Record Type, and save the workflow before running it.',
        { itemIndex },
      );
    }
    if (snapshot.spaceId !== spaceId) {
      throw new NodeOperationError(
        context.getNode(),
        'The saved LifeSpace Tool semantic contract belongs to a different Space. Reselect Record Type and save the workflow.',
        { itemIndex },
      );
    }

    const operation = context.getNodeParameter('operation', itemIndex) as AgentToolOperation;
    const queryMode = context.getNodeParameter('queryMode', itemIndex, 'generic') as AgentToolQueryMode;
    const capabilityQueryKey = String(context.getNodeParameter('capabilityQueryKey', itemIndex, '') ?? '').trim();
    const actionKey = String(context.getNodeParameter('actionKey', itemIndex, '') ?? '').trim();
    const descriptionOverride = String(context.getNodeParameter('descriptionOverride', itemIndex, '') ?? '').trim();

    const model = snapshot.model;

    const config: AgentToolConfig = {
      spaceId,
      spaceName: snapshot.spaceName,
      operation,
      queryMode,
      capabilityQueryKey,
      actionKey,
      descriptionOverride,
      viewingTimezone: context.getTimezone(),
    };

    let definition;
    try {
      definition = buildAgentToolDefinition(model, config);
    } catch (error) {
      throw new NodeOperationError(context.getNode(), error as Error, { itemIndex });
    }

    return { baseUrl, model, config, definition };
  }

  private async invokeAgentTool(
    context: AgentRuntimeContext,
    runtime: AgentRuntime,
    query: unknown,
  ): Promise<string> {
    const prepared = await prepareAgentInput(
      context,
      runtime.baseUrl,
      runtime.model,
      runtime.config,
      query,
    );
    let request = buildAgentToolRequest(runtime.model, runtime.config, prepared);
    if (request.needsCurrentVersion) {
      const recordResponse = await performRequest(context, runtime.baseUrl, {
        method: 'GET',
        path: currentRecordPath(request),
      });
      request = buildAgentToolRequest(
        runtime.model,
        runtime.config,
        prepared,
        currentRecordVersion(context, recordResponse),
      );
    }
    const response = await performRequest(context, runtime.baseUrl, request);
    return stringifyToolOutput(response);
  }

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const runtime = await LifeSpaceTool.prototype.agentRuntime.call(this, this, itemIndex);

    // n8n Tools Agent V3 reconstructs ordinary Tool history from the source node name.
    // Keep the provider-facing Tool identity aligned with that reconstruction so a
    // completed Tool call is attached to the same identity on the next Agent iteration.
    // LifeSpace's semantic identity remains available as metadata/description instead.
    const tool: StructuralAiTool = {
      name: nodeNameToToolName(this.getNode()),
      description: runtime.definition.description,
      schema: runtime.definition.schema,
      metadata: {
        lifeSpaceSemanticToolName: runtime.definition.name,
        lifeSpaceModelVersion: runtime.model.version,
        lifeSpaceSchemaHash: runtime.model.schemaHash,
      },
      invoke: async (query: unknown): Promise<string> => {
        const { index } = this.addInputData(NodeConnectionTypes.AiTool, [[{ json: { query: inputForLog(query) } }]]);
        let output: string;
        let executionError: NodeOperationError | undefined;
        try {
          output = await LifeSpaceTool.prototype.invokeAgentTool.call(this, this, runtime, query);
        } catch (error) {
          executionError = toolError(this, error);
          output = toolFailureOutput(error, executionError);
        }

        if (executionError) {
          void this.addOutputData(NodeConnectionTypes.AiTool, index, executionError);
        } else {
          void this.addOutputData(NodeConnectionTypes.AiTool, index, [[{ json: { response: output } }]]);
        }
        return output;
      },
    };

    return { response: tool };
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      if (!item) continue;

      try {
        const runtime = await LifeSpaceTool.prototype.agentRuntime.call(this, this, itemIndex);
        const input = semanticToolInput(runtime.definition.schema, item.json);
        const response = await LifeSpaceTool.prototype.invokeAgentTool.call(this, this, runtime, input);
        output.push({
          json: { response },
          pairedItem: { item: itemIndex },
        });
      } catch (error) {
        const executionError = toolError(this, error);
        const structuredFailure = parseReferenceFailure(error) ?? parseAgentQueryFailure(error);
        if (structuredFailure) {
          output.push({
            json: { response: toolFailureOutput(error, executionError) },
            pairedItem: { item: itemIndex },
          });
          continue;
        }
        throw new NodeOperationError(this.getNode(), executionError.message, { itemIndex });
      }
    }

    return [output];
  }
}
