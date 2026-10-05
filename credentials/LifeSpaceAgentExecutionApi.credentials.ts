import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class LifeSpaceAgentExecutionApi implements ICredentialType {
  name = 'lifeSpaceAgentExecutionApi';

  displayName = 'LifeSpace Agent API';

  icon = {
    light: 'file:lifespace.svg',
    dark: 'file:lifespace.dark.svg',
  } as const;

  documentationUrl = 'https://github.com/huangshirui/LifeSpace/blob/main/docs/service-authentication.md';

  properties: INodeProperties[] = [
    {
      displayName: 'API Base URL',
      name: 'coreBaseUrl',
      type: 'string',
      default: '',
      placeholder: 'https://core.example.com/api/v1',
      required: true,
      description: 'LifeSpace Core API root used by Agent requests',
    },
    {
      displayName: 'Agent API Credential',
      name: 'agentSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      placeholder: 'lsp_agt_...',
      required: true,
      description: 'Opaque LifeSpace Agent API credential bound to one Application and Agent identity',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.agentSecret}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.coreBaseUrl.replace(/\\/$/, "")}}',
      url: '/status',
      method: 'GET',
    },
  };
}
