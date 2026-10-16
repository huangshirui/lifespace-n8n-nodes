import type {
  IExecuteFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  ISupplyDataFunctions,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export type DiscoveryAccess = 'read' | 'write' | 'manage';

export type DiscoveryRelationLookup =
  | {
      supported: true;
      method: 'GET';
      pathTemplate: string;
      searchParameter: string;
      cursorParameter: string;
      limitParameter: string;
    }
  | {
      supported: false;
      reason: string;
    };

export type DiscoveryRelationResolution =
  | {
      supported: true;
      method: 'POST';
      pathTemplate: string;
      maxIds: number;
    }
  | {
      supported: false;
      reason: string;
    };

export type DiscoveryRelation = {
  targetModel: string;
  cardinality: 'one' | 'many';
  lookup: DiscoveryRelationLookup;
  resolution?: DiscoveryRelationResolution;
};

export type DiscoveryField = {
  key: string;
  type: 'string' | 'text' | 'integer' | 'number' | 'boolean' | 'date' | 'instant' | 'datetime' | 'timezone' | 'enum' | 'person' | 'person_list' | 'record' | 'record_list' | 'range<date>' | 'range<instant>' | 'temporal_range';
  title?: string;
  description?: string;
  required?: boolean;
  nullable?: boolean;
  immutable?: boolean;
  readOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  values?: string[];
  targetModel?: string;
  relation?: DiscoveryRelation;
};

export type DiscoveryActionConcurrency = {
  strategy: 'record-version';
  required: true;
  transport: {
    in: 'body';
    name: string;
  };
};

export type DiscoveryAction = {
  key: string;
  access: DiscoveryAccess;
  kind: 'workflow' | 'capability';
  input: { fields: DiscoveryField[] };
  concurrency?: DiscoveryActionConcurrency;
  invocation?: {
    method: 'POST';
    pathTemplate: string;
  };
};

export type DiscoveryCalendarCapabilityBinding =
  | {
      rangeField: string;
      attendeePersonField?: string;
    }
  | {
      allDayField: string;
      timedStartField: string;
      timedEndField: string;
      startTimezoneField: string;
      endTimezoneField: string;
      allDayStartField: string;
      allDayEndExclusiveField: string;
      attendeePersonField?: string;
    };

export type DiscoveryTemporalCapabilityBinding = {
  subjectPersonField: string;
  anchorField: string;
  recurrenceField?: string;
  occurrences?: boolean;
};

export type DiscoveryCapabilityBindings = {
  calendar?: DiscoveryCalendarCapabilityBinding;
  temporal?: DiscoveryTemporalCapabilityBinding;
};

export type DiscoveryRuntimeCapabilities = {
  get: boolean;
  query: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  batchWrite: boolean;
  atomicBatch: boolean;
  transaction: boolean;
  versionedWrite: boolean;
  actions: boolean;
  relationTargetResolution: boolean;
};

export type DiscoveryComparison = {
  field: string;
  valueType: DiscoveryField['type'] | 'date-range' | 'instant-range' | 'temporal-range';
  operators: Array<{
    operator: 'eq' | 'lt' | 'lte' | 'gt' | 'gte';
    transport: 'legacy' | 'explicit';
    parameter?: string;
  }>;
  localDateWindow?: {
    dateStartParameter: string;
    dateEndExclusiveParameter: string;
    timezoneParameter: string;
  };
};

export type DiscoveryCapabilityQueryParameter = {
  parameter: string;
  type: DiscoveryField['type'];
  required?: boolean;
  role?: string;
};

export type DiscoveryCapabilityQuery = {
  key: string;
  input: {
    parameters: DiscoveryCapabilityQueryParameter[];
  };
  sorts?: Array<{ field: string; parameter: string }>;
};

export type DiscoveryFilter = {
  field: string;
  parameter: string;
  mode?: 'enum-set';
};

export type DiscoverySort = {
  field: string;
  parameter: string;
  directions: string[];
};

export type DiscoveryCanonicalFilterTarget = {
  field: string;
  kind: 'field' | 'envelope' | 'temporal_range';
  valueType: DiscoveryField['type'] | 'date-range' | 'instant-range' | 'temporal-range';
  operators: string[];
  nullable?: boolean;
};

export type DiscoveryCanonicalQuery = {
  invocation?: {
    method: 'POST';
    pathTemplate: string;
  };
  composition?: {
    searchFilter?: 'intersection';
    sortAfterSelection?: true;
    paginationAfterSort?: true;
  };
  search?: {
    supported: boolean;
    maxLength?: number;
  };
  filter?: {
    maxDepth: number;
    maxNodes: number;
    targets: DiscoveryCanonicalFilterTarget[];
  };
  sort?: {
    fields: string[];
    directions: string[];
    maxCriteria: number;
    nullPlacement?: string;
    stableTieBreaker?: string;
  };
  page?: {
    minLimit: number;
    maxLimit: number;
    defaultLimit: number;
    cursor: { opaque: true };
  };
};

export type DiscoveryModel = {
  key: string;
  version?: number;
  schemaHash: string;
  origin?: 'native' | 'external';
  spaceId?: string;
  fieldsDynamic?: boolean;
  display: { singular: string; plural: string };
  description?: string;
  access: DiscoveryAccess[];
  fields: DiscoveryField[];
  defaults: Record<string, unknown>;
  actions: DiscoveryAction[];
  query: {
    filters: DiscoveryFilter[];
    comparisons?: DiscoveryComparison[];
    sorts: DiscoverySort[];
    capabilityQueries?: DiscoveryCapabilityQuery[];
    canonical?: DiscoveryCanonicalQuery;
  };
  capabilities: string[];
  capabilityBindings?: DiscoveryCapabilityBindings;
  runtimeCapabilities?: DiscoveryRuntimeCapabilities;
  contract?: { kind: 'native' | 'dynamic'; revision: string | null };
};

export type DiscoverySpaceModel = {
  modelKey: string;
  access: DiscoveryAccess[];
};

export type DiscoverySpace = {
  spaceId: string;
  spaceName?: string;
  models: DiscoverySpaceModel[];
};

export type RuntimeDiscovery = {
  data: {
    models: DiscoveryModel[];
    spaces: DiscoverySpace[];
  };
};

export type RelationTarget = {
  value: string;
  label: string;
};

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function isDiscoveryAccess(value: unknown): value is DiscoveryAccess {
  return value === 'read' || value === 'write' || value === 'manage';
}

function parseRelationLookup(value: unknown): DiscoveryRelationLookup {
  const raw = plainObject(value);
  if (raw?.supported === true) {
    return {
      supported: true,
      method: 'GET',
      pathTemplate: asString(raw.pathTemplate),
      searchParameter: asString(raw.searchParameter),
      cursorParameter: asString(raw.cursorParameter),
      limitParameter: asString(raw.limitParameter),
    };
  }
  return { supported: false, reason: asString(raw?.reason) };
}

function parseRelationResolution(value: unknown): DiscoveryRelationResolution | undefined {
  const raw = plainObject(value);
  if (!raw) return undefined;
  if (raw.supported === true) {
    return {
      supported: true,
      method: 'POST',
      pathTemplate: asString(raw.pathTemplate),
      maxIds: Number(raw.maxIds ?? 0),
    };
  }
  return { supported: false, reason: asString(raw.reason) };
}

function parseField(value: unknown): DiscoveryField {
  const raw = plainObject(value) ?? {};
  const relationRaw = plainObject(raw.relation);
  const relation = relationRaw
    ? {
        targetModel: asString(relationRaw.targetModel),
        cardinality: relationRaw.cardinality === 'many' ? 'many' as const : 'one' as const,
        lookup: parseRelationLookup(relationRaw.lookup),
        resolution: parseRelationResolution(relationRaw.resolution),
      }
    : undefined;
  return {
    key: asString(raw.key),
    type: asString(raw.type) as DiscoveryField['type'],
    title: typeof raw.title === 'string' ? raw.title : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    required: asBoolean(raw.required),
    nullable: asBoolean(raw.nullable),
    immutable: asBoolean(raw.immutable),
    readOnly: asBoolean(raw.readOnly),
    minLength: typeof raw.minLength === 'number' ? raw.minLength : undefined,
    maxLength: typeof raw.maxLength === 'number' ? raw.maxLength : undefined,
    minimum: typeof raw.minimum === 'number' ? raw.minimum : undefined,
    maximum: typeof raw.maximum === 'number' ? raw.maximum : undefined,
    values: Array.isArray(raw.values) ? raw.values.filter((entry): entry is string => typeof entry === 'string') : undefined,
    targetModel: typeof raw.targetModel === 'string' ? raw.targetModel : undefined,
    relation,
  };
}

function parseRuntimeCapabilities(value: unknown): DiscoveryRuntimeCapabilities | undefined {
  const raw = plainObject(value);
  if (!raw) return undefined;
  return {
    get: asBoolean(raw.get),
    query: asBoolean(raw.query),
    create: asBoolean(raw.create),
    update: asBoolean(raw.update),
    delete: asBoolean(raw.delete),
    batchWrite: asBoolean(raw.batchWrite),
    atomicBatch: asBoolean(raw.atomicBatch),
    transaction: asBoolean(raw.transaction),
    versionedWrite: asBoolean(raw.versionedWrite),
    actions: asBoolean(raw.actions),
    relationTargetResolution: asBoolean(raw.relationTargetResolution),
  };
}

function parseDiscoveryModel(value: unknown): DiscoveryModel | null {
  const raw = plainObject(value);
  if (!raw) return null;
  const displayRaw = plainObject(raw.display) ?? {};
  const queryRaw = plainObject(raw.query) ?? {};
  const actions = asArray(raw.actions).map((entry) => {
    const actionRaw = plainObject(entry) ?? {};
    const inputRaw = plainObject(actionRaw.input) ?? {};
    return {
      key: asString(actionRaw.key),
      access: asString(actionRaw.access) as DiscoveryAccess,
      kind: actionRaw.kind === 'capability' ? 'capability' as const : 'workflow' as const,
      input: { fields: asArray(inputRaw.fields).map(parseField) },
      invocation: plainObject(actionRaw.invocation)
        ? { method: 'POST' as const, pathTemplate: asString(plainObject(actionRaw.invocation)?.pathTemplate) }
        : undefined,
    };
  });
  return {
    key: asString(raw.key || raw.modelKey),
    version: typeof raw.version === 'number' ? raw.version : undefined,
    schemaHash: asString(raw.schemaHash),
    origin: raw.origin === 'external' ? 'external' : raw.origin === 'native' ? 'native' : undefined,
    spaceId: typeof raw.spaceId === 'string' ? raw.spaceId : undefined,
    fieldsDynamic: asBoolean(raw.fieldsDynamic),
    display: { singular: asString(displayRaw.singular), plural: asString(displayRaw.plural) },
    description: typeof raw.description === 'string' ? raw.description : undefined,
    access: asArray(raw.access).filter(isDiscoveryAccess),
    fields: asArray(raw.fields).map(parseField),
    defaults: plainObject(raw.defaults) ?? {},
    actions,
    query: {
      filters: asArray(queryRaw.filters).map((entry) => {
        const filterRaw = plainObject(entry) ?? {};
        return {
          field: asString(filterRaw.field),
          parameter: asString(filterRaw.parameter),
          mode: filterRaw.mode === 'enum-set' ? 'enum-set' as const : undefined,
        };
      }),
      comparisons: asArray(queryRaw.comparisons).map((entry) => {
        const comparisonRaw = plainObject(entry) ?? {};
        return {
          field: asString(comparisonRaw.field),
          valueType: asString(comparisonRaw.valueType) as DiscoveryComparison['valueType'],
          operators: asArray(comparisonRaw.operators).map((operator) => {
            const operatorRaw = plainObject(operator) ?? {};
            return {
              operator: asString(operatorRaw.operator) as 'eq' | 'lt' | 'lte' | 'gt' | 'gte',
              transport: operatorRaw.transport === 'explicit' ? 'explicit' as const : 'legacy' as const,
              parameter: typeof operatorRaw.parameter === 'string' ? operatorRaw.parameter : undefined,
            };
          }),
          localDateWindow: plainObject(comparisonRaw.localDateWindow)
            ? {
                dateStartParameter: asString(plainObject(comparisonRaw.localDateWindow)?.dateStartParameter),
                dateEndExclusiveParameter: asString(plainObject(comparisonRaw.localDateWindow)?.dateEndExclusiveParameter),
                timezoneParameter: asString(plainObject(comparisonRaw.localDateWindow)?.timezoneParameter),
              }
            : undefined,
        };
      }),
      sorts: asArray(queryRaw.sorts).map((entry) => {
        const sortRaw = plainObject(entry) ?? {};
        return {
          field: asString(sortRaw.field),
          parameter: asString(sortRaw.parameter),
          directions: asArray(sortRaw.directions).filter((direction): direction is string => typeof direction === 'string'),
        };
      }),
      capabilityQueries: asArray(queryRaw.capabilityQueries).map((entry) => {
        const queryEntry = plainObject(entry) ?? {};
        const inputRaw = plainObject(queryEntry.input) ?? {};
        return {
          key: asString(queryEntry.key),
          input: {
            parameters: asArray(inputRaw.parameters).map((parameter) => {
              const parameterRaw = plainObject(parameter) ?? {};
              return {
                parameter: asString(parameterRaw.parameter),
                type: asString(parameterRaw.type) as DiscoveryCapabilityQueryParameter['type'],
                required: asBoolean(parameterRaw.required),
                role: typeof parameterRaw.role === 'string' ? parameterRaw.role : undefined,
              };
            }),
          },
          sorts: asArray(queryEntry.sorts).map((sort) => {
            const sortRaw = plainObject(sort) ?? {};
            return { field: asString(sortRaw.field), parameter: asString(sortRaw.parameter) };
          }),
        };
      }),
      canonical: plainObject(queryRaw.canonical) as DiscoveryCanonicalQuery | undefined,
    },
    capabilities: asArray(raw.capabilities).filter((entry): entry is string => typeof entry === 'string'),
    capabilityBindings: plainObject(raw.capabilityBindings) as DiscoveryCapabilityBindings | undefined,
    runtimeCapabilities: parseRuntimeCapabilities(raw.runtimeCapabilities),
    contract: plainObject(raw.contract)
      ? {
          kind: plainObject(raw.contract)?.kind === 'dynamic' ? 'dynamic' : 'native',
          revision: typeof plainObject(raw.contract)?.revision === 'string' ? asString(plainObject(raw.contract)?.revision) : null,
        }
      : undefined,
  };
}

function parseRuntimeDiscovery(value: unknown): RuntimeDiscovery | null {
  const envelope = plainObject(value);
  const data = plainObject(envelope?.data);
  if (!data || !Array.isArray(data.models) || !Array.isArray(data.spaces)) return null;
  return {
    data: {
      models: data.models.flatMap((entry) => {
        const parsed = parseDiscoveryModel(entry);
        return parsed ? [parsed] : [];
      }),
      spaces: data.spaces.flatMap((entry) => {
        const spaceRaw = plainObject(entry);
        if (!spaceRaw) return [];
        return [{
          spaceId: asString(spaceRaw.spaceId),
          spaceName: typeof spaceRaw.spaceName === 'string' ? spaceRaw.spaceName : undefined,
          models: asArray(spaceRaw.models).map((modelEntry) => {
            const modelRaw = plainObject(modelEntry) ?? {};
            return { modelKey: asString(modelRaw.modelKey), access: asArray(modelRaw.access).filter(isDiscoveryAccess) };
          }),
        }];
      }),
    },
  };
}

function parseInventory(value: unknown): {
  semanticDetailPathTemplate: string;
  models: DiscoveryModel[];
  spaces: DiscoverySpace[];
} | null {
  const envelope = plainObject(value);
  const data = plainObject(envelope?.data);
  if (!data || !Array.isArray(data.models) || !Array.isArray(data.spaces)) return null;
  return {
    semanticDetailPathTemplate: asString(data.semanticDetailPathTemplate),
    models: data.models.flatMap((entry) => {
      const parsed = parseDiscoveryModel(entry);
      return parsed ? [parsed] : [];
    }),
    spaces: data.spaces.flatMap((entry) => {
      const spaceRaw = plainObject(entry);
      if (!spaceRaw) return [];
      return [{
        spaceId: asString(spaceRaw.spaceId),
        spaceName: typeof spaceRaw.spaceName === 'string' ? spaceRaw.spaceName : undefined,
        models: asArray(spaceRaw.models).map((modelEntry) => {
          const modelRaw = plainObject(modelEntry) ?? {};
          return { modelKey: asString(modelRaw.modelKey), access: asArray(modelRaw.access).filter(isDiscoveryAccess) };
        }),
      }];
    }),
  };
}

export function normalizeBaseUrl(baseUrl: unknown): string {
  const value = String(baseUrl ?? '').trim().replace(/\/+$/u, '');
  return value.endsWith('/api/v1') ? value : `${value}/api/v1`;
}

async function credentialBaseUrl(context: LoadContext): Promise<string> {
  const credentialName = 'lifeSpaceApi';
  const credentials = await context.getCredentials(credentialName);
  return normalizeBaseUrl(credentials.baseUrl);
}

type LoadContext = ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions;

async function lifeSpaceGet(context: LoadContext, url: string): Promise<unknown> {
  try {
    return await context.helpers.httpRequestWithAuthentication.call(context, 'lifeSpaceApi', {
      method: 'GET',
      url,
      json: true,
    });
  } catch (error) {
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }
}

async function semanticDetail(
  context: LoadContext,
  baseUrl: string,
  pathTemplate: string,
  spaceId: string,
  modelKey: string,
): Promise<DiscoveryModel | null> {
  const path = pathTemplate
    .replace('{spaceId}', encodeURIComponent(spaceId))
    .replace('{modelKey}', encodeURIComponent(modelKey));
  const response = await lifeSpaceGet(context, `${baseUrl}${path.replace(/^\/api\/v1/u, '')}`);
  const envelope = plainObject(response);
  return parseDiscoveryModel(envelope?.data ?? response);
}

export async function loadRuntimeDiscovery(this: LoadContext): Promise<RuntimeDiscovery> {
  const baseUrl = await credentialBaseUrl(this);
  try {
    const inventoryRaw = await lifeSpaceGet(this, `${baseUrl}/me/_discovery/inventory`);
    const inventory = parseInventory(inventoryRaw);
    if (!inventory) throw new Error('invalid inventory');
    const externalDetails = await Promise.all(inventory.models
      .filter((identity) => identity.origin === 'external' && identity.spaceId)
      .map(async (identity) => ({
        identity,
        detail: await semanticDetail(this, baseUrl, inventory.semanticDetailPathTemplate, identity.spaceId!, identity.key),
      })));
    const externalByKey = new Map(externalDetails
      .filter((entry) => entry.detail)
      .map((entry) => [`${entry.identity.spaceId}:${entry.identity.key}`, entry.detail!]));
    const nativeModels = inventory.models.filter((identity) => identity.origin !== 'external');
    return {
      data: {
        models: [
          ...nativeModels,
          ...[...externalByKey.values()],
        ],
        spaces: inventory.spaces,
      },
    };
  } catch {
    const fallback = parseRuntimeDiscovery(await lifeSpaceGet(this, `${baseUrl}/me/_discovery`));
    if (!fallback) throw new NodeOperationError(this.getNode(), 'LifeSpace discovery returned an invalid response');
    return fallback;
  }
}

export function discoverySpace(discovery: RuntimeDiscovery, spaceId: string): DiscoverySpace | undefined {
  return discovery.data.spaces.find((space) => space.spaceId === spaceId);
}

export function discoveryModel(discovery: RuntimeDiscovery, spaceId: string, modelKey: string): DiscoveryModel | undefined {
  return discovery.data.models.find((model) => model.key === modelKey && (model.origin !== 'external' || model.spaceId === spaceId));
}

export function modelSupportsRuntimeOperation(model: DiscoveryModel, operation: string): boolean {
  if (model.origin !== 'external') return true;
  const capabilities = model.runtimeCapabilities;
  if (!capabilities) return false;
  if (operation === 'list') return capabilities.query;
  if (operation === 'get') return capabilities.get;
  if (operation === 'create') return capabilities.create;
  if (operation === 'update') return capabilities.update;
  if (operation === 'delete') return capabilities.delete;
  return false;
}

const RECORD_TYPE_SELECTOR_PREFIX = 'lsrt1.';

type RecordTypeSelector = {
  modelKey: string;
  origin: 'native' | 'external';
  spaceId?: string;
  schemaHash?: string;
  runtimeCapabilities?: DiscoveryRuntimeCapabilities;
};

export function encodeRecordTypeSelector(model: DiscoveryModel, spaceId: string): string {
  if (model.origin !== 'external') return model.key;
  const payload: RecordTypeSelector = {
    modelKey: model.key,
    origin: 'external',
    spaceId,
    schemaHash: model.schemaHash,
    runtimeCapabilities: model.runtimeCapabilities,
  };
  return `${RECORD_TYPE_SELECTOR_PREFIX}${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

export function decodeRecordTypeSelector(value: unknown): RecordTypeSelector | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!raw.startsWith(RECORD_TYPE_SELECTOR_PREFIX)) return { modelKey: raw, origin: 'native' };
  try {
    const payload = JSON.parse(Buffer.from(raw.slice(RECORD_TYPE_SELECTOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
    const object = plainObject(payload);
    const modelKey = asString(object?.modelKey);
    if (!modelKey || (object?.origin !== 'native' && object?.origin !== 'external')) return null;
    return {
      modelKey,
      origin: object.origin,
      spaceId: typeof object.spaceId === 'string' ? object.spaceId : undefined,
      schemaHash: typeof object.schemaHash === 'string' ? object.schemaHash : undefined,
      runtimeCapabilities: parseRuntimeCapabilities(object.runtimeCapabilities),
    };
  } catch {
    return null;
  }
}

export function loadOptionParameter(context: ILoadOptionsFunctions, name: string): string {
  const value = context.getCurrentNodeParameter(name);
  return typeof value === 'string' ? value : String(value ?? '');
}

export async function loadRelationTargets(
  context: ILoadOptionsFunctions,
  spaceId: string,
  modelKey: string,
  fieldKey: string,
  search: string,
): Promise<RelationTarget[]> {
  const baseUrl = await credentialBaseUrl(context);
  const qs = new URLSearchParams();
  qs.set('field', fieldKey);
  qs.set('limit', '50');
  if (search) qs.set('search', search);
  try {
    const response = await lifeSpaceGet(
      context,
      `${baseUrl}/spaces/${encodeURIComponent(spaceId)}/models/${encodeURIComponent(modelKey)}/relation-targets?${qs.toString()}`,
    );
    const envelope = plainObject(response);
    const data = plainObject(envelope?.data);
    return asArray(data?.items).flatMap((entry) => {
      const item = plainObject(entry);
      const id = asString(item?.id);
      const label = asString(item?.label) || id;
      return id ? [{ value: id, label }] : [];
    });
  } catch {
    return [];
  }
}
