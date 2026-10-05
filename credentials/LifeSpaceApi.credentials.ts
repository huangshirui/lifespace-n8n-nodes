import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class LifeSpaceApi implements ICredentialType {
  name = 'lifeSpaceApi';

  displayName = 'LifeSpace Service API';

  icon = {
    light: 'file:lifespace.svg',
    dark: 'file:lifespace.dark.svg',
  } as const;

  documentationUrl = 'https://github.com/huangshirui/LifeSpace/blob/main/docs/service-authentication.md';

  properties: INodeProperties[] = [
    {
      displayName: 'API Base URL',
      name: 'baseUrl',
      type: 'string',
      default: '',
      placeholder: 'https://core.example.com/api/v1',
      required: true,
      description: 'LifeSpace Core API root. Do not include a Space or Record Type path.',
    },
    {
      displayName: 'Service API Token',
      name: 'token',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      placeholder: 'lsp_svc_...',
      required: true,
      description: 'Opaque LifeSpace Service API Token used by n8n for API calls and Runtime Discovery. Legacy lsp_pat_* tokens remain accepted by LifeSpace during migration.',
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
