import type {
  IExecuteFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  ISupplyDataFunctions,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export type DiscoveryAccess = 'read' | 'write' | 'manage';

export type CanonicalFieldType =
  | 'string'
  | 'text'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'instant'
  | 'datetime'
  | 'range<date>'
  | 'range<instant>'
  | 'temporal_range'
  | 'recurrence_rule'
  | 'entity_ref'
  | 'timezone'
  | 'enum'
  | 'person'
  | 'person_list'
  | 'record'
  | 'record_list';

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
  type: CanonicalFieldType;
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

export type DiscoveryComparisonOperator = {
  operator: string;
  transport: 'explicit' | 'implicit';
  parameter?: string;
};

export type DiscoveryComparison = {
  field: string;
  valueType: CanonicalFieldType | 'date-range' | 'instant-range' | 'temporal-range';
  operators: DiscoveryComparisonOperator[];
  localDateWindow?: {
    dateStartParameter: string;
    dateEndExclusiveParameter: string;
    timezoneParameter: string;
  };
};

export type DiscoveryCapabilityQueryParameter = {
  parameter: string;
  type: CanonicalFieldType | 'date-range' | 'instant-range' | 'temporal-range';
  role?: string;
  required?: boolean;
};

export type DiscoveryCanonicalFilterTarget = {
  field: string;
  kind: 'envelope' | 'field' | 'time-range' | 'calendar-range';
  valueType: CanonicalFieldType | 'date-range' | 'instant-range' | 'temporal-range';
  operators: string[];
  nullable: boolean;
};

export type DiscoveryCanonicalQuery = {
  invocation: { method: 'POST'; pathTemplate: string };
  composition: {
    selectionFacets: string[];
    selectionCombine: string;
    ordering: string;
    pagination: string;
  };
  search: null | { maxLength?: number };
  filter: {
    maxDepth: number;
    maxNodes: number;
    targets: DiscoveryCanonicalFilterTarget[];
  };
  sort: {
    fields: string[];
    directions: string[];
    maxCriteria: number;
    default: unknown[];
    nullPlacement: string;
    stableTieBreaker: string;
    temporalRange: unknown;
  };
  pagination: {
    limit: { minimum: number; maximum: number; default: number };
    cursor: { opaque: boolean; binds: string[]; snapshotConsistency: boolean };
  };
};

export type DiscoveryModel = {
  key: string;
  modelKey?: string;
  version?: number;
  schemaHash: string;
  origin?: 'native' | 'external';
  spaceId?: string;
  display: { singular: string; plural: string };
  description?: string;
  access?: DiscoveryAccess[];
  fields: DiscoveryField[];
  defaults?: Record<string, unknown>;
  actions: DiscoveryAction[];
  capabilities: string[];
  capabilityBindings?: DiscoveryCapabilityBindings;
  runtimeCapabilities?: DiscoveryRuntimeCapabilities;
  query: {
    canonical?: DiscoveryCanonicalQuery | null;
    filters?: Array<{
      field: string;
      parameter: string;
      mode: 'scalar' | 'enum-set';
    }>;
    comparisons?: DiscoveryComparison[];
    sorts?: Array<{ field: string; parameter: string }>;
    capabilityQueries?: Array<{
      key: string;
      parameters: DiscoveryCapabilityQueryParameter[];
    }>;
  };
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
    semanticDetailPathTemplate?: string;
    models: DiscoveryModel[];
    spaces: DiscoverySpace[];
  };
};

export type RelationTarget = {
  id: string;
  label: string;
};

type LoadContext = ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function canonicalFieldType(value: unknown): CanonicalFieldType {
  const type = asString(value) as CanonicalFieldType;
  const allowed: readonly CanonicalFieldType[] = [
    'string', 'text', 'integer', 'number', 'boolean', 'date', 'instant', 'datetime',
    'range<date>', 'range<instant>', 'temporal_range', 'recurrence_rule', 'entity_ref',
    'timezone', 'enum', 'person', 'person_list', 'record', 'record_list',
  ];
  if (!allowed.includes(type)) throw new Error(`Unsupported LifeSpace canonical field type: ${asString(value) || '(missing)'}`);
  return type;
}

function relationLookup(value: unknown): DiscoveryRelationLookup {
  const object = asObject(value);
  if (object?.supported === true) {
    return {
      supported: true,
      method: 'GET',
      pathTemplate: asString(object.pathTemplate),
      searchParameter: asString(object.searchParameter),
      cursorParameter: asString(object.cursorParameter),
      limitParameter: asString(object.limitParameter),
    };
  }
  return { supported: false, reason: asString(object?.reason) };
}

