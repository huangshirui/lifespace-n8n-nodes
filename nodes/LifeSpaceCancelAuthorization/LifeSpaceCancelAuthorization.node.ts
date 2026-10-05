import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { agentAuthorizationRequest, requiredIdentifier, responseJson } from '../authorization/lifeSpaceAuthorizationRequest';

export class LifeSpaceCancelAuthorization implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace Cancel Authorization',
    name: 'lifeSpaceCancelAuthorization',
    icon: 'file:../LifeSpace/lifespace.svg',
    group: ['transform'],
    version: 1,
    description: 'Cancel an Authorization Request that the requesting Agent/Application no longer needs',
    defaults: { name: 'LifeSpace Cancel Authorization' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'lifeSpaceAgentExecutionApi', required: true }],
    properties: [
      { displayName: 'Space ID', name: 'spaceId', type: 'string', default: '', required: true, placeholder: 'spc_...' },
      { displayName: 'Authorization Request ID', name: 'requestId', type: 'string', default: '', required: true, placeholder: 'arq_...' },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const input = this.getInputData();
    const output: INodeExecutionData[] = [];
    for (let itemIndex = 0; itemIndex < input.length; itemIndex += 1) {
      try {
        const spaceId = requiredIdentifier(this, this.getNodeParameter('spaceId', itemIndex), 'Space ID', /^spc_[A-Za-z0-9_-]+$/u);
        const requestId = requiredIdentifier(this, this.getNodeParameter('requestId', itemIndex), 'Authorization Request ID', /^arq_[A-Za-z0-9_-]+$/u);
        const response = await agentAuthorizationRequest(this, itemIndex, {
          method: 'POST',
          url: `/spaces/${encodeURIComponent(spaceId)}/authorization-requests/${encodeURIComponent(requestId)}/cancel`,
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
