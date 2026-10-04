import type {
  IDataObject,
  INodeProperties,
  ISupplyDataFunctions,
  SupplyData,
} from 'n8n-workflow';
import { decodeAgentToolSemanticSnapshot } from '../agent/lifeSpaceToolSnapshot';
import { LifeSpaceTool } from '../LifeSpaceTool/LifeSpaceTool.node';

type StructuralAiTool = {
  name: string;
  description: string;
  schema: {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties: false;
  };
  metadata: Record<string, unknown>;
  invoke: (query: unknown) => Promise<string>;
};

type AuthorizationScope = {
  target: { type: 'model' | 'record'; id: string };
  maxAccess: 'read' | 'write' | 'manage';
};

const LEGACY_AUTH_PARAMETERS = new Set([
  'authorityMode',
  'principalUserId',
  'delegationId',
  'readDelegationId',
  'batchDelegationIds',
]);

const USER_AUTH_RECOVERABLE_CODES = new Set([
  'DELEGATION_REQUIRED',
  'DELEGATION_INVALID',
  'DELEGATION_SCOPE_INSUFFICIENT',
  'PRINCIPAL_AUTHORITY_INSUFFICIENT',
]);

function internalOnly(property: INodeProperties): INodeProperties {
  if (!LEGACY_AUTH_PARAMETERS.has(property.name)) return property;
  return {
    ...property,
    ...(property.name === 'authorityMode' ? { default: 'delegatedAgent' } : {}),
    displayOptions: { show: { __lifeSpaceInternalOnly: ['true'] } },
  };
}

function authorizationProperties(): INodeProperties[] {
  return [
    {
      displayName: 'Enable User Authorization',
      name: 'enableUserAuthorization',
      type: 'boolean',
      default: false,
      noDataExpression: true,
      description: 'Allow the Agent to optionally execute this Tool as a User Principal by supplying a runtime Delegation ID. When disabled, the Tool always uses the Agent\'s own Authority.',
    },
    {
      displayName: 'Principal User ID',
      name: 'authorizationPrincipalUserId',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'usr_...',
      displayOptions: { show: { enableUserAuthorization: [true] } },
      description: 'Trusted workflow context for the User whose Delegation may be used. Configure this with an n8n expression from the identity-mapping step. It is never exposed as an AI Tool argument.',
    },
  ];
}

function agentProperties(properties: INodeProperties[]): INodeProperties[] {
  const projected = properties
    .filter((property) => property.name !== 'queryMode' && property.name !== 'capabilityQueryKey')
    .map(internalOnly);
  const spaceIndex = projected.findIndex((property) => property.name === 'spaceId');
  const insertAt = spaceIndex >= 0 ? spaceIndex : 0;
  projected.splice(insertAt, 0, ...authorizationProperties());
  return projected;
}

function agentExecutionContext(
  context: ISupplyDataFunctions,
  itemIndex: number,
  principalUserId: string,
  delegationId: string,
): ISupplyDataFunctions {
  return new Proxy(context, {
    get(target, property, receiver) {
      if (property !== 'getNodeParameter') return Reflect.get(target, property, receiver);
      return (name: string, requestedItemIndex: number, fallback?: unknown, options?: unknown) => {
        if (name === 'authorityMode') return 'delegatedAgent';
        if (name === 'principalUserId') return delegationId ? principalUserId : '';
        if (name === 'delegationId' || name === 'readDelegationId') return delegationId;
        if (name === 'batchDelegationIds') return '[]';
        return target.getNodeParameter(
          name,
          requestedItemIndex ?? itemIndex,
          fallback as never,
          options as never,
        );
      };
    },
  });
}

function toolInput(query: unknown): { semantic: unknown; delegationId: string } {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return { semantic: query, delegationId: '' };
  }
  const semantic = { ...(query as Record<string, unknown>) };
  const delegationId = String(semantic.delegationId ?? '').trim();
  delete semantic.delegationId;
  return { semantic, delegationId };
}

function invalidDelegationOutput(): string {
  return JSON.stringify({
    ok: false,
    error: {
      code: 'INVALID_DELEGATION_ID',
      message: 'delegationId must be a valid LifeSpace dlg_* identifier',
      retryable: false,
      nextAction: 'request_authorization',
    },
  });
}

function requiredAccess(
  operation: string,
  actionKey: string,
  snapshot: ReturnType<typeof decodeAgentToolSemanticSnapshot>,
): AuthorizationScope['maxAccess'] | null {
  if (operation === 'query') return 'read';
  if (['create', 'batchCreate', 'update', 'delete'].includes(operation)) return 'write';
  if (operation !== 'action' || !snapshot) return null;
  const access = snapshot.model.actions.find((action) => action.key === actionKey)?.access;
  return access === 'read' || access === 'write' || access === 'manage' ? access : null;
}

