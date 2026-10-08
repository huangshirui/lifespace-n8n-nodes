import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeProperties,
  ISupplyDataFunctions,
  SupplyData,
} from 'n8n-workflow';
import {
  NodeConnectionTypes,
  NodeOperationError,
  nodeNameToToolName,
} from 'n8n-workflow';
import {
  buildMultiMutationDefinition,
  buildMultiMutationRequest,
  prepareMultiMutationInput,
  type AgentMutationMode,
  type AgentMutationOperation,
} from '../agent/lifeSpaceMultiMutationTool';
import {
  buildPersonToolDefinition,
  buildPersonToolRequest,
  personToolRequiredAccess,
  type PersonToolOperation,
} from '../agent/lifeSpacePersonTool';
import type { AgentToolConfig, AgentToolRequest, AgentToolSchema } from '../agent/lifeSpaceToolFactory';
import { decodeAgentToolSemanticSnapshot } from '../agent/lifeSpaceToolSnapshot';
import { LifeSpaceTool } from '../LifeSpaceTool/LifeSpaceTool.node';
import {
  delegatedAgentCoreBaseUrl,
  executionAuthority,
  lifeSpaceRequest,
  type LifeSpaceExecutionAuthority,
} from '../shared/lifeSpaceExecutionAuthority';

type StructuralAiTool = {
  name: string;
  description: string;
  schema: AgentToolSchema;
  metadata: Record<string, unknown>;
  invoke: (query: unknown) => Promise<string>;
};

type AgentRuntimeContext = IExecuteFunctions | ISupplyDataFunctions;

type AuthorizationScope = {
  target: { type: 'space' | 'model' | 'record'; id: string };
  maxAccess: 'read' | 'write' | 'manage';
};

type CustomToolRuntime = {
  baseUrl: string;
  spaceId: string;
  schema: AgentToolSchema;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  requiredAccess: 'read' | 'write';
};

type AgentRecordBatchSettings = {
  batchProcessing: boolean;
  atomicConsistency: boolean;
  atomicFromAiKey: string | null;
};

const LEGACY_AUTH_PARAMETERS = new Set([
  'authorityMode',
  'principalUserId',
  'delegationId',
  'readDelegationId',
]);

const USER_AUTH_RECOVERABLE_CODES = new Set([
  'DELEGATION_REQUIRED',
  'DELEGATION_INVALID',
  'DELEGATION_SCOPE_INSUFFICIENT',
  'PRINCIPAL_AUTHORITY_INSUFFICIENT',
]);

