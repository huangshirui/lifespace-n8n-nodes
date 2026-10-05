import type {
  IDataObject,
  INodeType,
  INodeTypeDescription,
  ISupplyDataFunctions,
  SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
  agentAuthorizationRequest,
  authorizationRequired,
  toolOutput,
  trustedPrincipalUserId,
} from '../authorization/lifeSpaceAuthorizationRequest';

type StructuralAiTool = {
  name: string;
  description: string;
  schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
  metadata: Record<string, unknown>;
  invoke: (query: unknown) => Promise<string>;
};

export class LifeSpaceRequestAuthorization implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace Request Authorization',
    name: 'lifeSpaceRequestAuthorization',
    icon: 'file:../LifeSpace/lifespace.svg',
    group: ['transform'],
    version: 1,
    subtitle: 'Authorization Request · Request',
    description: 'Request bounded LifeSpace user authorization from an AI Agent without granting Authority yet',
    defaults: { name: 'LifeSpace Request Authorization' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiTool],
    outputNames: ['Tool'],
    credentials: [{ name: 'lifeSpaceAgentExecutionApi', required: true }],
    properties: [
      {
        displayName: 'Principal User ID',
        name: 'principalUserId',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'usr_...',
        description: 'Trusted workflow user mapping. This value is never exposed to the AI Tool schema.',
      },
      {
        displayName: 'Request TTL (Minutes)',
        name: 'requestTtlMinutes',
        type: 'number',
        default: 60,
        typeOptions: { minValue: 1, maxValue: 1440 },
        description: 'How long the pending arq_* remains confirmable. This is separate from Delegation expiry.',
      },
    ],
  };

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const principalUserId = trustedPrincipalUserId(this, itemIndex);
    const ttl = Number(this.getNodeParameter('requestTtlMinutes', itemIndex, 60));
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 1440) {
      throw new NodeOperationError(this.getNode(), 'Request TTL must be an integer between 1 and 1440 minutes');
    }

    const tool: StructuralAiTool = {
      name: 'lifespace_request_authorization',
      description: 'Create or reuse a pending LifeSpace Authorization Request. Pass the authorizationRequired object returned by a LifeSpace Agent Tool exactly; this operation grants no Authority.',
      schema: {
        type: 'object',
        properties: {
          authorizationRequired: {
            type: 'object',
            description: 'Copy authorizationRequired from the failed LifeSpace Agent Tool result.',
            properties: {
              spaceId: { type: 'string' },
              scopes: {
                type: 'array',
                minItems: 1,
                maxItems: 20,
                items: {
                  type: 'object',
                  properties: {
                    target: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['space', 'model', 'record'] },
                        id: { type: 'string' },
                      },
                      required: ['type', 'id'],
                      additionalProperties: false,
                    },
                    maxAccess: { type: 'string', enum: ['free_busy', 'read', 'write', 'manage'] },
                  },
                  required: ['target', 'maxAccess'],
                  additionalProperties: false,
                },
              },
            },
            required: ['spaceId', 'scopes'],
            additionalProperties: false,
          },
        },
        required: ['authorizationRequired'],
        additionalProperties: false,
      },
      metadata: { lifeSpaceAuthority: 'request', principalContext: 'trusted_workflow' },
      invoke: async (query: unknown): Promise<string> => {
        try {
          if (!query || typeof query !== 'object' || Array.isArray(query)) {
            throw new NodeOperationError(this.getNode(), 'Tool input must be an object');
          }
          const required = authorizationRequired(
            this,
            (query as Record<string, unknown>).authorizationRequired,
          );
          const response = await agentAuthorizationRequest(this, itemIndex, {
            method: 'POST',
            url: `/spaces/${encodeURIComponent(required.spaceId)}/authorization-requests`,
            body: {
              principalUserId,
              items: required.scopes.map((scope) => ({ scope })),
              requestTtlMinutes: ttl,
            } as IDataObject,
          });
          return toolOutput(response);
        } catch (error) {
          return toolOutput({
            ok: false,
            error: {
              code: 'AUTHORIZATION_REQUEST_FAILED',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
    };

    return { response: tool };
  }
}