function authorizationScope(
  context: ISupplyDataFunctions,
  itemIndex: number,
  semantic: unknown,
): { spaceId: string; scopes: AuthorizationScope[] } | null {
  const spaceId = String(context.getNodeParameter('spaceId', itemIndex, '') ?? '').trim();
  const snapshot = decodeAgentToolSemanticSnapshot(
    context.getNodeParameter('recordType', itemIndex, ''),
  );
  if (!spaceId || !snapshot) return null;

  const operation = String(context.getNodeParameter('operation', itemIndex, '') ?? '');
  const actionKey = String(context.getNodeParameter('actionKey', itemIndex, '') ?? '').trim();
  const access = requiredAccess(operation, actionKey, snapshot);
  if (!access) return null;

  const input = semantic && typeof semantic === 'object' && !Array.isArray(semantic)
    ? semantic as Record<string, unknown>
    : {};
  const recordId = String(input.recordId ?? '').trim();
  const recordScoped = ['update', 'delete', 'action'].includes(operation)
    && /^rec_[A-Za-z0-9_-]+$/u.test(recordId);
  const scope: AuthorizationScope = recordScoped
    ? { target: { type: 'record', id: recordId }, maxAccess: access }
    : { target: { type: 'model', id: snapshot.model.key }, maxAccess: access };

  return { spaceId, scopes: [scope] };
}

function withAuthorizationRequired(
  output: string,
  required: { spaceId: string; scopes: AuthorizationScope[] } | null,
): string {
  if (!required) return output;
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch {
    return output;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  const result = value as Record<string, unknown>;
  const error = result.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return output;
  const errorRecord = error as Record<string, unknown>;
  const code = String(errorRecord.code ?? '');
  if (!USER_AUTH_RECOVERABLE_CODES.has(code)) return output;

  return JSON.stringify({
    ...result,
    error: {
      ...errorRecord,
      retryable: false,
      nextAction: 'request_authorization',
      instruction: 'Call LifeSpace Request Authorization with authorizationRequired. After confirmation, retry this Tool with the returned dlg_* as delegationId.',
    },
    authorizationRequired: required,
  });
}

export class LifeSpaceAgentTool extends LifeSpaceTool {
  constructor() {
    super();
    this.description = {
      ...this.description,
      icon: {
        light: 'file:lifespace.svg',
        dark: 'file:lifespace.dark.svg',
      },
      description: 'Expose one scoped LifeSpace operation to an AI Agent',
      credentials: [
        {
          name: 'lifeSpaceAgentExecutionApi',
          required: true,
        },
      ],
      properties: agentProperties(this.description.properties),
    };
  }

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const enableUserAuthorization = Boolean(
      this.getNodeParameter('enableUserAuthorization', itemIndex, false),
    );
    const principalUserId = enableUserAuthorization
      ? String(this.getNodeParameter('authorizationPrincipalUserId', itemIndex, '') ?? '').trim()
      : '';

    // Build the visible Tool contract under direct Agent Authority. Runtime calls below
    // create a fresh base Tool context so the short-lived execution token is bound to
    // the delegationId selected for that individual AI Tool call rather than cached
    // across calls with different Principals.
    const directContext = agentExecutionContext(this, itemIndex, '', '');
    const supplied = await LifeSpaceTool.prototype.supplyData.call(directContext, itemIndex);
    if (!enableUserAuthorization) return supplied;

    const baseTool = supplied.response as unknown as StructuralAiTool;
    const schema = {
      ...baseTool.schema,
      properties: {
        ...baseTool.schema.properties,
        delegationId: {
          type: 'string',
          description: 'Optional LifeSpace dlg_* returned by a successful authorization confirmation. Omit it to execute with the Agent\'s own Authority.',
        },
      },
    };

    const tool: StructuralAiTool = {
      ...baseTool,
      description: `${baseTool.description} When user authorization is required, pass the dlg_* returned by LifeSpace Confirm Authorization as delegationId. Omit delegationId to use the Agent's own Authority.`,
      schema,
      metadata: {
        ...baseTool.metadata,
        lifeSpaceUserAuthorization: 'optional',
      },
      invoke: async (query: unknown): Promise<string> => {
        const { semantic, delegationId } = toolInput(query);
        if (delegationId && !/^dlg_[A-Za-z0-9_-]+$/u.test(delegationId)) {
          return invalidDelegationOutput();
        }
        if (delegationId && !/^usr_[A-Za-z0-9_-]+$/u.test(principalUserId)) {
          return JSON.stringify({
            ok: false,
            error: {
              code: 'USER_CONTEXT_REQUIRED',
              message: 'A trusted Principal User ID is required to use delegationId',
              retryable: false,
              nextAction: 'report_failure',
            },
          });
        }

        const executionContext = agentExecutionContext(
          this,
          itemIndex,
          principalUserId,
          delegationId,
        );
        const runtimeSupply = await LifeSpaceTool.prototype.supplyData.call(
          executionContext,
          itemIndex,
        );
        const runtimeTool = runtimeSupply.response as unknown as StructuralAiTool;
        const output = await runtimeTool.invoke(semantic as IDataObject);
        return withAuthorizationRequired(
          output,
          authorizationScope(this, itemIndex, semantic),
        );
      },
    };

    return { response: tool };
  }
}