function relationResolution(value: unknown): DiscoveryRelationResolution | undefined {
  if (value === undefined) return undefined;
  const object = asObject(value);
  if (object?.supported === true) {
    return {
      supported: true,
      method: 'POST',
      pathTemplate: asString(object.pathTemplate),
      maxIds: Number(object.maxIds ?? 0),
    };
  }
  return { supported: false, reason: asString(object?.reason) };
}

function field(value: unknown): DiscoveryField {
  const object = asObject(value) ?? {};
  const relationObject = asObject(object.relation);
  return {
    key: asString(object.key),
    type: canonicalFieldType(object.type),
    ...(typeof object.title === 'string' ? { title: object.title } : {}),
    ...(typeof object.description === 'string' ? { description: object.description } : {}),
    ...(typeof object.required === 'boolean' ? { required: object.required } : {}),
    ...(typeof object.nullable === 'boolean' ? { nullable: object.nullable } : {}),
    ...(typeof object.immutable === 'boolean' ? { immutable: object.immutable } : {}),
    ...(typeof object.readOnly === 'boolean' ? { readOnly: object.readOnly } : {}),
    ...(typeof object.minLength === 'number' ? { minLength: object.minLength } : {}),
    ...(typeof object.maxLength === 'number' ? { maxLength: object.maxLength } : {}),
    ...(typeof object.minimum === 'number' ? { minimum: object.minimum } : {}),
    ...(typeof object.maximum === 'number' ? { maximum: object.maximum } : {}),
    ...(Array.isArray(object.values) ? { values: object.values.filter((entry): entry is string => typeof entry === 'string') } : {}),
    ...(typeof object.targetModel === 'string' ? { targetModel: object.targetModel } : {}),
    ...(relationObject ? {
      relation: {
        targetModel: asString(relationObject.targetModel),
        cardinality: relationObject.cardinality === 'many' ? 'many' : 'one',
        lookup: relationLookup(relationObject.lookup),
        ...(relationResolution(relationObject.resolution) ? { resolution: relationResolution(relationObject.resolution) } : {}),
      },
    } : {}),
  };
}

function runtimeCapabilities(value: unknown): DiscoveryRuntimeCapabilities | undefined {
  const object = asObject(value);
  if (!object) return undefined;
  return {
    get: asBoolean(object.get),
    query: asBoolean(object.query),
    create: asBoolean(object.create),
    update: asBoolean(object.update),
    delete: asBoolean(object.delete),
    batchWrite: asBoolean(object.batchWrite),
    atomicBatch: asBoolean(object.atomicBatch),
    transaction: asBoolean(object.transaction),
    versionedWrite: asBoolean(object.versionedWrite),
    actions: asBoolean(object.actions),
    relationTargetResolution: asBoolean(object.relationTargetResolution),
  };
}