const FROM_AI_KEY = /\$fromAI\s*\(\s*(['"])([A-Za-z0-9_-]{1,64})\1/u;

function internalOnly(property: INodeProperties): INodeProperties {
  if (!LEGACY_AUTH_PARAMETERS.has(property.name)) return property;
  return {
    ...property,
    ...(property.name === 'authorityMode' ? { default: 'delegatedAgent' } : {}),
    displayOptions: { show: { __lifeSpaceInternalOnly: ['true'] } },
  };
}

function authorizationProperties(): INodeProperties[] {
  return [
    {
      displayName: 'Enable User Authorization',
      name: 'enableUserAuthorization',
      type: 'boolean',
      default: false,
      noDataExpression: true,
      description: 'Whether the Agent may optionally execute this Tool as a User Principal by supplying a runtime Delegation ID. When disabled, the Tool always uses the Agent\'s own Authority.',
    },
    {
      displayName: 'Principal User ID',
      name: 'authorizationPrincipalUserId',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'usr_...',
      displayOptions: { show: { enableUserAuthorization: [true] } },
      description: 'Trusted workflow context for the User whose Delegation may be used. Configure this with an n8n expression from the identity-mapping step. It is never exposed as an AI Tool argument.',
    },
  ];
}

function toolResourceProperty(): INodeProperties {
  return {
    displayName: 'Resource',
    name: 'toolResource',
    type: 'options',
    noDataExpression: true,
    options: [
      {
        name: 'Record',
        value: 'record',
        description: 'Use one ordinary metadata-driven LifeSpace model through Runtime Discovery',
      },
      {
        name: 'Person',
        value: 'person',
        description: 'Use the Kernel first-class Space Person Directory',
      },
    ],
    default: 'record',
  };
}

function personOperationProperty(): INodeProperties {
  return {
    displayName: 'Operation',
    name: 'personOperation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { toolResource: ['person'] } },
    options: [
      { name: 'Create Person', value: 'create', action: 'Create a person', description: 'Create an unlinked Space Person' },
      { name: 'Delete Person', value: 'delete', action: 'Delete a person', description: 'Delete an unlinked Space Person using current optimistic concurrency' },
      { name: 'Get Person', value: 'get', action: 'Get a person', description: 'Get one Space Person by stable per_* ID' },
      { name: 'List / Search People', value: 'list', action: 'List or search people', description: 'Search canonical and alternate Person names with bounded cursor pagination' },
      { name: 'Update Person', value: 'update', action: 'Update a person', description: 'Update canonical or alternate Person names using current optimistic concurrency' },
    ],
    default: 'list',
  };
}

function recordOptionsProperty(): INodeProperties {
  return {
    displayName: 'Options',
    name: 'recordOptions',
    type: 'collection',
    placeholder: 'Add Option',
    default: { batchProcessing: true },
    displayOptions: {
      show: {
        toolResource: ['record'],
        operation: ['create', 'update', 'delete'],
      },
    },
    options: [
      {
        displayName: 'Batch Processing',
        name: 'batchProcessing',
        type: 'boolean',
        default: true,
        noDataExpression: true,
        description: 'Whether to group 1-20 Tool items into one LifeSpace request. Defaults on. When enabled without Atomic Consistency, items succeed or fail independently and partial success is preserved.',
      },
      {
        displayName: 'Atomic Consistency',
        name: 'atomicConsistency',
        type: 'boolean',
        default: false,
        description: 'Whether all items must commit together or roll back together. Leave off for normal independent Bulk processing. In an AI Agent workflow, use n8n\'s “Let the model define this parameter” control only when the Agent should decide per Tool call whether the user\'s intent requires all-or-none semantics.',
      },
    ],
  };
}

function withRecordOnly(property: INodeProperties): INodeProperties {
  if (property.name === 'operation') {
    return {
      ...property,
      options: (property.options ?? []).filter(
        (option) => !('value' in option) || option.value !== 'batchCreate',
      ),
      displayOptions: { show: { toolResource: ['record'] } },
    };
  }
  if (property.name === 'recordType') {
    return { ...property, displayOptions: { show: { toolResource: ['record'] } } };
  }
  if (property.name === 'actionKey') {
    return {
      ...property,
      displayOptions: { show: { toolResource: ['record'], operation: ['action'] } },
    };
  }
  return property;
}

function agentProperties(properties: INodeProperties[]): INodeProperties[] {
  const projected = properties
    .filter((property) => !['queryMode', 'capabilityQueryKey', 'batchDelegationIds'].includes(property.name))
    .map(internalOnly)
    .map(withRecordOnly);

  const spaceIndex = projected.findIndex((property) => property.name === 'spaceId');
  const insertAt = spaceIndex >= 0 ? spaceIndex : 0;
  projected.splice(insertAt, 0, ...authorizationProperties(), toolResourceProperty());

  const actualSpaceIndex = projected.findIndex((property) => property.name === 'spaceId');
  projected.splice(actualSpaceIndex + 1, 0, personOperationProperty());

  projected.push(recordOptionsProperty());
  return projected;
}

function agentExecutionContext<T extends AgentRuntimeContext>(
  context: T,
  itemIndex: number,
  principalUserId: string,
  delegationId: string,
): T {
  return new Proxy(context, {
    get(target, property, receiver) {
      if (property !== 'getNodeParameter') return Reflect.get(target, property, receiver);
      return (name: string, requestedItemIndex: number, fallback?: unknown, options?: unknown) => {
        if (name === 'authorityMode') return 'delegatedAgent';
        if (name === 'principalUserId') return delegationId ? principalUserId : '';
        if (name === 'delegationId' || name === 'readDelegationId') return delegationId;
        return target.getNodeParameter(
          name,
          requestedItemIndex ?? itemIndex,
          fallback as never,
          options as never,
        );
      };
    },
  }) as T;
}

function toolInput(query: unknown): { semantic: unknown; delegationId: string } {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return { semantic: query, delegationId: '' };
  }
  const semantic = { ...(query as Record<string, unknown>) };
  const delegationId = String(semantic.delegationId ?? '').trim();
  delete semantic.delegationId;
  return { semantic, delegationId };
}

function invalidDelegationOutput(): string {
  return JSON.stringify({
    ok: false,
    error: {
      code: 'INVALID_DELEGATION_ID',
      message: 'delegationId must be a valid LifeSpace dlg_* identifier',
      retryable: false,
      nextAction: 'request_authorization',
    },
  });
}

function requiredAccess(
  operation: string,
  actionKey: string,
  snapshot: ReturnType<typeof decodeAgentToolSemanticSnapshot>,
): AuthorizationScope['maxAccess'] | null {
  if (operation === 'query') return 'read';
  if (['create', 'update', 'delete'].includes(operation)) return 'write';
  if (operation !== 'action' || !snapshot) return null;
  const access = snapshot.model.actions.find((action) => action.key === actionKey)?.access;
  return access === 'read' || access === 'write' || access === 'manage' ? access : null;
}

function currentRecordOperation(
  context: AgentRuntimeContext,
  itemIndex: number,
): string {
  const operation = String(context.getNodeParameter('operation', itemIndex, 'query') ?? 'query');
  if (operation === 'batchCreate') {
    throw new NodeOperationError(
      context.getNode(),
      'Legacy Agent Tool operation batchCreate is no longer supported. Select Create and configure Batch Processing / Atomic Consistency under Options.',
    );
  }
  return operation;
}

function rawRecordOptions(context: AgentRuntimeContext): Record<string, unknown> {
  const node = context.getNode() as unknown as { parameters?: Record<string, unknown> };
  const raw = node.parameters?.recordOptions;
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
}

function fromAiKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return FROM_AI_KEY.exec(value)?.[2] ?? null;
}

function recordBatchSettings(
  context: AgentRuntimeContext,
  itemIndex: number,
): AgentRecordBatchSettings {
  const raw = rawRecordOptions(context);
  const atomicFromAiKey = fromAiKey(raw.atomicConsistency);
  const evaluated = atomicFromAiKey
    ? {} as IDataObject
    : context.getNodeParameter('recordOptions', itemIndex, {}) as IDataObject;
  const batchValue = raw.batchProcessing ?? evaluated.batchProcessing;
  return {
    batchProcessing: batchValue === undefined ? true : batchValue === true,
    atomicConsistency: atomicFromAiKey
      ? false
      : raw.atomicConsistency === true || evaluated.atomicConsistency === true,
    atomicFromAiKey,
  };
}

function authorizationScope(
  context: AgentRuntimeContext,
  itemIndex: number,
  semantic: unknown,
): { spaceId: string; scopes: AuthorizationScope[] } | null {
  const spaceId = String(context.getNodeParameter('spaceId', itemIndex, '') ?? '').trim();
  if (!spaceId) return null;
  const resource = String(context.getNodeParameter('toolResource', itemIndex, 'record') ?? 'record');
  if (resource === 'person') {
    const operation = String(context.getNodeParameter('personOperation', itemIndex, 'list') ?? 'list') as PersonToolOperation;
    return {
      spaceId,
      scopes: [{
        target: { type: 'space', id: spaceId },
        maxAccess: personToolRequiredAccess(operation),
      }],
    };
  }

  const snapshot = decodeAgentToolSemanticSnapshot(context.getNodeParameter('recordType', itemIndex, ''));
  if (!snapshot) return null;
  const operation = currentRecordOperation(context, itemIndex);
  const actionKey = String(context.getNodeParameter('actionKey', itemIndex, '') ?? '').trim();
  const access = requiredAccess(operation, actionKey, snapshot);
  if (!access) return null;
  const batchProcessing = ['create', 'update', 'delete'].includes(operation)
    ? recordBatchSettings(context, itemIndex).batchProcessing
    : false;
  const input = semantic && typeof semantic === 'object' && !Array.isArray(semantic)
    ? semantic as Record<string, unknown>
    : {};
  const recordId = String(input.recordId ?? '').trim();
  const recordScoped = !batchProcessing
    && ['update', 'delete', 'action'].includes(operation)
    && /^rec_[A-Za-z0-9_-]+$/u.test(recordId);
  const scope: AuthorizationScope = recordScoped
    ? { target: { type: 'record', id: recordId }, maxAccess: access }
    : { target: { type: 'model', id: snapshot.model.key }, maxAccess: access };
  return { spaceId, scopes: [scope] };
}

function withAuthorizationRequired(
  output: string,
  required: { spaceId: string; scopes: AuthorizationScope[] } | null,
): string {
  if (!required) return output;
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch {
    return output;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  const result = value as Record<string, unknown>;
  const error = result.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return output;
  const errorRecord = error as Record<string, unknown>;
  const code = String(errorRecord.code ?? '');
  if (!USER_AUTH_RECOVERABLE_CODES.has(code)) return output;
  return JSON.stringify({
    ...result,
    error: {
      ...errorRecord,
      retryable: false,
      nextAction: 'request_authorization',
      instruction: 'Call LifeSpace Request Authorization with authorizationRequired. After confirmation, retry this Tool with the returned dlg_* as delegationId.',
    },
    authorizationRequired: required,
  });
}

function parseJsonCandidate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function structuredFailure(error: unknown): string {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = parseJsonCandidate(queue.shift());
    if (!current || typeof current !== 'object' || Array.isArray(current) || seen.has(current)) continue;
    seen.add(current);
    const object = current as Record<string, unknown>;
    const nested = object.error;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const apiError = nested as Record<string, unknown>;
      const code = String(apiError.code ?? '');
      if (code) {
        return JSON.stringify({
          ok: false,
          error: {
            code,
            message: typeof apiError.message === 'string' ? apiError.message : 'LifeSpace Tool call failed',
            retryable: false,
            nextAction: USER_AUTH_RECOVERABLE_CODES.has(code) ? 'request_authorization' : 'report_failure',
          },
        });
      }
    }
    for (const key of ['body', 'data', 'response', 'cause', 'description', 'message']) {
      if (object[key] !== undefined) queue.push(object[key]);
    }
  }
  return JSON.stringify({
    ok: false,
    error: {
      code: 'LIFESPACE_TOOL_CALL_FAILED',
      message: error instanceof Error ? error.message : 'LifeSpace Tool call failed',
      retryable: false,
      nextAction: 'report_failure',
    },
  });
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

function currentVersion(context: AgentRuntimeContext, response: unknown): number {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace current-resource lookup returned an invalid response');
  }
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace current-resource lookup returned an invalid data envelope');
  }
  const version = (data as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace current-resource lookup did not expose a usable version');
  }
  return version;
}

