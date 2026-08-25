import { createHmac, timingSafeEqual } from 'crypto';
import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

const MAX_TIMESTAMP_SKEW_SECONDS = 300;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export class LifeSpaceTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace Trigger',
    name: 'lifeSpaceTrigger',
    icon: {
      light: 'file:lifespace.svg',
      dark: 'file:lifespace.dark.svg',
    },
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["eventTypes"]}}',
    description: 'Starts the workflow when LifeSpace domain events are delivered',
    defaults: {
      name: 'LifeSpace Trigger',
    },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName:
          'Create the LifeSpace event subscription separately and use this node\'s production webhook URL as the destination. Paste the signing secret returned by LifeSpace below.',
        name: 'setupNotice',
        type: 'notice',
        default: '',
      },
      {
        displayName: 'Signing Secret',
        name: 'signingSecret',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        required: true,
        description: 'Signing secret returned when the LifeSpace event subscription is created',
      },
      {
        displayName: 'Event Types',
        name: 'eventTypes',
        type: 'multiOptions',
        options: [
          {
            name: 'Record Created',
            value: 'record.created',
          },
          {
            name: 'Record Deleted',
            value: 'record.deleted',
          },
          {
            name: 'Record Updated',
            value: 'record.updated',
          },
        ],
        default: ['record.created', 'record.updated', 'record.deleted'],
        description: 'Only emit selected event types. LifeSpace subscription.test events are always accepted for webhook testing.',
      },
      {
        displayName: 'Expected Space ID',
        name: 'expectedSpaceId',
        type: 'string',
        default: '',
        description: 'Optional additional check. Leave empty to accept any Space allowed by the LifeSpace subscription.',
      },
      {
        displayName: 'Expected Model Key',
        name: 'expectedModelKey',
        type: 'string',
        default: '',
        description: 'Optional additional check. Leave empty to accept any model allowed by the LifeSpace subscription.',
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const webhookData = this.getWorkflowStaticData('node');
        return webhookData.lifeSpaceManualSubscription === true;
      },
      async create(this: IHookFunctions): Promise<boolean> {
        const webhookData = this.getWorkflowStaticData('node');
        // LifeSpace subscription management currently requires an authenticated user
        // with spaces:manage. The n8n service credential must not bypass that boundary.
        // n8n still requires a complete webhook lifecycle, so this hook records only
        // local activation state; the external subscription is created separately.
        webhookData.lifeSpaceManualSubscription = true;
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        const webhookData = this.getWorkflowStaticData('node');
        delete webhookData.lifeSpaceManualSubscription;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const headers = this.getHeaderData() as IDataObject;
    const response = this.getResponseObject();

    const timestamp = String(headers['x-lifespace-timestamp'] ?? '');
    const signatureHeader = String(headers['x-lifespace-signature'] ?? '');
    const signingSecret = this.getNodeParameter('signingSecret') as string;
    const signature = signatureHeader.startsWith('v1=') ? signatureHeader.slice(3) : '';
    const timestampSeconds = Number(timestamp);

    if (
      !timestamp ||
      !signature ||
      !Number.isFinite(timestampSeconds) ||
      Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS
    ) {
      response.status(401).send('Unauthorized').end();
      return { noWebhookResponse: true };
    }

    const expectedSignature = createHmac('sha256', signingSecret)
      .update(`${timestamp}.${req.rawBody}`)
      .digest('hex');

    if (!safeEqual(signature, expectedSignature)) {
      response.status(401).send('Unauthorized').end();
      return { noWebhookResponse: true };
    }

    const bodyData = this.getBodyData() as IDataObject;
    const eventType = String(bodyData.type ?? '');
    const selectedEventTypes = this.getNodeParameter('eventTypes') as string[];
    const expectedSpaceId = String(this.getNodeParameter('expectedSpaceId', '')).trim();
    const expectedModelKey = String(this.getNodeParameter('expectedModelKey', '')).trim();

    if (eventType !== 'subscription.test' && !selectedEventTypes.includes(eventType)) {
      response.status(204).end();
      return { noWebhookResponse: true };
    }

    if (
      (expectedSpaceId && String(bodyData.spaceId ?? '') !== expectedSpaceId) ||
      (expectedModelKey && String(bodyData.modelKey ?? '') !== expectedModelKey)
    ) {
      response.status(204).end();
      return { noWebhookResponse: true };
    }

    return {
      workflowData: [this.helpers.returnJsonArray(bodyData)],
    };
  }
}