function model(value: unknown): DiscoveryModel {
  const object = asObject(value) ?? {};
  const display = asObject(object.display) ?? {};
  const query = asObject(object.query) ?? {};
  const canonical = asObject(query.canonical);
  const parsedCanonical = canonical ? {
    invocation: {
      method: 'POST' as const,
      pathTemplate: asString(asObject(canonical.invocation)?.pathTemplate),
    },
    composition: {
      selectionFacets: asArray(asObject(canonical.composition)?.selectionFacets).filter((entry): entry is string => typeof entry === 'string'),
      selectionCombine: asString(asObject(canonical.composition)?.selectionCombine),
      ordering: asString(asObject(canonical.composition)?.ordering),
      pagination: asString(asObject(canonical.composition)?.pagination),
    },
    search: canonical.search === null ? null : { ...asObject(canonical.search) },
    filter: {
      maxDepth: Number(asObject(canonical.filter)?.maxDepth ?? 0),
      maxNodes: Number(asObject(canonical.filter)?.maxNodes ?? 0),
      targets: asArray(asObject(canonical.filter)?.targets).map((entry) => {
        const target = asObject(entry) ?? {};
        return {
          field: asString(target.field),
          kind: asString(target.kind) as DiscoveryCanonicalFilterTarget['kind'],
          valueType: (['date-range', 'instant-range', 'temporal-range'] as const).includes(asString(target.valueType) as 'date-range' | 'instant-range' | 'temporal-range')
            ? asString(target.valueType) as 'date-range' | 'instant-range' | 'temporal-range'
            : canonicalFieldType(target.valueType),
          operators: asArray(target.operators).filter((op): op is string => typeof op === 'string'),
          nullable: asBoolean(target.nullable),
        };
      }),
    },
    sort: {
      fields: asArray(asObject(canonical.sort)?.fields).filter((entry): entry is string => typeof entry === 'string'),
      directions: asArray(asObject(canonical.sort)?.directions).filter((entry): entry is string => typeof entry === 'string'),
      maxCriteria: Number(asObject(canonical.sort)?.maxCriteria ?? 0),
      default: asArray(asObject(canonical.sort)?.default),
      nullPlacement: asString(asObject(canonical.sort)?.nullPlacement),
      stableTieBreaker: asString(asObject(canonical.sort)?.stableTieBreaker),
      temporalRange: asObject(canonical.sort)?.temporalRange ?? null,
    },
    pagination: {
      limit: {
        minimum: Number(asObject(asObject(canonical.pagination)?.limit)?.minimum ?? 1),
        maximum: Number(asObject(asObject(canonical.pagination)?.limit)?.maximum ?? 100),
        default: Number(asObject(asObject(canonical.pagination)?.limit)?.default ?? 100),
      },
      cursor: {
        opaque: asBoolean(asObject(asObject(canonical.pagination)?.cursor)?.opaque),
        binds: asArray(asObject(asObject(canonical.pagination)?.cursor)?.binds).filter((entry): entry is string => typeof entry === 'string'),
        snapshotConsistency: asBoolean(asObject(asObject(canonical.pagination)?.cursor)?.snapshotConsistency),
      },
    },
  } satisfies DiscoveryCanonicalQuery : undefined;

  return {
    key: asString(object.key || object.modelKey),
    ...(typeof object.modelKey === 'string' ? { modelKey: object.modelKey } : {}),
    ...(typeof object.version === 'number' ? { version: object.version } : {}),
    schemaHash: asString(object.schemaHash),
    ...(object.origin === 'external' ? { origin: 'external' as const } : object.origin === 'native' ? { origin: 'native' as const } : {}),
    ...(typeof object.spaceId === 'string' ? { spaceId: object.spaceId } : {}),
    display: { singular: asString(display.singular), plural: asString(display.plural) },
    ...(typeof object.description === 'string' ? { description: object.description } : {}),
    ...(Array.isArray(object.access) ? { access: object.access.filter((entry): entry is DiscoveryAccess => ['read', 'write', 'manage'].includes(String(entry))) } : {}),
    fields: asArray(object.fields).map(field),
    ...(asObject(object.defaults) ? { defaults: asObject(object.defaults) as Record<string, unknown> } : {}),
    actions: asArray(object.actions).map((entry) => {
      const action = asObject(entry) ?? {};
      const input = asObject(action.input) ?? {};
      return {
        key: asString(action.key),
        access: asString(action.access) as DiscoveryAccess,
        kind: action.kind === 'capability' ? 'capability' : 'workflow',
        input: { fields: asArray(input.fields).map(field) },
        ...(asObject(action.invocation) ? {
          invocation: { method: 'POST' as const, pathTemplate: asString(asObject(action.invocation)?.pathTemplate) },
        } : {}),
      };
    }),
    capabilities: asArray(object.capabilities).filter((entry): entry is string => typeof entry === 'string'),
    runtimeCapabilities: runtimeCapabilities(object.runtimeCapabilities),
    query: {
      ...(parsedCanonical ? { canonical: parsedCanonical } : {}),
      filters: asArray(query.filters).map((entry) => {
        const filter = asObject(entry) ?? {};
        return { field: asString(filter.field), parameter: asString(filter.parameter), mode: filter.mode === 'enum-set' ? 'enum-set' as const : 'scalar' as const };
      }),
      comparisons: asArray(query.comparisons).map((entry) => {
        const comparison = asObject(entry) ?? {};
        const valueType = (['date-range', 'instant-range', 'temporal-range'] as const).includes(asString(comparison.valueType) as 'date-range' | 'instant-range' | 'temporal-range')
          ? asString(comparison.valueType) as 'date-range' | 'instant-range' | 'temporal-range'
          : canonicalFieldType(comparison.valueType);
        return {
          field: asString(comparison.field),
          valueType,
          operators: asArray(comparison.operators).map((operator) => {
            const value = asObject(operator) ?? {};
            return {
              operator: asString(value.operator),
              transport: value.transport === 'implicit' ? 'implicit' as const : 'explicit' as const,
              ...(typeof value.parameter === 'string' ? { parameter: value.parameter } : {}),
            };
          }),
          ...(asObject(comparison.localDateWindow) ? {
            localDateWindow: {
              dateStartParameter: asString(asObject(comparison.localDateWindow)?.dateStartParameter),
              dateEndExclusiveParameter: asString(asObject(comparison.localDateWindow)?.dateEndExclusiveParameter),
              timezoneParameter: asString(asObject(comparison.localDateWindow)?.timezoneParameter),
            },
          } : {}),
        };
      }),
      sorts: asArray(query.sorts).map((entry) => {
        const sort = asObject(entry) ?? {};
        return { field: asString(sort.field), parameter: asString(sort.parameter) };
      }),
      capabilityQueries: asArray(query.capabilityQueries).map((entry) => {
        const capability = asObject(entry) ?? {};
        return {
          key: asString(capability.key),
          parameters: asArray(capability.parameters).map((parameter) => {
            const value = asObject(parameter) ?? {};
            const type = (['date-range', 'instant-range', 'temporal-range'] as const).includes(asString(value.type) as 'date-range' | 'instant-range' | 'temporal-range')
              ? asString(value.type) as 'date-range' | 'instant-range' | 'temporal-range'
              : canonicalFieldType(value.type);
            return {
              parameter: asString(value.parameter),
              type,
              ...(typeof value.role === 'string' ? { role: value.role } : {}),
              ...(typeof value.required === 'boolean' ? { required: value.required } : {}),
            };
          }),
        };
      }),
    },
    ...(asObject(object.contract) ? {
      contract: {
        kind: asObject(object.contract)?.kind === 'dynamic' ? 'dynamic' : 'native',
        revision: typeof asObject(object.contract)?.revision === 'string' ? asString(asObject(object.contract)?.revision) : null,
      },
    } : {}),
  };
}

