import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { agentAuthorizationRequest, requiredIdentifier, responseJson, trustedPrincipalUserId } from '../authorization/lifeSpaceAuthorizationRequest';

export class LifeSpaceConfirmAuthorization implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace Confirm Authorization',
    name: 'lifeSpaceConfirmAuthorization',
    icon: 'file:../LifeSpace/lifespace.svg',
    group: ['transform'],
    version: 1,
    description: 'Confirm a pending LifeSpace Authorization Request from a trusted workflow user context',
    defaults: { name: 'LifeSpace Confirm Authorization' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'lifeSpaceAgentExecutionApi', required: true }],
    properties: [
      { displayName: 'Principal User ID', name: 'principalUserId', type: 'string', default: '', required: true, placeholder: 'usr_...', description: 'Trusted user mapping for the person who confirmed this request.' },
      { displayName: 'Space ID', name: 'spaceId', type: 'string', default: '', required: true, placeholder: 'spc_...' },
      { displayName: 'Authorization Request ID', name: 'requestId', type: 'string', default: '', required: true, placeholder: 'arq_...' },
      { displayName: 'Confirmation', name: 'confirmation', type: 'json', default: '', description: 'Optional canonical confirmation object. Supply it for AI-mediated display paths; deterministic trusted workflows may leave it empty.' },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const input = this.getInputData();
    const output: INodeExecutionData[] = [];
    for (let itemIndex = 0; itemIndex < input.length; itemIndex += 1) {
      try {
        const principalUserId = trustedPrincipalUserId(this, itemIndex);
        const spaceId = requiredIdentifier(this, this.getNodeParameter('spaceId', itemIndex), 'Space ID', /^spc_[A-Za-z0-9_-]+$/u);
        const requestId = requiredIdentifier(this, this.getNodeParameter('requestId', itemIndex), 'Authorization Request ID', /^arq_[A-Za-z0-9_-]+$/u);
        const rawConfirmation = this.getNodeParameter('confirmation', itemIndex, '');
        let confirmation: unknown;
        if (rawConfirmation !== '' && rawConfirmation !== null && rawConfirmation !== undefined) {
          try {
            confirmation = typeof rawConfirmation === 'string' ? JSON.parse(rawConfirmation) : rawConfirmation;
          } catch (error) {
            throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
          }
          if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) {
            throw new NodeOperationError(this.getNode(), 'Confirmation must be a JSON object', { itemIndex });
          }
        }
        const response = await agentAuthorizationRequest(this, itemIndex, {
          method: 'POST',
          url: `/spaces/${encodeURIComponent(spaceId)}/authorization-requests/${encodeURIComponent(requestId)}/confirm`,
          body: {
            principalUserId,
            ...(confirmation === undefined ? {} : { confirmation }),
          } as IDataObject,
        });
        output.push({ json: responseJson(response), pairedItem: { item: itemIndex } });
      } catch (error) {
        if (!this.continueOnFail()) throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
        output.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: itemIndex } });
      }
    }
    return [output];
  }
}
