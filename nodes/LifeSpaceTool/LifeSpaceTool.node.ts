import type {
  IDataObject,
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
  NodeOperationError,
} from 'n8n-workflow';
import {
  decodeRecordTypeSelector,
  discoveryModel,
  discoverySpace,
  loadAgentToolRuntimeDiscovery,
  loadOptionParameter,
  loadRuntimeDiscovery,
  normalizeBaseUrl,
  type DiscoveryAccess,
  type DiscoveryModel,
} from '../lifespaceDiscovery';
import {
  buildAgentToolDefinition,
  buildAgentToolRequest,
  type AgentToolConfig,
  type AgentToolOperation,
  type AgentToolQueryMode,
  type AgentToolRequest,
  type AgentToolSchema,
} from '../agent/lifeSpaceToolFactory';

type StructuralAiTool = {
  name: string;
  description: string;
  schema: AgentToolSchema;
  metadata: Record<string, unknown>;
  invoke: (query: unknown) => Promise<string>;
};

function requiredAccess(operation: string): DiscoveryAccess | null {
  if (operation === 'query') return 'read';
  if (['create', 'update', 'delete'].includes(operation)) return 'write';
  return null;
}

async function selectedOptionModel(context: ILoadOptionsFunctions): Promise<{ model: DiscoveryModel; spaceId: string } | null> {
  const spaceId = loadOptionParameter(context, 'spaceId');
  const recordType = decodeRecordTypeSelector(loadOptionParameter(context, 'recordType'));
  if (!spaceId || !recordType) return null;
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

function currentRecordPath(request: AgentToolRequest): string {
  const actionIndex = request.path.indexOf('/actions/');
  return actionIndex >= 0 ? request.path.slice(0, actionIndex) : request.path;
}

function currentRecordVersion(context: ISupplyDataFunctions, response: unknown): number {
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
  context: ISupplyDataFunctions,
  baseUrl: string,
  request: AgentToolRequest,
): Promise<unknown> {
  return await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceApi',
    requestOptions(baseUrl, request),
  );
}

function toolError(context: ISupplyDataFunctions, error: unknown): NodeOperationError {
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
        description: 'Fixes this Tool instance to one authorized LifeSpace Space',
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
          },
          {
            name: 'Delete Record',
            value: 'delete',
            description: 'Delete one record using current optimistic concurrency',
          },
          {
            name: 'Execute Action',
            value: 'action',
            description: 'Execute one published semantic Action on a record',
          },
          {
            name: 'Query Records',
            value: 'query',
            description: 'Query records using the published LifeSpace query contract',
          },
          {
            name: 'Update Record',
            value: 'update',
            description: 'Update only fields the Agent explicitly supplies',
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
        description: 'Fixes this Tool instance to one LifeSpace model key discovered for the selected Space',
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
        description: 'Choose a semantic query published by the selected LifeSpace model',
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
        description: 'Choose one published Action. Concurrency/version metadata is handled by the Adapter, not by the AI.',
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
        const discovery = await loadRuntimeDiscovery.call(this);
        return discovery.data.spaces.map((space) => ({
          name: space.spaceName?.trim() || space.spaceId,
          value: space.spaceId,
        }));
      },
      async getRecordTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const spaceId = loadOptionParameter(this, 'spaceId');
        const operation = loadOptionParameter(this, 'operation') || 'query';
        if (!spaceId) return [];
        const discovery = await loadRuntimeDiscovery.call(this);
        return (discoverySpace(discovery, spaceId)?.models ?? [])
          .filter((model) => modelSupportsOperation(model, operation))
          .map((model) => ({
            name: model.display.singular?.trim() || model.key,
            value: model.key,
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

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const credentials = await this.getCredentials('lifeSpaceApi', itemIndex);
    const baseUrl = normalizeBaseUrl(credentials.baseUrl);
    const spaceId = String(this.getNodeParameter('spaceId', itemIndex)).trim();
    const recordType = decodeRecordTypeSelector(this.getNodeParameter('recordType', itemIndex, ''));
    if (!recordType) {
      throw new NodeOperationError(this.getNode(), 'Choose a valid LifeSpace Record Type from Runtime Discovery', { itemIndex });
    }

    const operation = this.getNodeParameter('operation', itemIndex) as AgentToolOperation;
    const queryMode = this.getNodeParameter('queryMode', itemIndex, 'generic') as AgentToolQueryMode;
    const capabilityQueryKey = String(this.getNodeParameter('capabilityQueryKey', itemIndex, '') ?? '').trim();
    const actionKey = String(this.getNodeParameter('actionKey', itemIndex, '') ?? '').trim();
    const descriptionOverride = String(this.getNodeParameter('descriptionOverride', itemIndex, '') ?? '').trim();

    const discovery = await loadAgentToolRuntimeDiscovery(this, baseUrl, spaceId, recordType.modelKey);
    const model = discoveryModel(discovery, spaceId, recordType.modelKey);
    const space = discoverySpace(discovery, spaceId);
    if (!model || !space) {
      throw new NodeOperationError(this.getNode(), 'The selected LifeSpace model is no longer visible in this Space', { itemIndex });
    }

    const config: AgentToolConfig = {
      spaceId,
      spaceName: space.spaceName,
      operation,
      queryMode,
      capabilityQueryKey,
      actionKey,
      descriptionOverride,
    };
    let definition;
    try {
      definition = buildAgentToolDefinition(model, config);
    } catch (error) {
      throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
    }

    const tool: StructuralAiTool = {
      name: definition.name,
      description: definition.description,
      schema: definition.schema,
      metadata: {},
      invoke: async (query: unknown): Promise<string> => {
        const { index } = this.addInputData(NodeConnectionTypes.AiTool, [[{ json: { query: inputForLog(query) } }]]);
        let output: string;
        let executionError: NodeOperationError | undefined;
        try {
          let request = buildAgentToolRequest(model, config, query);
          if (request.needsCurrentVersion) {
            const recordResponse = await performRequest(this, baseUrl, {
              method: 'GET',
              path: currentRecordPath(request),
            });
            request = buildAgentToolRequest(model, config, query, currentRecordVersion(this, recordResponse));
          }
          const response = await performRequest(this, baseUrl, request);
          output = stringifyToolOutput(response);
        } catch (error) {
          executionError = toolError(this, error);
          output = `LifeSpace Tool call failed: ${executionError.message}`;
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
}