async function agentBaseUrl(context: AgentRuntimeContext, itemIndex: number): Promise<string> {
  return delegatedAgentCoreBaseUrl(
    context,
    await context.getCredentials('lifeSpaceAgentExecutionApi', itemIndex),
  );
}

function inputForLog(value: unknown): IDataObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as IDataObject
    : { value: String(value ?? '') };
}

function semanticToolInput(schema: AgentToolSchema, value: IDataObject): IDataObject {
  if (typeof value.toolCallId !== 'string') return value;
  const input: IDataObject = {};
  for (const key of Object.keys(schema.properties)) {
    if (Object.prototype.hasOwnProperty.call(value, key)) input[key] = value[key];
  }
  if (Object.prototype.hasOwnProperty.call(value, 'delegationId')) input.delegationId = value.delegationId;
  return input;
}

async function invokePerson(
  context: AgentRuntimeContext,
  itemIndex: number,
  semantic: unknown,
  delegationId: string,
): Promise<string> {
  const operation = String(context.getNodeParameter('personOperation', itemIndex, 'list') ?? 'list') as PersonToolOperation;
  const spaceId = String(context.getNodeParameter('spaceId', itemIndex, '') ?? '').trim();
  const executionContext = agentExecutionContext(context, itemIndex, '', delegationId);
  const authority = await executionAuthority(
    executionContext,
    itemIndex,
    personToolRequiredAccess(operation),
    { requireDelegation: false },
  );
  const baseUrl = await agentBaseUrl(executionContext, itemIndex);
  let request = buildPersonToolRequest(spaceId, operation, semantic);
  if (request.needsCurrentVersion) {
    const current = await lifeSpaceRequest(executionContext, authority, {
      method: 'GET',
      url: `${baseUrl}${request.path}`,
      json: true,
    });
    request = buildPersonToolRequest(spaceId, operation, semantic, currentVersion(context, current));
  }
  const response = await lifeSpaceRequest(
    executionContext,
    authority,
    requestOptions(baseUrl, request),
  );
  return stringifyToolOutput(response);
}

