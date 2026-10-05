import type { INodeType, INodeTypeDescription, ISupplyDataFunctions, SupplyData } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { agentAuthorizationRequest, requiredIdentifier, toolOutput } from '../authorization/lifeSpaceAuthorizationRequest';

type StructuralAiTool = {
  name: string;
  description: string;
  schema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  metadata: Record<string, unknown>;
  invoke: (query: unknown) => Promise<string>;
};

export class LifeSpaceCancelAuthorizationTool implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace Cancel Authorization (Agent Tool)',
    name: 'lifeSpaceCancelAuthorizationTool',
    icon: 'file:../LifeSpace/lifespace.svg',
    group: ['transform'],
    version: 1,
    subtitle: 'Authorization Request · Cancel Tool',
    description: 'Cancel a pending Authorization Request that the requesting Agent no longer needs',
    defaults: { name: 'LifeSpace Cancel Authorization' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiTool],
    outputNames: ['Tool'],
    credentials: [{ name: 'lifeSpaceAgentExecutionApi', required: true }],
    properties: [],
  };

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const tool: StructuralAiTool = {
      name: 'lifespace_cancel_authorization',
      description: 'Cancel a pending LifeSpace Authorization Request that this Agent no longer needs.',
      schema: {
        type: 'object',
        properties: {
          spaceId: { type: 'string', description: 'LifeSpace spc_* from the Authorization Request.' },
          requestId: { type: 'string', description: 'LifeSpace arq_* to cancel.' },
        },
        required: ['spaceId', 'requestId'],
        additionalProperties: false,
      },
      metadata: { lifeSpaceAuthority: 'cancel', principalContext: 'requesting_agent' },
      invoke: async (query: unknown): Promise<string> => {
        try {
          if (!query || typeof query !== 'object' || Array.isArray(query)) {
            throw new NodeOperationError(this.getNode(), 'Tool input must be an object');
          }
          const input = query as Record<string, unknown>;
          const spaceId = requiredIdentifier(this, input.spaceId, 'Space ID', /^spc_[A-Za-z0-9_-]+$/u);
          const requestId = requiredIdentifier(this, input.requestId, 'Authorization Request ID', /^arq_[A-Za-z0-9_-]+$/u);
          const response = await agentAuthorizationRequest(this, itemIndex, {
            method: 'POST',
            url: `/spaces/${encodeURIComponent(spaceId)}/authorization-requests/${encodeURIComponent(requestId)}/cancel`,
          });
          return toolOutput(response);
        } catch (error) {
          return toolOutput({
            ok: false,
            error: {
              code: 'AUTHORIZATION_CANCEL_FAILED',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
    };
    return { response: tool };
  }
}
