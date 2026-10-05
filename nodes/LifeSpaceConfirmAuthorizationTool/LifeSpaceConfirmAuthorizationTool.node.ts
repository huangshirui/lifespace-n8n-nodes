import type { IDataObject, INodeType, INodeTypeDescription, ISupplyDataFunctions, SupplyData } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { agentAuthorizationRequest, requiredIdentifier, toolOutput, trustedPrincipalUserId } from '../authorization/lifeSpaceAuthorizationRequest';

type StructuralAiTool = {
  name: string;
  description: string;
  schema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  metadata: Record<string, unknown>;
  invoke: (query: unknown) => Promise<string>;
};

export class LifeSpaceConfirmAuthorizationTool implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace Confirm Authorization (Agent Tool)',
    name: 'lifeSpaceConfirmAuthorizationTool',
    icon: 'file:../LifeSpace/lifespace.svg',
    group: ['transform'],
    version: 1,
    subtitle: 'Authorization Request · Confirm Tool',
    description: 'Confirm a pending Authorization Request after human review in an AI-mediated flow',
    defaults: { name: 'LifeSpace Confirm Authorization' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiTool],
    outputNames: ['Tool'],
    credentials: [{ name: 'lifeSpaceAgentExecutionApi', required: true }],
    properties: [
      { displayName: 'Principal User ID', name: 'principalUserId', type: 'string', default: '', required: true, placeholder: 'usr_...', description: 'Trusted workflow user mapping. This value is never exposed to the AI Tool schema.' },
    ],
  };

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const principalUserId = trustedPrincipalUserId(this, itemIndex);
    const tool: StructuralAiTool = {
      name: 'lifespace_confirm_authorization',
      description: 'Confirm a pending LifeSpace Authorization Request after the user approved it. Copy requestId, spaceId and the canonical confirmation returned by LifeSpace Request Authorization.',
      schema: {
        type: 'object',
        properties: {
          spaceId: { type: 'string', description: 'LifeSpace spc_* from the Authorization Request.' },
          requestId: { type: 'string', description: 'LifeSpace arq_* to confirm.' },
          confirmation: { type: 'object', description: 'Canonical confirmation object returned by Request Authorization.' },
        },
        required: ['spaceId', 'requestId', 'confirmation'],
        additionalProperties: false,
      },
      metadata: { lifeSpaceAuthority: 'confirm', principalContext: 'trusted_workflow' },
      invoke: async (query: unknown): Promise<string> => {
        try {
          if (!query || typeof query !== 'object' || Array.isArray(query)) throw new NodeOperationError(this.getNode(), 'Tool input must be an object');
          const input = query as Record<string, unknown>;
          const spaceId = requiredIdentifier(this, input.spaceId, 'Space ID', /^spc_[A-Za-z0-9_-]+$/u);
          const requestId = requiredIdentifier(this, input.requestId, 'Authorization Request ID', /^arq_[A-Za-z0-9_-]+$/u);
          if (!input.confirmation || typeof input.confirmation !== 'object' || Array.isArray(input.confirmation)) {
            throw new NodeOperationError(this.getNode(), 'confirmation must be the canonical structured object returned by Request Authorization');
          }
          const response = await agentAuthorizationRequest(this, itemIndex, {
            method: 'POST',
            url: `/spaces/${encodeURIComponent(spaceId)}/authorization-requests/${encodeURIComponent(requestId)}/confirm`,
            body: { principalUserId, confirmation: input.confirmation } as IDataObject,
          });
          return toolOutput(response);
        } catch (error) {
          return toolOutput({ ok: false, error: { code: 'AUTHORIZATION_CONFIRM_FAILED', message: error instanceof Error ? error.message : String(error) } });
        }
      },
    };
    return { response: tool };
  }
}