async function personRuntime(
  context: AgentRuntimeContext,
  itemIndex: number,
): Promise<CustomToolRuntime> {
  const spaceId = String(context.getNodeParameter('spaceId', itemIndex, '') ?? '').trim();
  const operation = String(context.getNodeParameter('personOperation', itemIndex, 'list') ?? 'list') as PersonToolOperation;
  const descriptionOverride = String(context.getNodeParameter('descriptionOverride', itemIndex, '') ?? '').trim();
  const definition = buildPersonToolDefinition(spaceId, null, operation, descriptionOverride);
  return {
    baseUrl: await agentBaseUrl(context, itemIndex),
    spaceId,
    schema: definition.schema,
    name: definition.name,
    description: definition.description,
    metadata: { lifeSpaceResource: 'person', lifeSpacePersonOperation: operation },
    requiredAccess: definition.requiredAccess,
  };
}

function dynamicAtomicDescription(
  model: NonNullable<ReturnType<typeof decodeAgentToolSemanticSnapshot>>['model'],
  config: AgentToolConfig,
  operation: AgentMutationOperation,
  key: string,
): string {
  const plural = model.display.plural?.trim() || `${model.display.singular?.trim() || model.key}s`;
  const verb = operation === 'create' ? 'Create' : operation === 'update' ? 'Update' : 'Delete';
  const base = config.descriptionOverride?.trim()
    || `${verb} 1-20 ${plural} in Space "${config.spaceName?.trim() || config.spaceId}".`;
  const recordGuidance = operation === 'create'
    ? ''
    : ' Versions are resolved when omitted. Use stable record IDs; never guess them.';
  return `${base} "${key}" defaults false: non-atomic Bulk; items commit independently and partial success is possible. Set true only when the user requires all items in this Tool call to commit or roll back together. Item count alone is not a reason to choose atomic. Atomicity never spans Tool calls, operations, models, or Spaces. After Bulk partial failure, retry only failed items; never resend succeeded items.${recordGuidance}`;
}

