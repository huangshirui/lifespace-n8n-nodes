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

export type DiscoveryDynamicContract = {
  kind: 'dynamic';
  revision: null;
};

export type DiscoveryComparisonOperator = 'eq' | 'lt' | 'lte' | 'gt' | 'gte';

export type DiscoveryComparisonTransport = {
  operator: DiscoveryComparisonOperator;
  parameter: string;
  transport: 'legacy' | 'explicit';
};

export type DiscoveryLocalDateWindow = {
  dateStartParameter: string;
  dateEndExclusiveParameter: string;
  timezoneParameter: string;
  bounds: '[)';
  lowerOperator: 'gte';
  upperOperator: 'lt';
};

export type DiscoveryComparison = {
  field: string;
  source: 'model' | 'envelope';
  valueType: 'date' | 'datetime' | 'integer' | 'number';
  operators: DiscoveryComparisonTransport[];
  localDateWindow?: DiscoveryLocalDateWindow;
};

export type DiscoveryCapabilityQueryParameter = {
  parameter: string;
  type: 'string' | 'boolean' | 'integer' | 'number' | 'date' | 'datetime' | 'timezone';
  required?: boolean;
  role?: string;
  default?: unknown;
};

export type DiscoveryCapabilityQuery = {
  key: string;
  capability: string;
  semantics: string;
  recurrenceExpansion?: boolean;
  parameters: DiscoveryCapabilityQueryParameter[];
  ordering?: {
    parameter: string;
    values: string[];
    default?: string;
    [key: string]: unknown;
  };
};

export type DiscoveryQueryFilter = {
  field: string;
  parameter: string;
  mode: 'exact' | 'enum-set';
  range?: { fromParameter: string; toParameter: string };
  acceptsCurrentActorPersonAlias?: 'me';
};

export type DiscoveryQuerySearch = {
  parameter: string;
  minLength: number;
  maxLength: number;
};

export type DiscoveryQueryPagination = {
  limit: { parameter: string; minimum: number; maximum: number; default: number };
  cursor: { parameter: string; type: 'string' };
};

export type DiscoveryCanonicalFilterTarget = {
  field: string;
  kind: 'envelope' | 'field' | 'time-range' | 'calendar-range';
  valueType: DiscoveryField['type'] | 'date-range' | 'instant-range' | 'temporal-range';
  operators: string[];
  nullable: boolean;
  acceptsCurrentActorPersonAlias?: 'me';
};

export type DiscoveryCanonicalQuery = {
  invocation: {
    method: 'POST';
    pathTemplate: string;
  };
  composition?: {
    selectionFacets: ['search', 'filter'];
    selectionCombine: 'intersection';
    ordering: 'sort';
    pagination: 'cursor-pagination';
  };
  pipeline?: Array<'search' | 'filter' | 'sort' | 'cursor-pagination'>;
  search: null | {
    fields: string[];
    minLength: number;
    maxLength: number;
  };
  filter: {
    maxDepth: number;
    maxNodes: number;
    targets: DiscoveryCanonicalFilterTarget[];
  };
  sort: {
    fields: string[];
    directions: Array<'asc' | 'desc'>;
    maxCriteria: number;
    default: Array<{ field: string; direction: 'asc' | 'desc' }>;
    nullPlacement: 'last' | 'provider-defined';
    stableTieBreaker: string;
    temporalRange?: null | {
      context: 'context.viewingTimezone';
      ordering: ['projectedStart', 'projectedEnd', 'record-id-asc'];
    };
  };
  pagination: {
    limit: { minimum: number; maximum: number; default: number };
    cursor: {
      opaque: true;
      binds: string[];
      snapshotConsistency: false;
    };
  };
};

export type DiscoveryModel = {
  key: string;
  version?: number;
  origin?: 'external';
  spaceId?: string;
  fieldsDynamic?: boolean;
  schemaHash: string;
  display: { singular: string; plural: string };
  description: string | null;
  access: DiscoveryAccess[];
  fields: DiscoveryField[];
  defaults: Record<string, unknown>;
  query: {
    searchable: string[];
    filterable: string[];
    sortable: string[];
    search: DiscoveryQuerySearch | null;
    filters: DiscoveryQueryFilter[];
    comparisons?: DiscoveryComparison[];
    capabilityQueries?: DiscoveryCapabilityQuery[];
    sort: {
      parameter: 'sort';
      syntax: 'field:direction';
      repeatable: true;
      ordered: true;
      maxCriteria: number;
      default: string[];
      envelopeFields: string[];
      nullPlacement: 'last' | 'provider-defined';
      genericValues: string[];
    };
    pagination: DiscoveryQueryPagination;
    canonical?: DiscoveryCanonicalQuery;
  };
  actions: DiscoveryAction[];
  capabilities?: string[];
  capabilityBindings?: DiscoveryCapabilityBindings;
  runtimeCapabilities?: DiscoveryRuntimeCapabilities;
  contract?: DiscoveryDynamicContract;
};

