import type {
  ICredentialDataDecryptedObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  ISupplyDataFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export type LifeSpaceRuntimeContext = IExecuteFunctions | ISupplyDataFunctions;

export type LifeSpaceExecutionAuthority =
  | { mode: 'service' }
  | {
      mode: 'delegatedAgent';
      accessToken: string;
      principalUserId: string;
      agentId: string;
      delegationId: string | null;
    };

type AgentTokenResponse = {
  data?: {
    accessToken?: unknown;
    principalId?: unknown;
    applicationId?: unknown;
    actor?: { type?: unknown; id?: unknown };
  };
};

function requiredString(
  context: LifeSpaceRuntimeContext,
  value: unknown,
  label: string,
  pattern?: RegExp,
): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || (pattern && !pattern.test(normalized))) {
    throw new NodeOperationError(context.getNode(), `${label} is missing or invalid`);
  }
  return normalized;
}

function credentialString(
  context: LifeSpaceRuntimeContext,
  credentials: ICredentialDataDecryptedObject,
  key: string,
  label: string,
  pattern?: RegExp,
): string {
  return requiredString(context, credentials[key], label, pattern);
}

function identityBaseUrl(
  context: LifeSpaceRuntimeContext,
  credentials: ICredentialDataDecryptedObject,
): string {
  return requiredString(context, credentials.identityBaseUrl, 'LifeSpace Identity Base URL')
    .replace(/\/+$/u, '');
}

export function requestedResourceScopes(requiredAccess: 'read' | 'write' | 'manage'): string[] {
  if (requiredAccess === 'read') return ['resources:read'];
  if (requiredAccess === 'write') return ['resources:read', 'resources:write'];
  return ['resources:read', 'resources:write', 'resources:manage'];
}

export async function delegatedAgentAuthority(
  context: LifeSpaceRuntimeContext,
  itemIndex: number,
  scopes: string[],
  options: { requireDelegation?: boolean } = {},
): Promise<LifeSpaceExecutionAuthority> {
  const principalUserId = requiredString(
    context,
    context.getNodeParameter('principalUserId', itemIndex, ''),
    'Principal User ID',
    /^usr_[A-Za-z0-9_-]+$/u,
  );
  const delegationValue = String(context.getNodeParameter('delegationId', itemIndex, '') ?? '').trim();
  if (options.requireDelegation !== false && !/^dlg_[A-Za-z0-9_-]+$/u.test(delegationValue)) {
    throw new NodeOperationError(
      context.getNode(),
      'Delegation ID is required for delegated Agent execution',
    );
  }
  if (delegationValue && !/^dlg_[A-Za-z0-9_-]+$/u.test(delegationValue)) {
    throw new NodeOperationError(context.getNode(), 'Delegation ID must be a valid dlg_* identifier');
  }

  const credentials = await context.getCredentials('lifeSpaceAgentExecution', itemIndex);
  const agentId = credentialString(
    context,
    credentials,
    'agentId',
    'LifeSpace Agent ID',
    /^agt_[A-Za-z0-9_-]+$/u,
  );
  const baseUrl = identityBaseUrl(context, credentials);

  const response = await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceAgentExecution',
    {
      method: 'POST',
      url: `${baseUrl}/internal/v1/agent-tokens`,
      body: {
        subjectId: principalUserId,
        agentId,
        scopes: [...new Set(scopes)],
      },
      json: true,
    },
  ) as AgentTokenResponse;

  const data = response?.data;
  const accessToken = requiredString(
    context,
    data?.accessToken,
    'Delegated Agent access token',
  );
  if (
    data?.principalId !== principalUserId
    || data?.actor?.type !== 'agent'
    || data?.actor?.id !== agentId
  ) {
    throw new NodeOperationError(
      context.getNode(),
      'LifeSpace Identity returned a delegated Agent token for a different execution context',
    );
  }

  return {
    mode: 'delegatedAgent',
    accessToken,
    principalUserId,
    agentId,
    delegationId: delegationValue || null,
  };
}

export async function executionAuthority(
  context: LifeSpaceRuntimeContext,
  itemIndex: number,
  requiredAccess: 'read' | 'write' | 'manage',
  options: { requireDelegation?: boolean } = {},
): Promise<LifeSpaceExecutionAuthority> {
  const mode = String(context.getNodeParameter('authorityMode', itemIndex, 'service') ?? 'service');
  if (mode === 'service') return { mode: 'service' };
  if (mode !== 'delegatedAgent') {
    throw new NodeOperationError(context.getNode(), `Unsupported LifeSpace authority mode ${mode}`);
  }
  return delegatedAgentAuthority(
    context,
    itemIndex,
    requestedResourceScopes(requiredAccess),
    options,
  );
}

export async function lifeSpaceRequest(
  context: LifeSpaceRuntimeContext,
  authority: LifeSpaceExecutionAuthority,
  options: IHttpRequestOptions,
): Promise<unknown> {
  if (authority.mode === 'service') {
    return await context.helpers.httpRequestWithAuthentication.call(
      context,
      'lifeSpaceApi',
      options,
    );
  }

  const headers = {
    ...(options.headers ?? {}),
    Authorization: `Bearer ${authority.accessToken}`,
    ...(authority.delegationId
      ? { 'X-LifeSpace-Delegation-Id': authority.delegationId }
      : {}),
  };
  return await context.helpers.httpRequest.call(context, {
    ...options,
    headers,
  });
}