async function multiRuntime(
  context: AgentRuntimeContext,
  itemIndex: number,
): Promise<CustomToolRuntime & {
  model: NonNullable<ReturnType<typeof decodeAgentToolSemanticSnapshot>>['model'];
  config: AgentToolConfig;
  operation: AgentMutationOperation;
  mode: Exclude<AgentMutationMode, 'single'>;
  atomicFromAiKey: string | null;
}> {
  const spaceId = String(context.getNodeParameter('spaceId', itemIndex, '') ?? '').trim();
  const snapshot = decodeAgentToolSemanticSnapshot(context.getNodeParameter('recordType', itemIndex, ''));
  if (!snapshot || snapshot.spaceId !== spaceId) {
    throw new NodeOperationError(context.getNode(), 'This LifeSpace Agent Tool has no valid saved semantic contract. Reselect Record Type and save the workflow.');
  }
  const operation = currentRecordOperation(context, itemIndex) as AgentMutationOperation;
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new NodeOperationError(context.getNode(), 'Batch Processing is supported only for create/update/delete');
  }
  const batchSettings = recordBatchSettings(context, itemIndex);
  if (!batchSettings.batchProcessing) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace multi-mutation requires Batch Processing to be enabled');
  }
  const mode: Exclude<AgentMutationMode, 'single'> = batchSettings.atomicConsistency ? 'atomic' : 'bulk';
  const config: AgentToolConfig = {
    spaceId,
    spaceName: snapshot.spaceName,
    operation,
    queryMode: 'generic',
    actionKey: '',
    capabilityQueryKey: '',
    descriptionOverride: String(context.getNodeParameter('descriptionOverride', itemIndex, '') ?? '').trim(),
    viewingTimezone: context.getTimezone(),
  };
  const definition = buildMultiMutationDefinition(snapshot.model, config, operation, mode);
  const atomicFromAiKey = batchSettings.atomicFromAiKey;
  const schema = atomicFromAiKey
    ? {
      ...definition.schema,
      properties: {
        ...definition.schema.properties,
        [atomicFromAiKey]: {
          type: 'boolean',
          default: false,
          description: 'All-or-none for this Tool call. Defaults false. Set true only when the user requires every item to commit together; item count alone does not imply atomicity.',
        },
      },
    } satisfies AgentToolSchema
    : definition.schema;
  return {
    baseUrl: await agentBaseUrl(context, itemIndex),
    spaceId,
    schema,
    name: definition.name,
    description: atomicFromAiKey
      ? dynamicAtomicDescription(snapshot.model, config, operation, atomicFromAiKey)
      : definition.description,
    metadata: {
      lifeSpaceModelVersion: snapshot.model.version,
      lifeSpaceSchemaHash: snapshot.model.schemaHash,
      lifeSpaceMutationMode: atomicFromAiKey ? 'agent-controlled' : mode,
      ...(atomicFromAiKey ? { lifeSpaceAtomicConsistencyArgument: atomicFromAiKey } : {}),
    },
    requiredAccess: 'write',
    model: snapshot.model,
    config,
    operation,
    mode,
    atomicFromAiKey,
  };
}

