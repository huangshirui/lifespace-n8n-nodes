import { createHmac, timingSafeEqual } from 'crypto';
import type {
  ICredentialTestFunctions,
  ICredentialsDecrypted,
  IDataObject,
  IHookFunctions,
  ILoadOptionsFunctions,
  INodeCredentialTestResult,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import {
  discoverySpace,
  loadRuntimeDiscovery,
} from '../lifespaceDiscovery';

const MAX_TIMESTAMP_SKEW_SECONDS = 300;
const SIGNING_SECRET_PATTERN = /^[a-f0-9]{64}$/;

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
    description: 'Starts the workflow when selected LifeSpace record events are delivered',
    defaults: {
      name: 'LifeSpace Trigger',
    },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: 'lifeSpaceApi',
        required: true,
        testedBy: 'lifeSpaceTriggerCredentialTest',
      },
    ],
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
          'Configure one LifeSpace Webhook Endpoint with this node\'s production webhook URL, then attach one Event Subscription per selected Record Type. Store the endpoint signing secret in the same LifeSpace API credential used by this node.',
        name: 'setupNotice',
        type: 'notice',
        default: '',
      },
      {
        displayName: 'Space Name or ID',
        name: 'spaceId',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'getSpaces',
        },
        options: [],
        default: '',
        required: true,
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Record Type Names or IDs',
        name: 'recordTypeKeys',
        type: 'multiOptions',
        typeOptions: {
          loadOptionsMethod: 'getTriggerRecordTypes',
          loadOptionsDependsOn: ['spaceId'],
        },
        options: [],
        default: [],
        required: true,
        description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
        description: 'Only emit selected event types. LifeSpace endpoint.test events are always accepted for end-to-end webhook testing.',
      },
    ],
  };

  methods = {
    loadOptions: {
      async getSpaces(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const discovery = await loadRuntimeDiscovery.call(this);
        return discovery.data.spaces.map((space) => ({
          name: space.spaceId,
          value: space.spaceId,
          description: `${space.models.length} available Record Type${space.models.length === 1 ? '' : 's'}`,
        }));
      },
      async getTriggerRecordTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();
        if (!spaceId) return [];
        const discovery = await loadRuntimeDiscovery.call(this);
        const space = discoverySpace(discovery, spaceId);
        if (!space) return [];

        return space.models
          .filter((model) => model.access.includes('read'))
          .map((model) => ({
            name: `${model.display.plural} (${model.key})`,
            value: model.key,
            description: model.description ?? undefined,
          }));
      },
    },
    credentialTest: {
      async lifeSpaceTriggerCredentialTest(
        this: ICredentialTestFunctions,
        credential: ICredentialsDecrypted,
      ): Promise<INodeCredentialTestResult> {
        const signingSecret = String(credential.data?.webhookSigningSecret ?? '');
        if (!SIGNING_SECRET_PATTERN.test(signingSecret)) {
          return {
            status: 'Error',
            message: 'Webhook Signing Secret must be the 64-character hexadecimal secret returned by LifeSpace',
          };
        }
        return {
          status: 'OK',
          message: 'Webhook Signing Secret format is valid. Use the LifeSpace Webhook Endpoint test for end-to-end verification.',
        };
      },
    },
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const webhookData = this.getWorkflowStaticData('node');
        return webhookData.lifeSpaceManualSubscription === true;
      },
      async create(this: IHookFunctions): Promise<boolean> {
        const webhookData = this.getWorkflowStaticData('node');
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
    const credentials = await this.getCredentials('lifeSpaceApi');

    const timestamp = String(headers['x-lifespace-timestamp'] ?? '');
    const signatureHeader = String(headers['x-lifespace-signature'] ?? '');
    const signingSecret = String(credentials.webhookSigningSecret ?? '');
    const signature = signatureHeader.startsWith('v1=') ? signatureHeader.slice(3) : '';
    const timestampSeconds = Number(timestamp);

    if (
      !timestamp ||
      !signature ||
      !SIGNING_SECRET_PATTERN.test(signingSecret) ||
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

    if (eventType === 'endpoint.test') {
      return {
        workflowData: [this.helpers.returnJsonArray(bodyData)],
      };
    }

    const selectedEventTypes = this.getNodeParameter('eventTypes') as string[];
    const selectedSpaceId = String(this.getNodeParameter('spaceId', '')).trim();
    const selectedRecordTypeKeys = this.getNodeParameter('recordTypeKeys', []) as string[];

    if (!selectedEventTypes.includes(eventType)) {
      response.status(204).end();
      return { noWebhookResponse: true };
    }

    if (
      String(bodyData.spaceId ?? '') !== selectedSpaceId ||
      !selectedRecordTypeKeys.includes(String(bodyData.modelKey ?? ''))
    ) {
      response.status(204).end();
      return { noWebhookResponse: true };
    }

    return {
      workflowData: [this.helpers.returnJsonArray(bodyData)],
    };
  }
}
