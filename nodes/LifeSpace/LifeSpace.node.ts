import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

function parseJsonObject(value: unknown, fieldName: string): IDataObject {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }
  return parsed as IDataObject;
}

export class LifeSpace implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace',
    name: 'lifeSpace',
    icon: {
      light: 'file:lifespace.svg',
      dark: 'file:lifespace.dark.svg',
    },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
    description: 'Use LifeSpace in n8n workflows',
    defaults: {
      name: 'LifeSpace',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [
      {
        name: 'lifeSpaceApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Model Record',
            value: 'modelRecord',
          },
          {
            name: 'API Request',
            value: 'apiRequest',
          },
        ],
        default: 'modelRecord',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['modelRecord'] } },
        options: [
          {
            name: 'Create',
            value: 'create',
            action: 'Create a model record',
            description: 'Create a record through the LifeSpace Generic Runtime',
          },
          {
            name: 'Delete',
            value: 'delete',
            action: 'Delete a model record',
            description: 'Delete a record using optimistic concurrency',
          },
          {
            name: 'Execute Action',
            value: 'executeAction',
            action: 'Execute a model action',
            description: 'Execute a published Capability or workflow action on a record',
          },
          {
            name: 'Get',
            value: 'get',
            action: 'Get a model record',
            description: 'Get one model record by ID',
          },
          {
            name: 'List / Query',
            value: 'list',
            action: 'List or query model records',
            description: 'Query a model collection using its published query contract',
          },
          {
            name: 'Update',
            value: 'update',
            action: 'Update a model record',
            description: 'Update a record using optimistic concurrency',
          },
        ],
        default: 'list',
      },
      {
        displayName: 'Space ID',
        name: 'spaceId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['modelRecord'] } },
        description: 'Source Space that owns the model record',
      },
      {
        displayName: 'Model Route',
        name: 'modelRoute',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['modelRecord'] } },
        description: 'Published model route from the pinned LifeSpace Model Contract, for example events or tasks',
      },
      {
        displayName: 'Record ID',
        name: 'recordId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['get', 'update', 'delete', 'executeAction'],
          },
        },
      },
      {
        displayName: 'Fields (JSON)',
        name: 'fields',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['create', 'update'],
          },
        },
        description: 'Record fields defined by the pinned LifeSpace Model Contract',
      },
      {
        displayName: 'Version',
        name: 'version',
        type: 'number',
        typeOptions: { minValue: 1, numberPrecision: 0 },
        default: 1,
        required: true,
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['update', 'delete'],
          },
        },
        description: 'Current record version used for optimistic concurrency',
      },
      {
        displayName: 'Query Parameters (JSON)',
        name: 'queryParameters',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['list'],
          },
        },
        description: 'Query parameters supported by the published model contract, such as filters, sort, limit or cursor',
      },
      {
        displayName: 'Action Key',
        name: 'actionKey',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['executeAction'],
          },
        },
        description: 'Published Capability or workflow action key from the pinned Model Contract',
      },
      {
        displayName: 'Action Input (JSON)',
        name: 'actionInput',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['executeAction'],
          },
        },
        description: 'Action input defined by the pinned Model Contract. Model Definition v1 workflow actions typically require version.',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['apiRequest'] } },
        options: [
          {
            name: 'API Request',
            value: 'apiRequest',
            action: 'Make an API request',
            description: 'Call a LifeSpace Core API path without redefining its domain contract',
          },
        ],
        default: 'apiRequest',
      },
      {
        displayName: 'Method',
        name: 'method',
        type: 'options',
        displayOptions: { show: { resource: ['apiRequest'] } },
        options: [
          { name: 'DELETE', value: 'DELETE' },
          { name: 'GET', value: 'GET' },
          { name: 'PATCH', value: 'PATCH' },
          { name: 'POST', value: 'POST' },
          { name: 'PUT', value: 'PUT' },
        ],
        default: 'GET',
      },
      {
        displayName: 'Path',
        name: 'path',
        type: 'string',
        default: '/api/v1/',
        required: true,
        displayOptions: { show: { resource: ['apiRequest'] } },
        description: 'LifeSpace Core API path. Keep contract semantics in the upstream LifeSpace repository.',
      },
      {
        displayName: 'JSON Body',
        name: 'jsonBody',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            resource: ['apiRequest'],
            method: ['POST', 'PATCH', 'PUT', 'DELETE'],
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
        const resource = this.getNodeParameter('resource', itemIndex) as string;
        let options: IHttpRequestOptions;

        if (resource === 'modelRecord') {
          const operation = this.getNodeParameter('operation', itemIndex) as string;
          const spaceId = encodeURIComponent(String(this.getNodeParameter('spaceId', itemIndex)));
          const modelRoute = encodeURIComponent(String(this.getNodeParameter('modelRoute', itemIndex)));
          const collectionPath = `/api/v1/spaces/${spaceId}/${modelRoute}`;

          if (operation === 'list') {
            options = {
              method: 'GET',
              url: `${baseUrl}${collectionPath}`,
              qs: parseJsonObject(this.getNodeParameter('queryParameters', itemIndex, '{}'), 'Query Parameters'),
              json: true,
            };
          } else if (operation === 'create') {
            options = {
              method: 'POST',
              url: `${baseUrl}${collectionPath}`,
              body: parseJsonObject(this.getNodeParameter('fields', itemIndex, '{}'), 'Fields'),
              json: true,
            };
          } else {
            const recordId = encodeURIComponent(String(this.getNodeParameter('recordId', itemIndex)));
            const recordPath = `${collectionPath}/${recordId}`;

            if (operation === 'get') {
              options = { method: 'GET', url: `${baseUrl}${recordPath}`, json: true };
            } else if (operation === 'update') {
              const fields = parseJsonObject(this.getNodeParameter('fields', itemIndex, '{}'), 'Fields');
              options = {
                method: 'PATCH',
                url: `${baseUrl}${recordPath}`,
                body: { ...fields, version: this.getNodeParameter('version', itemIndex) },
                json: true,
              };
            } else if (operation === 'delete') {
              options = {
                method: 'DELETE',
                url: `${baseUrl}${recordPath}`,
                body: { version: this.getNodeParameter('version', itemIndex) },
                json: true,
              };
            } else {
              const actionKey = encodeURIComponent(String(this.getNodeParameter('actionKey', itemIndex)));
              options = {
                method: 'POST',
                url: `${baseUrl}${recordPath}/actions/${actionKey}`,
                body: parseJsonObject(this.getNodeParameter('actionInput', itemIndex, '{}'), 'Action Input'),
                json: true,
              };
            }
          }
        } else {
          const method = this.getNodeParameter('method', itemIndex) as IHttpRequestOptions['method'];
          const path = String(this.getNodeParameter('path', itemIndex));
          options = {
            method,
            url: `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
            json: true,
          };

          if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(String(method))) {
            options.body = parseJsonObject(this.getNodeParameter('jsonBody', itemIndex, '{}'), 'JSON Body');
          }
        }

        const response = await this.helpers.httpRequestWithAuthentication.call(
          this,
          'lifeSpaceApi',
          options,
        );

        const json = typeof response === 'object' && response !== null
          ? response as IDataObject
          : response === undefined || response === null
            ? { success: true }
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
