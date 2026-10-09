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
      delegationId: string | null;
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
): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new NodeOperationError(context.getNode(), `${label} is missing or invalid`);
  return normalized;
}

export function delegatedAgentCoreBaseUrl(
  context: LifeSpaceRuntimeContext,
  credentials: ICredentialDataDecryptedObject,
): string {
  return requiredString(context, credentials.coreBaseUrl, 'LifeSpace Core API Base URL')
    .replace(/\/+$/u, '');
}

export function requestedResourceScopes(requiredAccess: 'read' | 'write' | 'manage'): string[] {
  if (requiredAccess === 'read') return ['resources:read'];
  if (requiredAccess === 'write') return ['resources:read', 'resources:write'];
  return ['resources:read', 'resources:write', 'resources:manage'];
}

/**
 * Resolve Agent execution for one Core request.
 *
 * LifeSpace Agent API credentials (`lsp_agt_*`) authenticate the Application + Agent
 * directly at Core. No Identity token minting is required by the adapter.
 *
 * No Delegation selector means direct Agent execution:
 *   Principal=Agent / Actor=Agent.
 *
 * An explicit `dlg_*` selector means represented execution:
 *   Principal is resolved by Core from the current Delegation chain / Actor=Agent.
 * The adapter never authenticates represented execution from a caller-supplied `usr_*`.
 *
 * `principalUserId` remains available to Authorization Request nodes as trusted workflow
 * context only; it is not an execution credential and is deliberately ignored here.
 */
export async function delegatedAgentAuthority(
  context: LifeSpaceRuntimeContext,
  itemIndex: number,
  _scopes: string[],
  options: {
    requireDelegation?: boolean;
    principalParameter?: string;
    delegationParameter?: string;
  } = {},
): Promise<LifeSpaceExecutionAuthority> {
  const delegationParameter = options.delegationParameter ?? 'delegationId';
  const delegationValue = String(nodeParameter(context, delegationParameter, itemIndex, '') ?? '').trim();

  if (delegationValue && !/^dlg_[A-Za-z0-9_-]+$/u.test(delegationValue)) {
    throw new NodeOperationError(context.getNode(), 'Delegation ID must be a valid dlg_* identifier');
  }

  // Since 0.2.0, discovery/helper reads may execute with direct Agent authority.
  // A configured readDelegationId still selects represented User/Agent execution,
  // but its absence must not make the Agent Tool editor unusable.
  const helperReadMayUseDirectAgent = delegationParameter === 'readDelegationId';
  if (!delegationValue && options.requireDelegation === true && !helperReadMayUseDirectAgent) {
    throw new NodeOperationError(
      context.getNode(),
      'Delegation ID is required for represented Agent execution',
    );
  }

  const credentials = await context.getCredentials('lifeSpaceAgentExecutionApi', itemIndex);
  requiredString(context, credentials.coreBaseUrl, 'LifeSpace Core API Base URL');
  const agentSecret = requiredString(context, credentials.agentSecret, 'LifeSpace Agent API Credential');
  if (!/^lsp_agt_[A-Za-z0-9_-]+$/u.test(agentSecret)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace Agent API Credential must be a valid lsp_agt_* credential');
  }

  return {
    mode: 'delegatedAgent',
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
    ...(authority.delegationId
      ? { 'X-LifeSpace-Delegation-Id': authority.delegationId }
      : {}),
  };
  return await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceAgentExecutionApi',
    { ...options, headers },
  );
}
