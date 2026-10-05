import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  ISupplyDataFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type AuthorizationContext = IExecuteFunctions | ISupplyDataFunctions;

export type AuthorizationScope = {
  target: { type: 'space' | 'model' | 'record'; id: string };
  maxAccess: 'free_busy' | 'read' | 'write' | 'manage';
};

export type AuthorizationRequired = {
  spaceId: string;
  scopes: AuthorizationScope[];
};

export function requiredIdentifier(
  context: AuthorizationContext,
  value: unknown,
  label: string,
  pattern: RegExp,
): string {
  const normalized = String(value ?? '').trim();
  if (!pattern.test(normalized)) {
    throw new NodeOperationError(context.getNode(), `${label} is missing or invalid`);
  }
  return normalized;
}

export function trustedPrincipalUserId(
  context: AuthorizationContext,
  itemIndex: number,
  parameter = 'principalUserId',
): string {
  return requiredIdentifier(
    context,
    context.getNodeParameter(parameter, itemIndex, ''),
    'Principal User ID',
    /^usr_[A-Za-z0-9_-]+$/u,
  );
}

export function authorizationRequired(
  context: AuthorizationContext,
  value: unknown,
): AuthorizationRequired {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NodeOperationError(context.getNode(), 'authorizationRequired must be an object');
  }
  const input = value as Record<string, unknown>;
  const spaceId = requiredIdentifier(context, input.spaceId, 'Space ID', /^spc_[A-Za-z0-9_-]+$/u);
  if (!Array.isArray(input.scopes) || input.scopes.length < 1 || input.scopes.length > 20) {
    throw new NodeOperationError(context.getNode(), 'authorizationRequired.scopes must contain 1-20 scopes');
  }
  const scopes = input.scopes.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new NodeOperationError(context.getNode(), 'Each authorization scope must be an object');
    }
    const scope = entry as Record<string, unknown>;
    const target = scope.target;
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new NodeOperationError(context.getNode(), 'Authorization scope target must be an object');
    }
    const targetRecord = target as Record<string, unknown>;
    const type = String(targetRecord.type ?? '') as AuthorizationScope['target']['type'];
    if (!['space', 'model', 'record'].includes(type)) {
      throw new NodeOperationError(context.getNode(), 'Authorization scope target type is invalid');
    }
    const id = String(targetRecord.id ?? '').trim();
    const validId = type === 'space'
      ? /^spc_[A-Za-z0-9_-]+$/u.test(id)
      : type === 'record'
        ? /^rec_[A-Za-z0-9_-]+$/u.test(id)
        : /^[A-Za-z][A-Za-z0-9_]{0,99}$/u.test(id);
    if (!validId) throw new NodeOperationError(context.getNode(), 'Authorization scope target ID is invalid');
    const maxAccess = String(scope.maxAccess ?? '') as AuthorizationScope['maxAccess'];
    if (!['free_busy', 'read', 'write', 'manage'].includes(maxAccess)) {
      throw new NodeOperationError(context.getNode(), 'Authorization scope maxAccess is invalid');
    }
    if (type !== 'space' && maxAccess === 'free_busy') {
      throw new NodeOperationError(context.getNode(), 'free_busy is valid only for Space scopes');
    }
    return { target: { type, id }, maxAccess };
  });
  return { spaceId, scopes };
}

export async function agentAuthorizationRequest(
  context: AuthorizationContext,
  itemIndex: number,
  options: IHttpRequestOptions,
): Promise<unknown> {
  const credentials = await context.getCredentials('lifeSpaceAgentExecutionApi', itemIndex);
  const baseUrl = String(credentials.coreBaseUrl ?? '').trim().replace(/\/+$/u, '');
  if (!baseUrl) throw new NodeOperationError(context.getNode(), 'LifeSpace Core API Base URL is missing');
  return await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceAgentExecutionApi',
    {
      ...options,
      url: `${baseUrl}${options.url}`,
      json: true,
    },
  );
}

export function responseJson(value: unknown): IDataObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as IDataObject;
  return { data: value as never };
}

export function toolOutput(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ ok: false, error: { code: 'INVALID_RESPONSE', message: String(value) } });
  }
}