function inventoryToRuntimeDiscovery(raw: unknown): RuntimeDiscovery {
  const envelope = asObject(raw) ?? {};
  const data = asObject(envelope.data) ?? envelope;
  const models = asArray(data.models).map(model);
  const spaces = asArray(data.spaces).map((entry) => {
    const object = asObject(entry) ?? {};
    return {
      spaceId: asString(object.spaceId),
      ...(typeof object.spaceName === 'string' ? { spaceName: object.spaceName } : {}),
      models: asArray(object.models).map((spaceModel) => {
        const value = asObject(spaceModel) ?? {};
        return {
          modelKey: asString(value.modelKey),
          access: asArray(value.access).filter((entry): entry is DiscoveryAccess => ['read', 'write', 'manage'].includes(String(entry))),
        };
      }),
    };
  });
  return {
    data: {
      ...(typeof data.semanticDetailPathTemplate === 'string' ? { semanticDetailPathTemplate: data.semanticDetailPathTemplate } : {}),
      models,
      spaces,
    },
  };
}

function normalizeBaseUrlFromCredentials(credentials: IDataObject): string {
  const raw = typeof credentials.baseUrl === 'string' ? credentials.baseUrl.trim() : '';
  return normalizeBaseUrl(raw);
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, '');
}

async function request<T>(context: LoadContext, url: string, options: Omit<IHttpRequestOptions, 'url'>): Promise<T> {
  try {
    return await context.helpers.httpRequestWithAuthentication.call(context, 'lifeSpaceApi', { ...options, url }) as T;
  } catch (error) {
    if (error instanceof NodeApiError || error instanceof NodeOperationError) throw error;
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }
}

export async function loadRuntimeDiscovery(this: LoadContext): Promise<RuntimeDiscovery> {
  const credentials = await this.getCredentials('lifeSpaceApi');
  const baseUrl = normalizeBaseUrlFromCredentials(credentials);
  try {
    const inventory = await request<unknown>(this, `${baseUrl}/me/_discovery/inventory`, { method: 'GET' });
    const discovery = inventoryToRuntimeDiscovery(inventory);
    if (discovery.data.spaces.length || discovery.data.models.length) {
      const template = discovery.data.semanticDetailPathTemplate;
      if (!template) return discovery;
      const details = await Promise.all(discovery.data.models.map(async (identity) => {
        if (identity.origin !== 'external') return identity;
        const spaceId = identity.spaceId;
        if (!spaceId) return identity;
        const path = template.replace('{spaceId}', encodeURIComponent(spaceId)).replace('{modelKey}', encodeURIComponent(identity.key));
        const detail = await request<unknown>(this, `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`, { method: 'GET' });
        return model(asObject(detail)?.data ?? detail);
      }));
      discovery.data.models = details;
      return discovery;
    }
  } catch {
    // Fall back to full discovery for older compatible deployments.
  }

  const raw = await request<unknown>(this, `${baseUrl}/me/_discovery`, { method: 'GET' });
  const discovery = inventoryToRuntimeDiscovery(raw);
  if (!Array.isArray(discovery.data.spaces) || !Array.isArray(discovery.data.models)) {
    throw new NodeOperationError(this.getNode(), 'LifeSpace discovery returned an invalid response');
  }
  return discovery;
}

