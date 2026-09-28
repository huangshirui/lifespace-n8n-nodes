import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class LifeSpaceAgentExecutionApi implements ICredentialType {
  name = 'lifeSpaceAgentExecutionApi';

  displayName = 'LifeSpace Delegated Agent API';

  icon = {
    light: 'file:lifespace.svg',
    dark: 'file:lifespace.dark.svg',
  } as const;

  documentationUrl = 'https://github.com/huangshirui/LifeSpace/blob/main/docs/application-authentication.md';

  properties: INodeProperties[] = [
    {
      displayName: 'Core API Base URL',
      name: 'coreBaseUrl',
      type: 'string',
      default: '',
      placeholder: 'https://core.example.com/api/v1',
      required: true,
      description: 'LifeSpace Core API root used by delegated Agent business requests',
    },
    {
      displayName: 'Identity API Base URL',
      name: 'identityBaseUrl',
      type: 'string',
      default: '',
      placeholder: 'https://identity.example.com',
      required: true,
      description: 'LifeSpace Identity origin. Do not include /internal/v1/agent-tokens',
    },
    {
      displayName: 'Application Credential',
      name: 'applicationCredential',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      placeholder: 'lsa_...',
      required: true,
      description: 'Server-only trusted LifeSpace Application credential used only to mint short-lived delegated Agent execution tokens',
    },
    {
      displayName: 'Agent ID',
      name: 'agentId',
      type: 'string',
      default: '',
      placeholder: 'agt_...',
      required: true,
      description: 'LifeSpace Agent identity bound to this registered Application',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.applicationCredential}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.identityBaseUrl.replace(/\/$/, "")}}',
      url: '/internal/v1/agents',
      method: 'GET',
    },
  };
}
