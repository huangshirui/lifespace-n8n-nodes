import type {
  ICredentialDataDecryptedObject,
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type DelegationTargetType = 'space' | 'model' | 'record';
type DelegationAccess = 'free_busy' | 'read' | 'write' | 'manage';

type UserTokenResponse = {
  data?: {
    accessToken?: unknown;
  };
};

type DelegationResponse = {
  data?: {
    id?: unknown;
    [key: string]: unknown;
  };
};

function requiredString(
  context: IExecuteFunctions,
  itemIndex: number,
  value: unknown,
  label: string,
  pattern?: RegExp,
): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || (pattern && !pattern.test(normalized))) {
    throw new NodeOperationError(context.getNode(), `${label} is missing or invalid`, { itemIndex });
  }
  return normalized;
}

function credentialString(
  context: IExecuteFunctions,
  itemIndex: number,
  credentials: ICredentialDataDecryptedObject,
  key: string,
  label: string,
  pattern?: RegExp,
): string {
  return requiredString(context, itemIndex, credentials[key], label, pattern);
}

function normalizeBaseUrl(
  context: IExecuteFunctions,
  itemIndex: number,
  value: unknown,
  label: string,
): string {
  return requiredString(context, itemIndex, value, label).replace(/\/+$/u, '');
}

function delegationTokenScopes(
  targetType: DelegationTargetType,
  maxAccess: DelegationAccess,
): string[] {
  const family = targetType === 'space' ? 'spaces' : 'resources';
  if (maxAccess === 'free_busy' || maxAccess === 'read') return [`${family}:read`];
  if (maxAccess === 'write') return [`${family}:write`];
  return [`${family}:manage`];
}

function validateTarget(
  context: IExecuteFunctions,
  itemIndex: number,
  targetType: DelegationTargetType,
  value: unknown,
): string {
  if (targetType === 'space') {
    return requiredString(context, itemIndex, value, 'Target ID', /^spc_[A-Za-z0-9_-]+$/u);
  }
  if (targetType === 'record') {
    return requiredString(context, itemIndex, value, 'Target ID', /^rec_[A-Za-z0-9_-]+$/u);
  }
  return requiredString(context, itemIndex, value, 'Target ID', /^[A-Za-z][A-Za-z0-9_]{0,99}$/u);
}

function delegationConstraints(
  context: IExecuteFunctions,
  itemIndex: number,
): IDataObject | undefined {
  const constraints: IDataObject = {};
  const singleUse = context.getNodeParameter('singleUse', itemIndex, true) as boolean;
  const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;

  if (singleUse) constraints.maxUses = 1;

  const expiresAt = String(options.expiresAt ?? '').trim();
  if (expiresAt) constraints.expiresAt = expiresAt;

  if (options.remainingRedelegationDepth !== undefined && options.remainingRedelegationDepth !== null) {
    const depth = Number(options.remainingRedelegationDepth);
    if (!Number.isInteger(depth) || depth < 0 || depth > 3) {
      throw new NodeOperationError(
        context.getNode(),
        'Remaining Re-Delegation Depth must be an integer between 0 and 3',
        { itemIndex },
      );
    }
    if (depth > 0) constraints.remainingRedelegationDepth = depth;
  }

  return Object.keys(constraints).length ? constraints : undefined;
}

async function issueUserToken(
  context: IExecuteFunctions,
  itemIndex: number,
  credentials: ICredentialDataDecryptedObject,
  principalUserId: string,
  scopes: string[],
): Promise<string> {
  const identityBaseUrl = normalizeBaseUrl(
    context,
    itemIndex,
    credentials.identityBaseUrl,
    'LifeSpace Identity Base URL',
  );
  const response = await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceAgentExecutionApi',
    {
      method: 'POST',
      url: `${identityBaseUrl}/internal/v1/tokens`,
      body: {
        subjectId: principalUserId,
        scopes,
      },
      json: true,
    },
  ) as UserTokenResponse;

  return requiredString(
    context,
    itemIndex,
    response?.data?.accessToken,
    'LifeSpace User access token',
  );
}