export type DiscoverySpace = {
  spaceId: string;
  spaceName?: string | null;
  models: DiscoveryModel[];
};

export type DiscoveryResponse = {
  data: {
    spaces: DiscoverySpace[];
  };
};

export type RelationTarget = {
  id: string;
  label: string;
};

type RelationTargetResponse = {
  data?: {
    items?: unknown;
    nextCursor?: unknown;
  };
};

type InventoryAction = {
  key: string;
  access: DiscoveryAccess;
  kind: 'workflow' | 'capability';
};

type PublishedInventoryModel = {
  key: string;
  version: number;
  schemaHash: string;
  display: { singular: string; plural: string };
  capabilities: string[];
  actions: InventoryAction[];
  origin?: 'external';
  fieldsDynamic?: boolean;
};

type ExternalRuntimeInventoryModel = {
  key: string;
  origin: 'external';
  spaceId: string;
  schemaHash: string;
  display: { singular: string; plural: string };
  runtimeCapabilities: DiscoveryRuntimeCapabilities;
  contract: DiscoveryDynamicContract;
};

type RuntimeInventoryModel = PublishedInventoryModel | ExternalRuntimeInventoryModel;

type InventorySpace = {
  spaceId: string;
  spaceName: string | null;
  models: Array<{
    modelKey: string;
    access: DiscoveryAccess[];
  }>;
};

type InventoryResponse = {
  data: {
    semanticDetailPathTemplate: string;
    models: RuntimeInventoryModel[];
    spaces: InventorySpace[];
  };
};

type SemanticRelation = {
  targetModel: string;
  cardinality: 'one' | 'many';
  lookup?: DiscoveryRelationLookup;
  resolution?: DiscoveryRelationResolution;
};

type SemanticField = Omit<DiscoveryField, 'relation'> & {
  relation?: SemanticRelation;
};

type NativeSemanticDetail = {
  key: string;
  origin?: never;
  version: number;
  schemaHash: string;
  display: { singular: string; plural: string };
  description: string | null;
  declaredAccess: DiscoveryAccess[];
  fields: SemanticField[];
  defaults: Record<string, unknown>;
  query: {
    searchable: string[];
    filterable: string[];
    sortable: string[];
    search: DiscoveryQuerySearch | null;
    filters: DiscoveryQueryFilter[];
    comparisons?: DiscoveryComparison[];
    capabilityQueries?: DiscoveryCapabilityQuery[];
    sort: {
      parameter: 'sort';
      syntax: 'field:direction';
      repeatable: true;
      ordered: true;
      maxCriteria: number;
      genericDefault: string[];
      envelopeFields: string[];
      nullPlacement: 'last' | 'provider-defined';
      genericValues: string[];
    };
    pagination: DiscoveryQueryPagination;
    canonical?: DiscoveryCanonicalQuery;
  };
  actions: DiscoveryAction[];
  capabilities: string[];
  capabilityBindings: DiscoveryCapabilityBindings;
};

type ExternalSemanticField = {
  key: string;
  title: string;
  type: DiscoveryField['type'];
  nullable: boolean;
  readable: true;
  writable: boolean;
  operators: string[];
  sortable: boolean;
  values?: string[];
};

type ExternalSemanticDetail = {
  key: string;
  modelKey?: string;
  origin: 'external';
  spaceId: string;
  schemaHash: string;
  display: { singular: string; plural: string };
  description?: string | null;
  access: DiscoveryAccess[];
  fields: ExternalSemanticField[];
  actions: DiscoveryAction[];
  capabilities: string[];
  capabilityBindings: DiscoveryCapabilityBindings;
  runtimeCapabilities: DiscoveryRuntimeCapabilities;
  contract: DiscoveryDynamicContract;
  query: { canonical: DiscoveryCanonicalQuery };
};

type RuntimeSemanticDetail = NativeSemanticDetail | ExternalSemanticDetail;

type SemanticDetailResponse = {
  data: RuntimeSemanticDetail;
};


type ConfigurationInventoryModel = PublishedInventoryModel & {
  access: DiscoveryAccess[];
};

