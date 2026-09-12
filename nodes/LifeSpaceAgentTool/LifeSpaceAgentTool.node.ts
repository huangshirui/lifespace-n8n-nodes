import type {
  IDataObject,
  IHttpRequestOptions,
  ISupplyDataFunctions,
  SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { LifeSpaceTool } from '../LifeSpaceTool/LifeSpaceTool.node';
import {
  buildAgentToolDefinition,
  type AgentToolConfig,
  type AgentToolOperation,
  type AgentToolQueryMode,
} from '../agent/lifeSpaceToolFactory';
import { compileGenericQuery, genericQuerySchema, type GenericQuerySchema } from '../agent/lifeSpaceGenericQueryTool';
import {
  decodeRecordTypeSelector,
  discoveryModel,
  discoverySpace,
  loadAgentToolRuntimeDiscovery,
  normalizeBaseUrl,
} from '../lifespaceDiscovery';

type SemanticQueryTool = {
  name: string;
  description: string;
  schema: GenericQuerySchema;
  metadata: Record<string, unknown>;
  invoke: (input: unknown) => Promise<string>;
};

function stringify(value: unknown): string {
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

export class LifeSpaceAgentTool extends LifeSpaceTool {
  constructor() {
    super();
    this.description = {
      ...this.description,
      icon: {
        light: 'file:lifespace.svg',
        dark: 'file:lifespace.dark.svg',
      },
      description: 'Expose one scoped LifeSpace operation to an AI Agent',
    };
  }

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const operation = this.getNodeParameter('operation', itemIndex) as AgentToolOperation;
    const queryMode = this.getNodeParameter('queryMode', itemIndex, 'generic') as AgentToolQueryMode;
    if (operation !== 'query' || queryMode !== 'generic') {
      return LifeSpaceTool.prototype.supplyData.call(this, itemIndex);
    }

    const credentials = await this.getCredentials('lifeSpaceApi', itemIndex);
    const baseUrl = normalizeBaseUrl(credentials.baseUrl);
    const spaceId = String(this.getNodeParameter('spaceId', itemIndex)).trim();
    const recordType = decodeRecordTypeSelector(this.getNodeParameter('recordType', itemIndex, ''));
    if (!recordType) {
      throw new NodeOperationError(this.getNode(), 'Choose a valid LifeSpace Record Type from Runtime Discovery', { itemIndex });
    }

    const discovery = await loadAgentToolRuntimeDiscovery(this, baseUrl, spaceId, recordType.modelKey);
    const model = discoveryModel(discovery, spaceId, recordType.modelKey);
    const space = discoverySpace(discovery, spaceId);
    if (!model || !space) {
      throw new NodeOperationError(this.getNode(), 'The selected LifeSpace model is no longer visible in this Space', { itemIndex });
    }

    const config: AgentToolConfig = {
      spaceId,
      spaceName: space.spaceName,
      operation: 'query',
      queryMode: 'generic',
      descriptionOverride: String(this.getNodeParameter('descriptionOverride', itemIndex, '') ?? '').trim(),
    };
    const definition = buildAgentToolDefinition(model, config);

    const tool: SemanticQueryTool = {
      name: definition.name,
      description: definition.description,
      schema: genericQuerySchema(model),
      metadata: {},
      invoke: async (input: unknown): Promise<string> => {
        const { index } = this.addInputData(NodeConnectionTypes.AiTool, [[{ json: { query: inputForLog(input) } }]]);
        try {
          const qs = compileGenericQuery(model, input);
          const request: IHttpRequestOptions = {
            method: 'GET',
            url: `${baseUrl}/spaces/${encodeURIComponent(spaceId)}/models/${encodeURIComponent(model.key)}/records`,
            qs,
            json: true,
          };
          if (Object.values(qs).some(Array.isArray)) request.arrayFormat = 'repeat';
          const response = await this.helpers.httpRequestWithAuthentication.call(this, 'lifeSpaceApi', request);
          const output = stringify(response);
          void this.addOutputData(NodeConnectionTypes.AiTool, index, [[{ json: { response: output } }]]);
          return output;
        } catch (error) {
          const executionError = new NodeOperationError(
            this.getNode(),
            error instanceof Error ? error : new Error('LifeSpace query Tool call failed'),
          );
          void this.addOutputData(NodeConnectionTypes.AiTool, index, executionError);
          return `LifeSpace Tool call failed: ${executionError.message}`;
        }
      },
    };

    return { response: tool };
  }
}