function selectedMultiMode(
  context: AgentRuntimeContext,
  runtime: Awaited<ReturnType<typeof multiRuntime>>,
  semantic: unknown,
): { mode: Exclude<AgentMutationMode, 'single'>; semantic: unknown } {
  if (!runtime.atomicFromAiKey) return { mode: runtime.mode, semantic };
  if (!semantic || typeof semantic !== 'object' || Array.isArray(semantic)) {
    return { mode: 'bulk', semantic };
  }
  const input = { ...(semantic as Record<string, unknown>) };
  const rawAtomic = input[runtime.atomicFromAiKey];
  delete input[runtime.atomicFromAiKey];
  if (rawAtomic !== undefined && typeof rawAtomic !== 'boolean') {
    throw new NodeOperationError(
      context.getNode(),
      `LifeSpace Atomic Consistency Tool argument ${runtime.atomicFromAiKey} must be boolean`,
    );
  }
  return { mode: rawAtomic === true ? 'atomic' : 'bulk', semantic: input };
}

async function invokeMulti(
  context: AgentRuntimeContext,
  itemIndex: number,
  semantic: unknown,
  delegationId: string,
): Promise<string> {
  const runtime = await multiRuntime(context, itemIndex);
  const selected = selectedMultiMode(context, runtime, semantic);
  const executionContext = agentExecutionContext(context, itemIndex, '', delegationId);
  const authority = await executionAuthority(executionContext, itemIndex, 'write', { requireDelegation: false });
  const requester = async (options: IHttpRequestOptions) => lifeSpaceRequest(executionContext, authority, options);
  const prepared = await prepareMultiMutationInput(
    executionContext as ISupplyDataFunctions,
    runtime.baseUrl,
    runtime.model,
    runtime.config,
    runtime.operation,
    runtime.schema,
    selected.semantic,
    requester,
  );
  const request = buildMultiMutationRequest(
    runtime.model,
    runtime.config,
    runtime.operation,
    selected.mode,
    prepared,
    authority.mode === 'delegatedAgent' ? authority.delegationId ?? '' : '',
  );
  const outerAuthority: LifeSpaceExecutionAuthority = authority.mode === 'delegatedAgent'
    ? { ...authority, delegationId: null }
    : authority;
  const response = await lifeSpaceRequest(
    executionContext,
    outerAuthority,
    requestOptions(runtime.baseUrl, request),
  );
  return stringifyToolOutput(response);
}