type ConfigurationInventoryResponse = {
  data: {
    semanticDetailPathTemplate: string;
    models: ConfigurationInventoryModel[];
  };
};

type ConfigurationSemanticDetailResponse = {
  data: {
    access: DiscoveryAccess[];
    model: NativeSemanticDetail;
  };
};

export type DiscoveryTransport = {
  baseUrl: string;
  request: (options: IHttpRequestOptions) => Promise<unknown>;
};

type DiscoverySelection = {
  spaceId: string;
  modelKey: string;
};

const RELATION_TARGET_PAGE_SIZE = 100;
const RELATION_TARGET_OPTION_LIMIT = 1000;
const RELATION_TARGET_LOOKUP_PATH = '/api/v1/spaces/{spaceId}/_relation-targets/{modelKey}/{fieldKey}';
const MODEL_SEMANTIC_DETAIL_PATH = '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}';
const RECORD_TYPE_SELECTOR_PREFIX = 'lsrt1.';
const DYNAMIC_RECORD_TYPE_SELECTOR_PREFIX = 'lsrt2.';

export type RecordTypeSelector = {
  modelKey: string;
  origin?: 'external';
  spaceId?: string;
  schemaHash?: string;
  runtimeCapabilities?: DiscoveryRuntimeCapabilities;
};

export function encodeRecordTypeSelector(value: string | DiscoveryModel): string {
  if (typeof value === 'string') return value.trim();
  if (value.origin !== 'external' || !value.spaceId || !value.runtimeCapabilities) return value.key.trim();
  return DYNAMIC_RECORD_TYPE_SELECTOR_PREFIX
    + Buffer.from(JSON.stringify([
      value.key,
      value.spaceId,
      value.schemaHash,
      value.runtimeCapabilities,
    ]), 'utf8').toString('base64url');
}