export function discoverySpace(discovery: RuntimeDiscovery, spaceId: string): DiscoverySpace | undefined {
  return discovery.data.spaces.find((space) => space.spaceId === spaceId);
}

export function discoveryModel(discovery: RuntimeDiscovery, spaceId: string, modelKey: string): DiscoveryModel | undefined {
  const external = discovery.data.models.find((entry) => entry.origin === 'external' && entry.spaceId === spaceId && entry.key === modelKey);
  if (external) return external;
  return discovery.data.models.find((entry) => entry.key === modelKey && entry.origin !== 'external');
}

export function modelSupportsRuntimeOperation(model: DiscoveryModel, operation: string): boolean {
  const capabilities = model.runtimeCapabilities;
  if (!capabilities) return true;
  const key = operation === 'list' ? 'query' : operation;
  if (key === 'get' || key === 'query' || key === 'create' || key === 'update' || key === 'delete') return capabilities[key];
  return true;
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
  const payload: RecordTypeSelector = model.origin === 'external'
    ? {
        modelKey: model.key,
        origin: 'external',
        spaceId,
        schemaHash: model.schemaHash,
        ...(model.runtimeCapabilities ? { runtimeCapabilities: model.runtimeCapabilities } : {}),
      }
    : { modelKey: model.key, origin: 'native' };
  return RECORD_TYPE_SELECTOR_PREFIX + Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeRecordTypeSelector(value: unknown): RecordTypeSelector | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!raw.startsWith(RECORD_TYPE_SELECTOR_PREFIX)) {
    return { modelKey: raw, origin: 'native' };
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw.slice(RECORD_TYPE_SELECTOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
    const object = asObject(parsed);
    const modelKey = asString(object?.modelKey).trim();
    const origin = object?.origin === 'external' ? 'external' : object?.origin === 'native' ? 'native' : '';
    if (!modelKey || !origin) return null;
    return {
      modelKey,
      origin,
      ...(typeof object?.spaceId === 'string' ? { spaceId: object.spaceId } : {}),
      ...(typeof object?.schemaHash === 'string' ? { schemaHash: object.schemaHash } : {}),
      ...(runtimeCapabilities(object?.runtimeCapabilities) ? { runtimeCapabilities: runtimeCapabilities(object?.runtimeCapabilities) } : {}),
    };
  } catch {
    return null;
  }
}

export function loadOptionParameter(context: ILoadOptionsFunctions, name: string): string {
  const value = context.getCurrentNodeParameter(name);
  return value === undefined || value === null ? '' : String(value);
}

export async function loadRelationTargets(
  context: ILoadOptionsFunctions,
  spaceId: string,
  modelKey: string,
  fieldKey: string,
  relation: DiscoveryRelation,
  search: string,
): Promise<RelationTarget[]> {
  if (!relation.lookup.supported) return [];
  const credentials = await context.getCredentials('lifeSpaceApi');
  const baseUrl = normalizeBaseUrlFromCredentials(credentials);
  const path = relation.lookup.pathTemplate
    .replace('{spaceId}', encodeURIComponent(spaceId))
    .replace('{modelKey}', encodeURIComponent(modelKey))
    .replace('{fieldKey}', encodeURIComponent(fieldKey));
  const query = new URLSearchParams();
  if (search) query.set(relation.lookup.searchParameter, search);
  query.set(relation.lookup.limitParameter, '50');
  const response = await request<unknown>(context, `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}?${query.toString()}`, { method: 'GET' });
  const envelope = asObject(response) ?? {};
  const data = asObject(envelope.data) ?? envelope;
  return asArray(data.items).flatMap((entry) => {
    const item = asObject(entry);
    const id = asString(item?.id);
    const label = asString(item?.label);
    return id ? [{ id, label: label || id }] : [];
  });
}
