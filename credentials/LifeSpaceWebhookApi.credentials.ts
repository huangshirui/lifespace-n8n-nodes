import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class LifeSpaceWebhookApi implements ICredentialType {
  name = 'lifeSpaceWebhookApi';

  displayName = 'LifeSpace Webhook API';

  icon = 'file:lifespace.svg' as const;

  documentationUrl = 'https://github.com/huangshirui/lifespace-n8n-nodes#lifespace-trigger';

  properties: INodeProperties[] = [
    {
      displayName: 'Signing Secret',
      name: 'signingSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'One-time signing secret returned when the LifeSpace event subscription is created or rotated',
    },
  ];
}
