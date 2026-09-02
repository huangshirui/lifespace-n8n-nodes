import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class LifeSpaceApi implements ICredentialType {
  name = 'lifeSpaceApi';

  displayName = 'LifeSpace API';

  documentationUrl = 'https://github.com/huangshirui/LifeSpace/blob/main/docs/service-authentication.md';

  icon = {
    light: 'file:lifespace.svg',
    dark: 'file:lifespace.dark.svg',
  } as const;

  properties: INodeProperties[] = [
    {
      displayName: 'API Base URL',
      name: 'baseUrl',
      type: 'string',
      default: '',
      placeholder: 'https://api.example.com/api/v1',
      required: true,
      description: 'LifeSpace Core API root. Do not include a Space or Record Type path.',
    },
    {
      displayName: 'Service API Token',
      name: 'token',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      placeholder: 'lsp_pat_...',
      required: true,
      description: 'Opaque LifeSpace Service API Token used by n8n for API calls and Runtime Discovery',
    },
    {
      displayName: 'Webhook Signing Secret',
      name: 'webhookSigningSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      placeholder: '64-character hexadecimal secret',
      description: 'Optional for action nodes; required by LifeSpace Trigger to verify incoming webhook signatures',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.token}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl.replace(/\\/$/, "")}}',
      url: '/me/_discovery',
      method: 'GET',
    },
  };
}
