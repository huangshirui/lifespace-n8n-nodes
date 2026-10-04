import type {
  ICredentialDataDecryptedObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  ISupplyDataFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export type LifeSpaceRuntimeContext = IExecuteFunctions | ISupplyDataFunctions | ILoadOptionsFunctions;

export type LifeSpaceExecutionAuthority =
  | { mode: 'service' }
  | {
      mode: 'delegatedAgent';
      accessToken: string;
      principalType: 'agent' | 'user';
      principalId: string;
      principalUserId: string | null;
      agentId: string;
      delegationId: string | null;
    };

type AgentTokenResponse = {
  data?: {
    accessToken?: unknown;
    principalId?: unknown;
    principalType?: unknown;
    applicationId?: unknown;
    purpose?: unknown;
    actor?: { type?: unknown; id?: unknown };
  };
};

function nodeParameter(
  context: LifeSpaceRuntimeContext,
  name: string,
  itemIndex: number,
  fallback: unknown,
): unknown {
  const loadContext = context as ILoadOptionsFunctions;
  if (typeof loadContext.getCurrentNodeParameter === 'function') {
    try {
      const current = loadContext.getCurrentNodeParameter(name);
      if (current !== undefined) return current;
    } catch {
      // Fall back to the saved design-time parameter below.
    }
    try {
      return loadContext.getNodeParameter(name, fallback as never);
    } catch {
      return fallback;
    }
  }

  try {
    const runtimeContext = context as IExecuteFunctions | ISupplyDataFunctions;
    return runtimeContext.getNodeParameter(name, itemIndex, fallback as never);
  } catch {
    return fallback;
  }
}

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

export function delegatedAgentCoreBaseUrl(
  context: LifeSpaceRuntimeContext,
  credentials: ICredentialDataDecryptedObject,
): string {
  return requiredString(context, credentials.coreBaseUrl, 'LifeSpace Core API Base URL')
    .replace(/\/+$/u, '');
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

/**
 * Resolve the Agent execution identity for one request.
 *
 * No Delegation selector means direct Agent execution:
 *   Principal=Agent / Actor=Agent.
 *
 * An explicit Delegation selector means represented User execution:
 *   Principal=User / Actor=Agent.
 * In that profile the trusted workflow context must also supply the User Principal ID.
 *
 * `mode: delegatedAgent` is retained as the adapter's internal compatibility discriminator
 * for the current lsa_* + agt_* credential implementation. It no longer means that every
 * Agent request is necessarily delegated.
 */
export async function delegatedAgentAuthority(
  context: LifeSpaceRuntimeContext,
  itemIndex: number,
  scopes: string[],
  options: {
    requireDelegation?: boolean;
    principalParameter?: string;
    delegationParameter?: string;
  } = {},
): Promise<LifeSpaceExecutionAuthority> {
  const principalParameter = options.principalParameter ?? 'principalUserId';
  const delegationParameter = options.delegationParameter ?? 'delegationId';
  const principalValue = String(nodeParameter(context, principalParameter, itemIndex, '') ?? '').trim();
  const delegationValue = String(nodeParameter(context, delegationParameter, itemIndex, '') ?? '').trim();

  if (delegationValue && !/^dlg_[A-Za-z0-9_-]+$/u.test(delegationValue)) {
    throw new NodeOperationError(context.getNode(), 'Delegation ID must be a valid dlg_* identifier');
  }

  const credentials = await context.getCredentials('lifeSpaceAgentExecutionApi', itemIndex);
  const agentId = credentialString(
    context,
    credentials,
    'agentId',
    'LifeSpace Agent ID',
    /^agt_[A-Za-z0-9_-]+$/u,
  );
  const baseUrl = identityBaseUrl(context, credentials);

  const representedUser = Boolean(delegationValue);
  let principalUserId: string | null = null;
  if (representedUser) {
    principalUserId = requiredString(
      context,
      principalValue,
      'Principal User ID',
      /^usr_[A-Za-z0-9_-]+$/u,
    );
  }

  // `requireDelegation` existed for the pre-0.2.0 represented-only profile. Direct
  // Agent Authority is now a valid execution profile, so absence of dlg_* deliberately
  // falls back to Principal=Agent / Actor=Agent instead of failing before Core.
  void options.requireDelegation;

  const body = representedUser
    ? {
        principalType: 'user' as const,
        principalId: principalUserId!,
        agentId,
        scopes: [...new Set(scopes)],
      }
    : {
        agentId,
        scopes: [...new Set(scopes)],
      };

  const response = await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceAgentExecutionApi',
    {
      method: 'POST',
      url: `${baseUrl}/internal/v1/agent-execution-tokens`,
      body,
      json: true,
    },
  ) as AgentTokenResponse;

  const data = response?.data;
  const accessToken = requiredString(
    context,
    data?.accessToken,
    'Agent execution access token',
  );
  const expectedPrincipalType = representedUser ? 'user' : 'agent';
  const expectedPrincipalId = representedUser ? principalUserId! : agentId;
  if (
    data?.principalId !== expectedPrincipalId
    || data?.principalType !== expectedPrincipalType
    || data?.actor?.type !== 'agent'
    || data?.actor?.id !== agentId
    || data?.purpose !== 'agent_execution'
  ) {
    throw new NodeOperationError(
      context.getNode(),
      'LifeSpace Identity returned an Agent execution token for a different execution context',
    );
  }

  return {
    mode: 'delegatedAgent',
    accessToken,
    principalType: expectedPrincipalType,
    principalId: expectedPrincipalId,
    principalUserId,
    agentId,
    delegationId: delegationValue || null,
  };
}

export async function executionAuthority(
  context: LifeSpaceRuntimeContext,
  itemIndex: number,
  requiredAccess: 'read' | 'write' | 'manage',
  options: {
    requireDelegation?: boolean;
    modeParameter?: string;
    principalParameter?: string;
    delegationParameter?: string;
  } = {},
): Promise<LifeSpaceExecutionAuthority> {
  const modeParameter = options.modeParameter ?? 'authorityMode';
  const mode = String(nodeParameter(context, modeParameter, itemIndex, 'service') ?? 'service');
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
