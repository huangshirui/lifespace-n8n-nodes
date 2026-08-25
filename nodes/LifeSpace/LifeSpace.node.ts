import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type DiscoveryAccess = 'read' | 'write' | 'manage';
type DiscoveryAction = {
  key: string;
  access: DiscoveryAccess;
  kind: 'workflow' | 'capability';
};
type DiscoveryModel = {
  key: string;
  route: string;
  version: number;
  schemaHash: string;
  display: { singular: string; plural: string };
  description: string | null;
  access: DiscoveryAccess[];
  actions: DiscoveryAction[];
};
type DiscoveryResponse = {
  data: {
    spaceId: string;
    models: DiscoveryModel[];
  };
};

function parseJsonObject(
  context: IExecuteFunctions,
  itemIndex: number,
  value: unknown,
  fieldName: string,
): IDataObject {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NodeOperationError(context.getNode(), `${fieldName} must be a JSON object`, { itemIndex });
  }
  return parsed as IDataObject;
}

async function loadDiscovery(this: ILoadOptionsFunctions): Promise<DiscoveryResponse> {
  const credentials = await this.getCredentials('lifeSpaceApi');
  const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');
  const options: IHttpRequestOptions = {
    method: 'GET',
    url: `${baseUrl}/_discovery`,
    json: true,
  };

  try {
    return await this.helpers.httpRequestWithAuthentication.call(
      this,
      'lifeSpaceApi',
      options,
    ) as DiscoveryResponse;
  } catch (error) {
    throw new NodeApiError(this.getNode(), error as JsonObject);
  }
}

function requiredAccessForOperation(operation: string): DiscoveryAccess {
  return ['create', 'update', 'delete'].includes(operation) ? 'write' : 'read';
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
        displayName: 'Model Name or ID',
        name: 'modelRoute',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'getModels',
        },
        options: [],
        default: '',
        required: true,
        displayOptions: { show: { resource: ['modelRecord'] } },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
        description: 'Record fields defined by the selected LifeSpace model',
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
        description: 'Query parameters supported by the selected model, such as filters, sort, limit or cursor',
      },
      {
        displayName: 'Action Name or ID',
        name: 'actionKey',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'getActions',
        },
        options: [],
        default: '',
        required: true,
        displayOptions: {
          show: {
            resource: ['modelRecord'],
            operation: ['executeAction'],
          },
        },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
        description: 'Action input defined by the selected model. Model Definition v1 workflow actions typically require version.',
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
            description: 'Call a path relative to the configured LifeSpace Connection Base URL',
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
        default: '/',
        required: true,
        displayOptions: { show: { resource: ['apiRequest'] } },
        description: 'Path relative to the configured LifeSpace Connection Base URL',
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

  methods = {
    loadOptions: {
      async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const discovery = await loadDiscovery.call(this);
        const operation = String(this.getNodeParameter('operation', 'list'));

        return discovery.data.models
          .filter((model) => operation === 'executeAction'
            ? model.actions.length > 0
            : model.access.includes(requiredAccessForOperation(operation)))
          .map((model) => ({
            name: `${model.display.plural} (${model.route})`,
            value: model.route,
            description: model.description ?? undefined,
          }));
      },
      async getActions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();
        if (!modelRoute) return [];

        const discovery = await loadDiscovery.call(this);
        const model = discovery.data.models.find((entry) => entry.route === modelRoute);
        if (!model) return [];

        return model.actions.map((action) => ({
          name: action.key,
          value: action.key,
          description: `${action.kind} action · ${action.access} access`,
        }));
      },
    },
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
          const modelRoute = encodeURIComponent(String(this.getNodeParameter('modelRoute', itemIndex)));
          const collectionPath = `/${modelRoute}`;

          if (operation === 'list') {
            options = {
              method: 'GET',
              url: `${baseUrl}${collectionPath}`,
              qs: parseJsonObject(
                this,
                itemIndex,
                this.getNodeParameter('queryParameters', itemIndex, '{}'),
                'Query Parameters',
              ),
              json: true,
            };
          } else if (operation === 'create') {
            options = {
              method: 'POST',
              url: `${baseUrl}${collectionPath}`,
              body: parseJsonObject(this, itemIndex, this.getNodeParameter('fields', itemIndex, '{}'), 'Fields'),
              json: true,
            };
          } else {
            const recordId = encodeURIComponent(String(this.getNodeParameter('recordId', itemIndex)));
            const recordPath = `${collectionPath}/${recordId}`;

            if (operation === 'get') {
              options = { method: 'GET', url: `${baseUrl}${recordPath}`, json: true };
            } else if (operation === 'update') {
              const fields = parseJsonObject(
                this,
                itemIndex,
                this.getNodeParameter('fields', itemIndex, '{}'),
                'Fields',
              );
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
                body: parseJsonObject(
                  this,
                  itemIndex,
                  this.getNodeParameter('actionInput', itemIndex, '{}'),
                  'Action Input',
                ),
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
            options.body = parseJsonObject(
              this,
              itemIndex,
              this.getNodeParameter('jsonBody', itemIndex, '{}'),
              'JSON Body',
            );
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