function customTool(
  context: ISupplyDataFunctions,
  itemIndex: number,
  runtime: CustomToolRuntime,
  invoke: (query: unknown) => Promise<string>,
): StructuralAiTool {
  return {
    name: nodeNameToToolName(context.getNode()),
    description: runtime.description,
    schema: runtime.schema,
    metadata: {
      lifeSpaceSemanticToolName: runtime.name,
      ...runtime.metadata,
    },
    invoke: async (query: unknown): Promise<string> => {
      const { index } = context.addInputData(
        NodeConnectionTypes.AiTool,
        [[{ json: { query: inputForLog(query) } }]],
      );
      let output: string;
      try {
        output = await invoke(query);
      } catch (error) {
        output = structuredFailure(error);
      }
      void context.addOutputData(
        NodeConnectionTypes.AiTool,
        index,
        [[{ json: { response: output } }]],
      );
      return output;
    },
  };
}

function authorizationSettings(
  context: AgentRuntimeContext,
  itemIndex: number,
): { enabled: boolean; principalUserId: string } {
  const enabled = Boolean(context.getNodeParameter('enableUserAuthorization', itemIndex, false));
  return {
    enabled,
    principalUserId: enabled
      ? String(context.getNodeParameter('authorizationPrincipalUserId', itemIndex, '') ?? '').trim()
      : '',
  };
}

function wrapOptionalAuthorization(
  context: ISupplyDataFunctions,
  itemIndex: number,
  baseTool: StructuralAiTool,
  principalUserId: string,
  invokeWithDelegation: (semantic: unknown, delegationId: string) => Promise<string>,
): StructuralAiTool {
  const schema: AgentToolSchema = {
    ...baseTool.schema,
    properties: {
      ...baseTool.schema.properties,
      delegationId: {
        type: 'string',
        description: 'Optional LifeSpace dlg_* returned by a successful authorization confirmation. Omit it to execute with the Agent\'s own Authority.',
      },
    },
  };
  return {
    ...baseTool,
    description: `${baseTool.description} When user authorization is required, pass the dlg_* returned by LifeSpace Confirm Authorization as delegationId. Omit delegationId to use the Agent's own Authority.`,
    schema,
    metadata: { ...baseTool.metadata, lifeSpaceUserAuthorization: 'optional' },
    invoke: async (query: unknown): Promise<string> => {
      const { semantic, delegationId } = toolInput(query);
      if (delegationId && !/^dlg_[A-Za-z0-9_-]+$/u.test(delegationId)) return invalidDelegationOutput();
      if (delegationId && !/^usr_[A-Za-z0-9_-]+$/u.test(principalUserId)) {
        return JSON.stringify({
          ok: false,
          error: {
            code: 'USER_CONTEXT_REQUIRED',
            message: 'A trusted Principal User ID is required to use delegationId',
            retryable: false,
            nextAction: 'report_failure',
          },
        });
      }
      let output: string;
      try {
        output = await invokeWithDelegation(semantic, delegationId);
      } catch (error) {
        output = structuredFailure(error);
      }
      return withAuthorizationRequired(output, authorizationScope(context, itemIndex, semantic));
    },
  };
}

