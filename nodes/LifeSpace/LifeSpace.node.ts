import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IRequestOptions,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

export class LifeSpace implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace',
    name: 'lifeSpace',
    icon: 'file:lifespace.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Use LifeSpace in n8n workflows',
    defaults: {
      name: 'LifeSpace',
    },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    credentials: [
      {
        name: 'lifeSpaceApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'API Request',
            value: 'apiRequest',
            action: 'Make a LifeSpace API request',
            description: 'Call a LifeSpace Core API path without redefining its domain contract',
          },
        ],
        default: 'apiRequest',
      },
      {
        displayName: 'Method',
        name: 'method',
        type: 'options',
        options: [
          { name: 'GET', value: 'GET' },
          { name: 'POST', value: 'POST' },
          { name: 'PATCH', value: 'PATCH' },
          { name: 'PUT', value: 'PUT' },
          { name: 'DELETE', value: 'DELETE' },
        ],
        default: 'GET',
      },
      {
        displayName: 'Path',
        name: 'path',
        type: 'string',
        default: '/api/v1/',
        required: true,
        description: 'LifeSpace Core API path. Keep contract semantics in the upstream LifeSpace repository.',
      },
      {
        displayName: 'JSON Body',
        name: 'jsonBody',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            method: ['POST', 'PATCH', 'PUT'],
          },
        },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];
    const credentials = await this.getCredentials('lifeSpaceApi');
    const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const method = this.getNodeParameter('method', itemIndex) as IRequestOptions['method'];
        const path = String(this.getNodeParameter('path', itemIndex));
        const options: IRequestOptions = {
          method,
          url: `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
          json: true,
        };

        if (['POST', 'PATCH', 'PUT'].includes(String(method))) {
          const rawBody = this.getNodeParameter('jsonBody', itemIndex, '{}');
          options.body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
        }

        const response = await this.helpers.requestWithAuthentication.call(
          this,
          'lifeSpaceApi',
          options,
        );

        const json = typeof response === 'object' && response !== null
          ? response
          : { data: response };

        output.push({ json, pairedItem: { item: itemIndex } });
      } catch (error) {
        if (this.continueOnFail()) {
          output.push({
            json: { error: error instanceof Error ? error.message : String(error) },
            pairedItem: { item: itemIndex },
          });
          continue;
        }

        throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
      }
    }

    return [output];
  }
}
