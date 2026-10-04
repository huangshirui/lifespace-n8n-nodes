import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class LifeSpaceWebhookApi implements ICredentialType {
  name = 'lifeSpaceWebhookApi';

  displayName = 'LifeSpace Webhook Signing';

  icon = {
    light: 'file:lifespace.svg',
    dark: 'file:lifespace.dark.svg',
  } as const;

  documentationUrl = 'https://github.com/huangshirui/LifeSpace/blob/main/docs/contracts.md';

  properties: INodeProperties[] = [
    {
      displayName: 'Webhook Signing Secret',
      name: 'signingSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      placeholder: '64-character hexadecimal secret',
      required: true,
      description: 'Endpoint-scoped signing secret returned by LifeSpace when a Webhook Endpoint is created or rotated',
    },
  ];
}