export class LifeSpaceAgentTool extends LifeSpaceTool {
  constructor() {
    super();
    this.description = {
      ...this.description,
      icon: {
        light: 'file:lifespace.svg',
        dark: 'file:lifespace.dark.svg',
      },
      description: 'Expose one scoped LifeSpace Record or Person operation to an AI Agent',
      credentials: [
        {
          name: 'lifeSpaceAgentExecutionApi',
          required: true,
        },
      ],
      properties: agentProperties(this.description.properties),
    };
  }

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const resource = String(this.getNodeParameter('toolResource', itemIndex, 'record') ?? 'record');
    const auth = authorizationSettings(this, itemIndex);

    if (resource === 'person') {
      const runtime = await personRuntime(this, itemIndex);
      const direct = customTool(
        this,
        itemIndex,
        runtime,
        async (query) => invokePerson(this, itemIndex, query, ''),
      );
      if (!auth.enabled) return { response: direct };
      return {
        response: wrapOptionalAuthorization(
          this,
          itemIndex,
          direct,
          auth.principalUserId,
          async (semantic, delegationId) => invokePerson(this, itemIndex, semantic, delegationId),
        ),
      };
    }

    const operation = currentRecordOperation(this, itemIndex);
    const batchSettings = ['create', 'update', 'delete'].includes(operation)
      ? recordBatchSettings(this, itemIndex)
      : null;
    if (batchSettings?.batchProcessing) {
      const runtime = await multiRuntime(this, itemIndex);
      const direct = customTool(
        this,
        itemIndex,
        runtime,
        async (query) => invokeMulti(this, itemIndex, query, ''),
      );
      if (!auth.enabled) return { response: direct };
      return {
        response: wrapOptionalAuthorization(
          this,
          itemIndex,
          direct,
          auth.principalUserId,
          async (semantic, delegationId) => invokeMulti(this, itemIndex, semantic, delegationId),
        ),
      };
    }

    const directContext = agentExecutionContext(this, itemIndex, '', '');
    const supplied = await LifeSpaceTool.prototype.supplyData.call(directContext, itemIndex);
    if (!auth.enabled) return supplied;
    const baseTool = supplied.response as unknown as StructuralAiTool;
    return {
      response: wrapOptionalAuthorization(
        this,
        itemIndex,
        baseTool,
        auth.principalUserId,
        async (semantic, delegationId) => {
          const executionContext = agentExecutionContext(this, itemIndex, auth.principalUserId, delegationId);
          const runtimeSupply = await LifeSpaceTool.prototype.supplyData.call(executionContext, itemIndex);
          const runtimeTool = runtimeSupply.response as unknown as StructuralAiTool;
          return await runtimeTool.invoke(semantic as IDataObject);
        },
      ),
    };
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    if (!items.length) return [[]];
    const resource = String(this.getNodeParameter('toolResource', 0, 'record') ?? 'record');
    const operation = resource === 'person' ? 'query' : currentRecordOperation(this, 0);
    const batchSettings = resource === 'record' && ['create', 'update', 'delete'].includes(operation)
      ? recordBatchSettings(this, 0)
      : null;
    const custom = resource === 'person' || batchSettings?.batchProcessing === true;
    if (!custom) return await LifeSpaceTool.prototype.execute.call(this);

    const output: INodeExecutionData[] = [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      if (!item) continue;
      const runtime = resource === 'person'
        ? await personRuntime(this, itemIndex)
        : await multiRuntime(this, itemIndex);
      const projected = semanticToolInput(runtime.schema, item.json);
      const { semantic, delegationId } = toolInput(projected);
      let response: string;
      if (delegationId && !/^dlg_[A-Za-z0-9_-]+$/u.test(delegationId)) {
        response = invalidDelegationOutput();
      } else {
        try {
          response = resource === 'person'
            ? await invokePerson(this, itemIndex, semantic, delegationId)
            : await invokeMulti(this, itemIndex, semantic, delegationId);
        } catch (error) {
          response = structuredFailure(error);
        }
        if (authorizationSettings(this, itemIndex).enabled) {
          response = withAuthorizationRequired(response, authorizationScope(this, itemIndex, semantic));
        }
      }
      output.push({ json: { response }, pairedItem: { item: itemIndex } });
    }
    return [output];
  }
}