export function decodeRecordTypeSelector(value: unknown): RecordTypeSelector | null {
  const raw = String(value ?? '').trim();
  if (/^[a-z][a-z0-9_]{1,62}$/u.test(raw)) return { modelKey: raw };
  if (raw.startsWith(DYNAMIC_RECORD_TYPE_SELECTOR_PREFIX)) {
    try {
      const decoded = JSON.parse(Buffer.from(raw.slice(DYNAMIC_RECORD_TYPE_SELECTOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
      if (!Array.isArray(decoded) || decoded.length !== 4) return null;
      const [modelKey, spaceId, schemaHash, runtimeCapabilities] = decoded;
      if (
        typeof modelKey !== 'string' || !/^[a-z][a-z0-9_]{1,62}$/u.test(modelKey)
        || typeof spaceId !== 'string' || !spaceId.startsWith('spc_')
        || typeof schemaHash !== 'string' || !schemaHash
        || !runtimeCapabilities || typeof runtimeCapabilities !== 'object' || Array.isArray(runtimeCapabilities)
      ) return null;
      return {
        modelKey,
        origin: 'external',
        spaceId,
        schemaHash,
        runtimeCapabilities: runtimeCapabilities as DiscoveryRuntimeCapabilities,
      };
    } catch {
      return null;
    }
  }
  if (!raw.startsWith(RECORD_TYPE_SELECTOR_PREFIX)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw.slice(RECORD_TYPE_SELECTOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'string' || typeof decoded[1] !== 'string'
      || !decoded[0].trim() || !decoded[1].trim()) return null;
    return { modelKey: decoded[0] };
  } catch {
    return null;
  }
}

export function modelSupportsRuntimeOperation(model: DiscoveryModel, operation: string): boolean {
  const capabilities = model.runtimeCapabilities;
  if (!capabilities) return true;
  if (operation === 'list' || operation === 'query') return capabilities.query;
  if (operation === 'get') return capabilities.get;
  if (operation === 'create') return capabilities.create;
  if (operation === 'update') return capabilities.update;
  if (operation === 'delete') return capabilities.delete;
  if (operation === 'executeAction' || operation === 'action') return capabilities.actions;
  if (operation === 'batchCreate') return capabilities.create && capabilities.batchWrite && capabilities.atomicBatch;
  return true;
}

export function normalizeBaseUrl(value: unknown): string {
  return String(value ?? '').replace(/\/$/, '');
}

function apiUrl(baseUrl: string, path: string): string {
  let normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (baseUrl.endsWith('/api/v1') && normalizedPath.startsWith('/api/v1/')) {
    normalizedPath = normalizedPath.slice('/api/v1'.length);
  }
  return `${baseUrl}${normalizedPath}`;
}

async function authenticatedGet<T>(
  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,
  baseUrl: string,
  path: string,
  transport?: DiscoveryTransport,
): Promise<T> {
  const options: IHttpRequestOptions = { method: 'GET', url: apiUrl(baseUrl, path), json: true };
  return transport
    ? await transport.request(options) as T
    : await context.helpers.httpRequestWithAuthentication.call(
      context,
      'lifeSpaceApi',
      options,
    ) as T;
}

async function requestFullRuntimeDiscovery(
  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,
  baseUrl: string,
  transport?: DiscoveryTransport,
): Promise<DiscoveryResponse> {
  try {
    const response = await authenticatedGet<{ data?: { spaces?: Array<{ spaceId: string; spaceName?: string | null; models?: unknown[] }> } }>(
      context,
      baseUrl,
      '/me/_discovery',
      transport,
    );
    if (!response?.data || !Array.isArray(response.data.spaces)) {
      throw new NodeOperationError(context.getNode(), 'LifeSpace Runtime Discovery returned an invalid response');
    }
    return {
      data: {
        spaces: response.data.spaces.map((space) => ({
          spaceId: space.spaceId,
          spaceName: space.spaceName,
          models: (space.models ?? []).map((model) => {
            if (model && typeof model === 'object' && !Array.isArray(model) && (model as { origin?: unknown }).origin === 'external') {
              const detail = model as ExternalSemanticDetail;
              return externalDetailedModel(detail, detail.access ?? []);
            }
            return model as DiscoveryModel;
          }),
        })),
      },
    };
  } catch (error) {
    if (error instanceof NodeOperationError) {
      throw new NodeOperationError(context.getNode(), error.message);
    }
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }
}

export function loadOptionParameter(context: ILoadOptionsFunctions, name: string): string {
  try {
    const current = context.getCurrentNodeParameter(name);
    if (current !== undefined) return String(current ?? '').trim();
  } catch {
    // Fall through for compatible contexts without an editor-current value.
  }
  try {
    return String(context.getNodeParameter(name, '') ?? '').trim();
  } catch {
    return '';
  }
}

function defaultLookup(): DiscoveryRelationLookup {
  return {
    supported: true,
    method: 'GET',
    pathTemplate: RELATION_TARGET_LOOKUP_PATH,
    searchParameter: 'q',
    cursorParameter: 'cursor',
    limitParameter: 'limit',
  };
}

function normalizedField(field: SemanticField): DiscoveryField {
  const { relation, ...baseField } = field;
  if (!relation) return baseField;
  return {
    ...baseField,
    relation: {
      targetModel: relation.targetModel,
      cardinality: relation.cardinality,
      lookup: relation.lookup ?? defaultLookup(),
      ...(relation.resolution ? { resolution: relation.resolution } : {}),
    },
  };
}

function emptyQuery(canonical?: DiscoveryCanonicalQuery): DiscoveryModel['query'] {
  const sortFields = canonical?.sort.fields ?? [];
  return {
    searchable: canonical?.search?.fields ?? [],
    filterable: canonical?.filter.targets.map((target) => target.field) ?? [],
    sortable: sortFields,
    search: null,
    filters: [],
    comparisons: [],
    capabilityQueries: [],
    sort: {
      parameter: 'sort',
      syntax: 'field:direction',
      repeatable: true,
      ordered: true,
      maxCriteria: canonical?.sort.maxCriteria ?? 8,
      default: (canonical?.sort.default ?? []).map((sort) => `${sort.field}:${sort.direction}`),
      envelopeFields: [],
      nullPlacement: canonical?.sort.nullPlacement ?? 'last',
      genericValues: sortFields.flatMap((field) => [`${field}:asc`, `${field}:desc`]),
    },
    pagination: {
      limit: {
        parameter: 'limit',
        minimum: canonical?.pagination.limit.minimum ?? 1,
        maximum: canonical?.pagination.limit.maximum ?? 200,
        default: canonical?.pagination.limit.default ?? 100,
      },
      cursor: { parameter: 'cursor', type: 'string' },
    },
    ...(canonical ? { canonical } : {}),
  };
}

function isExternalRuntimeInventoryModel(identity: RuntimeInventoryModel): identity is ExternalRuntimeInventoryModel {
  return identity.origin === 'external' && 'spaceId' in identity && 'runtimeCapabilities' in identity;
}

function stubModel(identity: PublishedInventoryModel, access: DiscoveryAccess[]): DiscoveryModel {
  return {
    key: identity.key,
    version: identity.version,
    ...(identity.origin === 'external' ? { origin: 'external' as const } : {}),
    ...(identity.fieldsDynamic === true ? { fieldsDynamic: true } : {}),
    schemaHash: identity.schemaHash,
    display: identity.display,
    description: null,
    access,
    fields: [],
    defaults: {},
    query: emptyQuery(),
    actions: identity.actions.map((action) => ({ ...action, input: { fields: [] } })),
    capabilities: [...identity.capabilities],
    capabilityBindings: {},
  };
}

function stubRuntimeModel(identity: RuntimeInventoryModel, access: DiscoveryAccess[]): DiscoveryModel {
  if (!isExternalRuntimeInventoryModel(identity)) return stubModel(identity, access);
  return {
    key: identity.key,
    origin: 'external',
    spaceId: identity.spaceId,
    schemaHash: identity.schemaHash,
    display: identity.display,
    description: null,
    access,
    fields: [],
    defaults: {},
    query: emptyQuery(),
    actions: [],
    capabilities: [],
    capabilityBindings: {},
    runtimeCapabilities: identity.runtimeCapabilities,
    contract: identity.contract,
  };
}

function detailedModel(detail: NativeSemanticDetail, access: DiscoveryAccess[]): DiscoveryModel {
  return {
    key: detail.key,
    version: detail.version,
    schemaHash: detail.schemaHash,
    display: detail.display,
    description: detail.description,
    access,
    fields: detail.fields.map(normalizedField),
    defaults: detail.defaults,
    query: {
      searchable: detail.query.searchable,
      filterable: detail.query.filterable,
      sortable: detail.query.sortable,
      search: detail.query.search,
      filters: detail.query.filters,
      comparisons: detail.query.comparisons ?? [],
      capabilityQueries: detail.query.capabilityQueries ?? [],
      sort: {
        parameter: detail.query.sort.parameter,
        syntax: detail.query.sort.syntax,
        repeatable: detail.query.sort.repeatable,
        ordered: detail.query.sort.ordered,
        maxCriteria: detail.query.sort.maxCriteria,
        default: detail.query.sort.genericDefault,
        envelopeFields: detail.query.sort.envelopeFields,
        nullPlacement: detail.query.sort.nullPlacement,
        genericValues: detail.query.sort.genericValues,
      },
      pagination: detail.query.pagination,
      canonical: detail.query.canonical,
    },
    actions: detail.actions,
    capabilities: detail.capabilities,
    capabilityBindings: detail.capabilityBindings,
  };
}

function externalDetailedModel(detail: ExternalSemanticDetail, access: DiscoveryAccess[]): DiscoveryModel {
  return {
    key: detail.key,
    origin: 'external',
    spaceId: detail.spaceId,
    schemaHash: detail.schemaHash,
    display: detail.display,
    description: detail.description ?? null,
    access,
    fields: detail.fields.map((field) => ({
      key: field.key,
      title: field.title,
      type: field.type,
      nullable: field.nullable,
      readOnly: !field.writable,
      values: field.values,
    })),
    defaults: {},
    query: emptyQuery(detail.query.canonical),
    actions: detail.actions ?? [],
    capabilities: detail.capabilities ?? [],
    capabilityBindings: detail.capabilityBindings ?? {},
    runtimeCapabilities: detail.runtimeCapabilities,
    contract: detail.contract,
  };
}

function runtimeDetailModel(detail: RuntimeSemanticDetail, access: DiscoveryAccess[]): DiscoveryModel {
  return detail.origin === 'external'
    ? externalDetailedModel(detail, access)
    : detailedModel(detail, access);
}

function runtimeInventoryIdentity(
  models: RuntimeInventoryModel[],
  spaceId: string,
  modelKey: string,
): RuntimeInventoryModel | undefined {
  return models.find((model) => model.key === modelKey
    && (!isExternalRuntimeInventoryModel(model) || model.spaceId === spaceId));
}

function runtimeDetailMatches(
  identity: RuntimeInventoryModel,
  detail: RuntimeSemanticDetail,
  spaceId: string,
): boolean {
  if (isExternalRuntimeInventoryModel(identity)) {
    return detail.origin === 'external'
      && detail.key === identity.key
      && detail.spaceId === spaceId
      && detail.schemaHash === identity.schemaHash;
  }
  return detail.origin !== 'external'
    && detail.key === identity.key
    && detail.version === identity.version
    && detail.schemaHash === identity.schemaHash;
}

function replacePathTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (path, [key, value]) => path.replace(`{${key}}`, encodeURIComponent(value)),
    template,
  );
}

export async function loadDesignTimeSemanticDetail(
  this: ILoadOptionsFunctions,
  spaceId: string,
  identity: Pick<DiscoveryModel, 'key' | 'version' | 'schemaHash' | 'access' | 'origin' | 'spaceId'>,
  transport?: DiscoveryTransport,
): Promise<DiscoveryModel> {
  const baseUrl = transport
    ? transport.baseUrl
    : normalizeBaseUrl((await this.getCredentials('lifeSpaceApi')).baseUrl);
  const path = replacePathTemplate(MODEL_SEMANTIC_DETAIL_PATH, {
    spaceId,
    modelKey: identity.key,
  });

  let response: SemanticDetailResponse;
  try {
    response = await authenticatedGet<SemanticDetailResponse>(this, baseUrl, path, transport);
  } catch (error) {
    throw new NodeApiError(this.getNode(), error as JsonObject);
  }

  const detail = response?.data;
  const matches = detail && (identity.origin === 'external'
    ? detail.origin === 'external'
      && detail.key === identity.key
      && detail.spaceId === spaceId
      && detail.schemaHash === identity.schemaHash
    : detail.origin !== 'external'
      && detail.key === identity.key
      && detail.version === identity.version
      && detail.schemaHash === identity.schemaHash);
  if (!detail || !matches) {
    throw new NodeOperationError(
      this.getNode(),
      `LifeSpace Runtime Discovery semantic detail identity drifted for ${identity.key}`,
    );
  }

  return runtimeDetailModel(detail, identity.access);
}

export async function loadConfigurationModelInventory(
  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,
  transport: DiscoveryTransport,
): Promise<DiscoveryModel[]> {
  let response: ConfigurationInventoryResponse;
  try {
    response = await authenticatedGet<ConfigurationInventoryResponse>(
      context,
      transport.baseUrl,
      '/me/_discovery/models',
      transport,
    );
  } catch (error) {
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }

  if (!response?.data || !Array.isArray(response.data.models)) {
    throw new NodeOperationError(
      context.getNode(),
      'LifeSpace configuration model discovery returned an invalid response',
    );
  }

  return response.data.models.map((identity) => stubModel(identity, identity.access));
}

export async function loadConfigurationModelSemanticDetail(
  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,
  modelKey: string,
  transport: DiscoveryTransport,
): Promise<DiscoveryModel> {
  let response: ConfigurationSemanticDetailResponse;
  try {
    response = await authenticatedGet<ConfigurationSemanticDetailResponse>(
      context,
      transport.baseUrl,
      `/me/_discovery/models/${encodeURIComponent(modelKey)}`,
      transport,
    );
  } catch (error) {
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }

  const detail = response?.data?.model;
  const access = response?.data?.access;
  if (
    !detail
    || detail.key !== modelKey
    || !Array.isArray(access)
    || access.some((value) => !['read', 'write', 'manage'].includes(value))
  ) {
    throw new NodeOperationError(
      context.getNode(),
      `LifeSpace configuration model discovery returned invalid semantic detail for ${modelKey}`,
    );
  }

  return detailedModel(detail, access);
}

async function requestProgressiveRuntimeDiscovery(
  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,
  baseUrl: string,
  selection?: DiscoverySelection,
  transport?: DiscoveryTransport,
): Promise<DiscoveryResponse | null> {
  let inventory: InventoryResponse;
  try {
    inventory = await authenticatedGet<InventoryResponse>(context, baseUrl, '/me/_discovery/inventory', transport);
  } catch {
    return null;
  }

  if (!inventory?.data || !Array.isArray(inventory.data.models) || !Array.isArray(inventory.data.spaces)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace Runtime Discovery inventory returned an invalid response');
  }

  const selectedSpaceId = selection?.spaceId ?? '';
  const selectedModelKey = selection?.modelKey ?? '';
  let selectedDetail: RuntimeSemanticDetail | null = null;
  let selectedIdentity: RuntimeInventoryModel | undefined;

  if (selectedSpaceId && selectedModelKey) {
    const selectedSpace = inventory.data.spaces.find((space) => space.spaceId === selectedSpaceId);
    selectedIdentity = runtimeInventoryIdentity(inventory.data.models, selectedSpaceId, selectedModelKey);
    const visible = selectedSpace && selectedIdentity
      && selectedSpace.models.some((edge) => edge.modelKey === selectedIdentity!.key);

    if (visible && selectedIdentity) {
      const path = replacePathTemplate(inventory.data.semanticDetailPathTemplate, {
        spaceId: selectedSpaceId,
        modelKey: selectedIdentity.key,
      });
      try {
        const response = await authenticatedGet<SemanticDetailResponse>(context, baseUrl, path, transport);
        const detail = response.data;
        if (!detail || !runtimeDetailMatches(selectedIdentity, detail, selectedSpaceId)) {
          throw new NodeOperationError(
            context.getNode(),
            `LifeSpace Runtime Discovery semantic detail identity drifted for ${selectedIdentity.key}`,
          );
        }
        selectedDetail = detail;
      } catch (error) {
        throw new NodeApiError(context.getNode(), error as JsonObject);
      }
    }
  }

  return {
    data: {
      spaces: inventory.data.spaces.map((space) => ({
        spaceId: space.spaceId,
        spaceName: space.spaceName,
        models: space.models.flatMap((edge) => {
          const identity = runtimeInventoryIdentity(inventory.data.models, space.spaceId, edge.modelKey);
          if (!identity) return [];
          return [selectedDetail && edge.modelKey === selectedModelKey && space.spaceId === selectedSpaceId
            ? runtimeDetailModel(selectedDetail, edge.access)
            : stubRuntimeModel(identity, edge.access)];
        }),
      })),
    },
  };
}

function relationTargetUrl(
  baseUrl: string,
  pathTemplate: string,
  spaceId: string,
  modelKey: string,
  fieldKey: string,
): string {
  return apiUrl(baseUrl, replacePathTemplate(pathTemplate, { spaceId, modelKey, fieldKey }));
}

function parseRelationTargets(
  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,
  response: RelationTargetResponse,
): { items: RelationTarget[]; nextCursor: string | null } {
  const rawItems = response.data?.items;
  if (!Array.isArray(rawItems)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace relation target lookup returned an invalid response');
  }

  const items: RelationTarget[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new NodeOperationError(context.getNode(), 'LifeSpace relation target lookup returned an invalid target');
    }
    const id = (item as { id?: unknown }).id;
    const label = (item as { label?: unknown }).label;
    if (typeof id !== 'string' || !id || typeof label !== 'string' || !label) {
      throw new NodeOperationError(context.getNode(), 'LifeSpace relation target lookup returned an invalid target');
    }
    items.push({ id, label });
  }

  const rawCursor = response.data?.nextCursor;
  return {
    items,
    nextCursor: typeof rawCursor === 'string' && rawCursor ? rawCursor : null,
  };
}