export class LifeSpaceDelegation implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace Delegation',
    name: 'lifeSpaceDelegation',
    icon: {
      light: 'file:lifespace.svg',
      dark: 'file:lifespace.dark.svg',
    },
    group: ['transform'],
    version: 1,
    subtitle: 'Create Delegation',
    description: 'Create a bounded LifeSpace User → Agent Delegation after the application has confirmed user authorization',
    defaults: {
      name: 'LifeSpace Delegation',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [
      {
        name: 'lifeSpaceAgentExecutionApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Principal User ID',
        name: 'principalUserId',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'usr_...',
        description: 'LifeSpace User whose already-confirmed Authority is being delegated. Supply this from trusted workflow authorization context.',
      },
      {
        displayName: 'Space ID',
        name: 'spaceId',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'spc_...',
        description: 'Source Space whose current User Authority bounds the Delegation',
      },
      {
        displayName: 'Target Type',
        name: 'targetType',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Model', value: 'model' },
          { name: 'Record', value: 'record' },
          { name: 'Space', value: 'space' },
        ],
        default: 'model',
      },
      {
        displayName: 'Target ID',
        name: 'targetId',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'task / rec_... / spc_...',
        description: 'Model key, record ID, or Space ID selected by Target Type',
      },
      {
        displayName: 'Maximum Access',
        name: 'maxAccess',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Free / Busy', value: 'free_busy', description: 'Valid only for Space-scoped Delegation' },
          { name: 'Read', value: 'read' },
          { name: 'Write', value: 'write' },
          { name: 'Manage', value: 'manage' },
        ],
        default: 'write',
      },
      {
        displayName: 'Single Use',
        name: 'singleUse',
        type: 'boolean',
        default: true,
        description: 'Whether LifeSpace should consume this Delegation after its first governed use. Authority v3 currently supports maxUses=1 when enabled.',
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        options: [
          {
            displayName: 'Expires At',
            name: 'expiresAt',
            type: 'dateTime',
            default: '',
            description: 'Optional absolute expiry. LifeSpace Core validates that it is in the future.',
          },
          {
            displayName: 'Remaining Re-Delegation Depth',
            name: 'remainingRedelegationDepth',
            type: 'number',
            typeOptions: {
              minValue: 0,
              maxValue: 3,
            },
            default: 0,
            description: 'How many additional child Delegation hops may be issued. Keep 0 when re-delegation is not needed.',
          },
        ],
      },
    ],
  };

  constructor() {
    const description = this.description as INodeTypeDescription & { usableAsTool?: boolean };
    delete description.usableAsTool;
    this.description = description;
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];
    const tokenCache = new Map<string, Promise<string>>();

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      try {
        const credentials = await this.getCredentials('lifeSpaceAgentExecutionApi', itemIndex);
        const coreBaseUrl = normalizeBaseUrl(
          this,
          itemIndex,
          credentials.coreBaseUrl,
          'LifeSpace Core API Base URL',
        );
        const agentId = credentialString(
          this,
          itemIndex,
          credentials,
          'agentId',
          'LifeSpace Agent ID',
          /^agt_[A-Za-z0-9_-]+$/u,
        );
        const principalUserId = requiredString(
          this,
          itemIndex,
          this.getNodeParameter('principalUserId', itemIndex),
          'Principal User ID',
          /^usr_[A-Za-z0-9_-]+$/u,
        );
        const spaceId = requiredString(
          this,
          itemIndex,
          this.getNodeParameter('spaceId', itemIndex),
          'Space ID',
          /^spc_[A-Za-z0-9_-]+$/u,
        );
        const targetType = String(this.getNodeParameter('targetType', itemIndex)) as DelegationTargetType;
        if (!['space', 'model', 'record'].includes(targetType)) {
          throw new NodeOperationError(this.getNode(), 'Target Type is invalid', { itemIndex });
        }
        const targetId = validateTarget(
          this,
          itemIndex,
          targetType,
          this.getNodeParameter('targetId', itemIndex),
        );
        const maxAccess = String(this.getNodeParameter('maxAccess', itemIndex)) as DelegationAccess;
        if (!['free_busy', 'read', 'write', 'manage'].includes(maxAccess)) {
          throw new NodeOperationError(this.getNode(), 'Maximum Access is invalid', { itemIndex });
        }
        if (targetType !== 'space' && maxAccess === 'free_busy') {
          throw new NodeOperationError(
            this.getNode(),
            'Free / Busy access is valid only for a Space-scoped Delegation',
            { itemIndex },
          );
        }
        if (targetType === 'space' && targetId !== spaceId) {
          throw new NodeOperationError(
            this.getNode(),
            'A Space-scoped Delegation Target ID must equal Space ID',
            { itemIndex },
          );
        }

        const scopes = delegationTokenScopes(targetType, maxAccess);
        const tokenCacheKey = `${principalUserId}\u001f${[...scopes].sort().join(' ')}`;
        let tokenPromise = tokenCache.get(tokenCacheKey);
        if (!tokenPromise) {
          tokenPromise = issueUserToken(this, itemIndex, credentials, principalUserId, scopes);
          tokenCache.set(tokenCacheKey, tokenPromise);
        }
        const userBearer = await tokenPromise;
        const constraints = delegationConstraints(this, itemIndex);
        const body: IDataObject = {
          actor: { type: 'agent', id: agentId },
          scope: {
            target: { type: targetType, id: targetId },
            maxAccess,
          },
          ...(constraints ? { constraints } : {}),
        };

        const response = await this.helpers.httpRequest.call(this, {
          method: 'POST',
          url: `${coreBaseUrl}/spaces/${encodeURIComponent(spaceId)}/delegations`,
          headers: {
            Authorization: `Bearer ${userBearer}`,
          },
          body,
          json: true,
        }) as DelegationResponse;

        const delegationId = String(response?.data?.id ?? '').trim();
        if (!/^dlg_[A-Za-z0-9_-]+$/u.test(delegationId)) {
          throw new NodeOperationError(
            this.getNode(),
            'LifeSpace Delegation response did not contain a valid dlg_* ID',
            { itemIndex },
          );
        }

        output.push({
          json: response as unknown as IDataObject,
          pairedItem: { item: itemIndex },
        });
      } catch (error) {
        if (this.continueOnFail()) {
          output.push({
            json: { error: error instanceof Error ? error.message : String(error) },
            pairedItem: { item: itemIndex },
          });
          continue;
        }
        throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
      }
    }

    return [output];
  }
}
