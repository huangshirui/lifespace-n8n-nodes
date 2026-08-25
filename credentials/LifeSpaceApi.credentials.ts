import type {
  IAuthenticateGeneric,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class LifeSpaceApi implements ICredentialType {
  name = 'lifeSpaceApi';

  displayName = 'LifeSpace API';

  documentationUrl = 'https://github.com/huangshirui/LifeSpace';

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://core.aisr.online',
      required: true,
      description: 'Base URL of the LifeSpace Core API',
    },
    {
      displayName: 'Service API Token',
      name: 'token',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'LifeSpace opaque Service API Token (lsp_pat_*)',
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
}