export async function loadRelationTargets(
  context: ILoadOptionsFunctions,
  spaceId: string,
  modelKey: string,
  field: DiscoveryField,
): Promise<RelationTarget[] | null> {
  const lookup = field.relation?.lookup;
  if (!lookup?.supported) return null;
  if (lookup.method !== 'GET' || !lookup.pathTemplate) {
    throw new NodeOperationError(context.getNode(), `LifeSpace relation lookup for ${field.key} uses an unsupported contract`);
  }

  const credentials = await context.getCredentials('lifeSpaceApi');
  const baseUrl = normalizeBaseUrl(credentials.baseUrl);
  const url = relationTargetUrl(baseUrl, lookup.pathTemplate, spaceId, modelKey, field.key);
  const targets: RelationTarget[] = [];
  let cursor: string | null = null;

  do {
    const qs: Record<string, string | number> = {
      [lookup.limitParameter]: RELATION_TARGET_PAGE_SIZE,
    };
    if (cursor) qs[lookup.cursorParameter] = cursor;

    let response: RelationTargetResponse;
    try {
      response = await context.helpers.httpRequestWithAuthentication.call(
        context,
        'lifeSpaceApi',
        { method: 'GET', url, qs, json: true },
      ) as RelationTargetResponse;
    } catch (error) {
      throw new NodeApiError(context.getNode(), error as JsonObject);
    }

    const page = parseRelationTargets(context, response);
    targets.push(...page.items);
    cursor = page.nextCursor;

    if (cursor && targets.length >= RELATION_TARGET_OPTION_LIMIT) {
      throw new NodeOperationError(
        context.getNode(),
        `LifeSpace relation field ${field.title?.trim() || humanizeKey(field.key)} has more than ${RELATION_TARGET_OPTION_LIMIT} selectable targets. Use an expression with stable IDs until searchable Resource Mapper relation options are supported by n8n.`,
      );
    }
  } while (cursor);

  return targets;
}

