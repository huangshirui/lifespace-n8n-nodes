import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class LifeSpaceApi implements ICredentialType {
  name = 'lifeSpaceApi';

  displayName = 'LifeSpace Connection API';

  icon = 'file:lifespace.svg' as const;

  documentationUrl = 'https://github.com/huangshirui/LifeSpace';

  properties: INodeProperties[] = [
    {
      displayName: 'Connection Base URL',
      name: 'baseUrl',
      type: 'string',
      default: '',
      placeholder: 'https://core.aisr.online/api/v1/spaces/spc_...',
      required: true,
      description: 'Copy the Connection Base URL from the LifeSpace Web integration configuration',
    },
    {
      displayName: 'Service API Token',
      name: 'token',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'Copy the LifeSpace Service API Token (lsp_pat_*) issued for this connection',
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
      url: '/_discovery',
      method: 'GET',
    },
  };
}