export type AgentRelationRequester = (options: IHttpRequestOptions) => Promise<unknown>;

export async function searchRelationTargetsForAgent(
  context: IExecuteFunctions | ISupplyDataFunctions,
  baseUrl: string,
  spaceId: string,
  modelKey: string,
  field: DiscoveryField,
  query: string,
  requester?: AgentRelationRequester,
): Promise<RelationTarget[]> {
  const lookup = field.relation?.lookup;
  if (!lookup?.supported) {
    throw new NodeOperationError(
      context.getNode(),
      `LifeSpace relation field ${field.title?.trim() || humanizeKey(field.key)} does not support name lookup`,
    );
  }
  if (lookup.method !== 'GET' || !lookup.pathTemplate) {
    throw new NodeOperationError(context.getNode(), `LifeSpace relation lookup for ${field.key} uses an unsupported contract`);
  }

  const url = relationTargetUrl(baseUrl, lookup.pathTemplate, spaceId, modelKey, field.key);
  const qs: Record<string, string | number> = {
    [lookup.searchParameter]: query,
    [lookup.limitParameter]: RELATION_TARGET_PAGE_SIZE,
  };
  let response: RelationTargetResponse;
  try {
    const options: IHttpRequestOptions = { method: 'GET', url, qs, json: true };
    response = requester
      ? await requester(options) as RelationTargetResponse
      : await context.helpers.httpRequestWithAuthentication.call(
        context,
        'lifeSpaceApi',
        options,
      ) as RelationTargetResponse;
  } catch (error) {
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }
  return parseRelationTargets(context, response).items;
}

export async function loadRuntimeDiscoveryInventory(
  this: ILoadOptionsFunctions,
  transport?: DiscoveryTransport,
): Promise<DiscoveryResponse> {
  const baseUrl = transport
    ? transport.baseUrl
    : normalizeBaseUrl((await this.getCredentials('lifeSpaceApi')).baseUrl);
  const progressive = await requestProgressiveRuntimeDiscovery(this, baseUrl, undefined, transport);
  return progressive ?? requestFullRuntimeDiscovery(this, baseUrl, transport);
}

export async function loadSpaceRuntimeModel(
  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,
  spaceId: string,
  modelKey: string,
  transport: DiscoveryTransport,
): Promise<DiscoveryModel | null> {
  const progressive = await requestProgressiveRuntimeDiscovery(
    context,
    transport.baseUrl,
    { spaceId, modelKey },
    transport,
  );
  const discovery = progressive ?? await requestFullRuntimeDiscovery(context, transport.baseUrl, transport);
  return discoveryModel(discovery, spaceId, modelKey) ?? null;
}

export async function loadRuntimeDiscovery(
  this: ILoadOptionsFunctions,
  transport?: DiscoveryTransport,
): Promise<DiscoveryResponse> {
  const baseUrl = transport
    ? transport.baseUrl
    : normalizeBaseUrl((await this.getCredentials('lifeSpaceApi')).baseUrl);
  const recordType = loadOptionParameter(this, 'recordType');
  const decodedRecordType = recordType ? decodeRecordTypeSelector(recordType) : null;
  if (recordType && !decodedRecordType) {
    throw new NodeOperationError(this.getNode(), 'LifeSpace Record Type selector is invalid. Choose a Record Type from Discovery or pass a Trigger recordType value.');
  }
  const legacyModelRoute = recordType ? '' : loadOptionParameter(this, 'modelRoute');
  if (legacyModelRoute) return requestFullRuntimeDiscovery(this, baseUrl, transport);
  const selection = {
    spaceId: loadOptionParameter(this, 'spaceId'),
    modelKey: decodedRecordType?.modelKey ?? '',
  };
  const progressive = await requestProgressiveRuntimeDiscovery(this, baseUrl, selection, transport);
  return progressive ?? requestFullRuntimeDiscovery(this, baseUrl, transport);
}

export function discoverySpace(discovery: DiscoveryResponse, spaceId: string): DiscoverySpace | undefined {
  return discovery.data.spaces.find((space) => space.spaceId === spaceId);
}

export function discoveryModel(
  discovery: DiscoveryResponse,
  spaceId: string,
  modelKey: string,
): DiscoveryModel | undefined {
  return discoverySpace(discovery, spaceId)?.models.find((model) => model.key === modelKey);
}

export function humanizeKey(key: string): string {
  const withIds = key.replace(/Ids$/u, ' IDs').replace(/Id$/u, ' ID');
  const spaced = withIds
    .replace(/_/gu, ' ')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/\s+/gu, ' ')
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}
