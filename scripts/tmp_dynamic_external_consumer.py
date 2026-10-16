from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing replacement target: {label}')
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, repl: str, label: str) -> str:
    updated, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'expected one regex replacement for {label}, got {count}')
    return updated

# Restore the real Workflow node. The 0.2.5 compatibility wrapper hid External models and
# is deliberately removed: Generic Consumers must consume the dynamic LifeSpace contract.
pkg = Path('package.json')
s = pkg.read_text()
s = replace_once(
    s,
    'dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflowCompat.node.js',
    'dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js',
    'package workflow registration',
)
pkg.write_text(s)
for stale in [
    Path('nodes/LifeSpaceWorkflow/LifeSpaceWorkflowCompat.node.ts'),
    Path('nodes/shared/runtimeDiscoveryCompat.ts'),
]:
    if stale.exists():
        stale.unlink()

# ---- Runtime Discovery: represent Native and Space-local External contracts honestly. ----
p = Path('nodes/lifespaceDiscovery.ts')
s = p.read_text()
s = s.replace("nullPlacement: 'last';", "nullPlacement: 'last' | 'provider-defined';")

cap_anchor = """export type DiscoveryCapabilityBindings = {
  calendar?: DiscoveryCalendarCapabilityBinding;
  temporal?: DiscoveryTemporalCapabilityBinding;
};
"""
cap_insert = cap_anchor + """
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
"""
s = replace_once(s, cap_anchor, cap_insert, 'runtime capability types')

old_model_head = """export type DiscoveryModel = {
  key: string;
  version: number;
  schemaHash: string;
"""
new_model_head = """export type DiscoveryModel = {
  key: string;
  version?: number;
  origin?: 'external';
  spaceId?: string;
  fieldsDynamic?: boolean;
  schemaHash: string;
"""
s = replace_once(s, old_model_head, new_model_head, 'DiscoveryModel identity')
s = replace_once(
    s,
    """  capabilities?: string[];
  capabilityBindings?: DiscoveryCapabilityBindings;
};

export type DiscoverySpace""",
    """  capabilities?: string[];
  capabilityBindings?: DiscoveryCapabilityBindings;
  runtimeCapabilities?: DiscoveryRuntimeCapabilities;
  contract?: DiscoveryDynamicContract;
};

export type DiscoverySpace""",
    'DiscoveryModel dynamic metadata',
)

s = regex_once(
    s,
    r"type InventoryModel = \{.*?\n\};\n\ntype InventorySpace",
    """type PublishedInventoryModel = {
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

type InventorySpace""",
    'Runtime inventory model union',
)
s = replace_once(s, '    models: InventoryModel[];', '    models: RuntimeInventoryModel[];', 'inventory response models')

semantic_block = """type SemanticRelation = {
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
"""
s = regex_once(
    s,
    r"type SemanticRelation = \{.*?type SemanticDetailResponse = \{\n  data: SemanticDetail;\n\};",
    semantic_block,
    'semantic detail union',
)
s = s.replace('type ConfigurationInventoryModel = InventoryModel & {', 'type ConfigurationInventoryModel = PublishedInventoryModel & {')
s = s.replace('    model: SemanticDetail;', '    model: NativeSemanticDetail;')

selector_block = """const RECORD_TYPE_SELECTOR_PREFIX = 'lsrt1.';
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
"""
s = regex_once(
    s,
    r"const RECORD_TYPE_SELECTOR_PREFIX = 'lsrt1\.';.*?export function normalizeBaseUrl",
    selector_block + "\nexport function normalizeBaseUrl",
    'Record Type dynamic selector',
)

projection_block = """function emptyQuery(canonical?: DiscoveryCanonicalQuery): DiscoveryModel['query'] {
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
"""
s = regex_once(
    s,
    r"function stubModel\(identity: InventoryModel, access: DiscoveryAccess\[\]\): DiscoveryModel \{.*?\n\}\n\nfunction replacePathTemplate",
    projection_block + "\nfunction replacePathTemplate",
    'Native/External discovery projection',
)

load_detail = """export async function loadDesignTimeSemanticDetail(
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
"""
s = regex_once(
    s,
    r"export async function loadDesignTimeSemanticDetail\(.*?\n\}\n\nexport async function loadConfigurationModelInventory",
    load_detail + "\nexport async function loadConfigurationModelInventory",
    'loadDesignTimeSemanticDetail',
)

progressive = """async function requestProgressiveRuntimeDiscovery(
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
"""
s = regex_once(
    s,
    r"async function requestProgressiveRuntimeDiscovery\(.*?\n\}\n\nfunction relationTargetUrl",
    progressive + "\nfunction relationTargetUrl",
    'progressive Runtime Discovery',
)

# Full discovery fallback is still used for old kernels. Normalize External models if a current
# kernel temporarily cannot serve inventory, rather than reviving the Native-only assumption.
full_old = """async function requestFullRuntimeDiscovery(
  context: ILoadOptionsFunctions | IExecuteFunctions,
  baseUrl: string,
  transport?: DiscoveryTransport,
): Promise<DiscoveryResponse> {
  try {
    return await authenticatedGet<DiscoveryResponse>(context, baseUrl, '/me/_discovery', transport);
  } catch (error) {
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }
}
"""
full_new = """async function requestFullRuntimeDiscovery(
  context: ILoadOptionsFunctions | IExecuteFunctions,
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
    if (error instanceof NodeOperationError) throw error;
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }
}
"""
s = replace_once(s, full_old, full_new, 'full Runtime Discovery fallback')
p.write_text(s)

# ---- Ordinary Workflow: use dynamic capability snapshot, no origin-specific UI. ----
p = Path('nodes/LifeSpace/LifeSpace.node.ts')
s = p.read_text()
s = replace_once(s, "  decodeRecordTypeSelector,\n", "  decodeRecordTypeSelector,\n  encodeRecordTypeSelector,\n", 'LifeSpace encode selector import')
s = replace_once(s, "  loadRuntimeDiscovery,\n", "  loadRuntimeDiscovery,\n  modelSupportsRuntimeOperation,\n", 'LifeSpace runtime capability import')
s = replace_once(s, "  type DiscoveryModel,\n", "  type DiscoveryModel,\n  type DiscoveryRuntimeCapabilities,\n", 'LifeSpace runtime capability type import')

s = replace_once(
    s,
    """        return space.models
          .filter((model) => operation === 'executeAction'
            ? model.actions.length > 0
            : model.access.includes(requiredAccessForOperation(operation)))
          .map((model) => ({
            name: `${model.display.plural} (${model.key})`,
            value: model.key,
            description: model.description ?? undefined,
          }));""",
    """        return space.models
          .filter((model) => modelSupportsRuntimeOperation(model, operation))
          .filter((model) => operation === 'executeAction'
            ? model.actions.length > 0
            : model.access.includes(requiredAccessForOperation(operation)))
          .map((model) => ({
            name: `${model.display.plural} (${model.key})`,
            value: encodeRecordTypeSelector(model),
            description: model.description ?? undefined,
          }));""",
    'Workflow Record Type capability projection',
)

selector_helpers = """
function configuredRecordRuntimeCapabilities(
  context: IExecuteFunctions,
  itemIndex: number,
): DiscoveryRuntimeCapabilities | undefined {
  const selector = decodeRecordTypeSelector(context.getNodeParameter('recordType', itemIndex, ''));
  if (!selector?.runtimeCapabilities) return undefined;
  const spaceId = String(context.getNodeParameter('spaceId', itemIndex, '') ?? '').trim();
  if (selector.spaceId && selector.spaceId !== spaceId) {
    throw new NodeOperationError(
      context.getNode(),
      'The selected LifeSpace dynamic Record Type belongs to a different Space. Reselect Record Type and save the workflow.',
      { itemIndex },
    );
  }
  return selector.runtimeCapabilities;
}

function configuredVersionForCapabilities(
  context: IExecuteFunctions,
  itemIndex: number,
  capabilities: DiscoveryRuntimeCapabilities | undefined,
): number | undefined {
  const version = configuredMutationVersion(context, itemIndex);
  if (capabilities?.versionedWrite === false && version !== undefined) {
    throw new NodeOperationError(
      context.getNode(),
      'Version is unavailable for this LifeSpace Record Type because its current runtime contract is not versioned.',
      { itemIndex },
    );
  }
  return capabilities?.versionedWrite === false ? undefined : version;
}
"""
s = replace_once(
    s,
    """function configuredRecordModelKey(
  context: IExecuteFunctions,
  itemIndex: number,
): string {""",
    selector_helpers + "\nfunction configuredRecordModelKey(\n  context: IExecuteFunctions,\n  itemIndex: number,\n): string {",
    'dynamic Record Type helpers',
)

s = s.replace('async function executeNativeRecordBatch(', 'async function executeRecordBatch(', 1)
s = s.replace('executeNativeRecordBatch(this, items, batchSettings.atomicConsistency)', 'executeRecordBatch(this, items, batchSettings.atomicConsistency)', 1)

s = replace_once(
    s,
    """  if (items.length < 1) return [];
  if (items.length > 20) {""",
    """  if (items.length < 1) return [];
  const runtimeCapabilities = configuredRecordRuntimeCapabilities(context, 0);
  if (runtimeCapabilities && !runtimeCapabilities.batchWrite) {
    throw new NodeOperationError(context.getNode(), 'The selected LifeSpace Record Type does not support grouped write processing');
  }
  if (atomicConsistency && runtimeCapabilities && !runtimeCapabilities.atomicBatch) {
    throw new NodeOperationError(context.getNode(), 'Atomic Consistency is unavailable for the selected LifeSpace Record Type');
  }
  if (items.length > 20) {""",
    'batch dynamic capabilities',
)

s = replace_once(
    s,
    """    const version = configuredMutationVersion(context, itemIndex);

    if (operation === 'delete') {""",
    """    const version = configuredVersionForCapabilities(context, itemIndex, runtimeCapabilities);

    if (operation === 'delete') {""",
    'batch version capability',
)

s = replace_once(
    s,
    """          const rawModelKey = configuredRecordModelKey(this, itemIndex);
          const spaceId = encodeURIComponent(rawSpaceId);""",
    """          const rawModelKey = configuredRecordModelKey(this, itemIndex);
          const runtimeCapabilities = configuredRecordRuntimeCapabilities(this, itemIndex);
          const spaceId = encodeURIComponent(rawSpaceId);""",
    'single execution dynamic capabilities',
)

s = replace_once(
    s,
    """            } else if (operation === 'update') {
              const body = mutationMappedValues(this, itemIndex);
              options = {
                method: 'PATCH',
                url: `${baseUrl}${recordPath}`,
                body: {
                  ...body,
                  version: await mutationVersion(this, itemIndex, baseUrl, recordPath),
                },
                json: true,
              };
            } else if (operation === 'delete') {
              options = {
                method: 'DELETE',
                url: `${baseUrl}${recordPath}`,
                body: { version: await mutationVersion(this, itemIndex, baseUrl, recordPath) },
                json: true,
              };""",
    """            } else if (operation === 'update') {
              const body = mutationMappedValues(this, itemIndex);
              const configuredVersion = configuredVersionForCapabilities(this, itemIndex, runtimeCapabilities);
              const version = runtimeCapabilities?.versionedWrite === false
                ? undefined
                : configuredVersion ?? await currentRecordVersion(this, itemIndex, baseUrl, recordPath);
              options = {
                method: 'PATCH',
                url: `${baseUrl}${recordPath}`,
                body: version === undefined ? body : { ...body, version },
                json: true,
              };
            } else if (operation === 'delete') {
              const configuredVersion = configuredVersionForCapabilities(this, itemIndex, runtimeCapabilities);
              const version = runtimeCapabilities?.versionedWrite === false
                ? undefined
                : configuredVersion ?? await currentRecordVersion(this, itemIndex, baseUrl, recordPath);
              options = {
                method: 'DELETE',
                url: `${baseUrl}${recordPath}`,
                body: version === undefined ? {} : { version },
                json: true,
              };""",
    'versionless external single mutations',
)
p.write_text(s)

# ---- Agent semantic snapshots and request factory. ----
p = Path('nodes/agent/lifeSpaceToolSnapshot.ts')
s = p.read_text()
s = replace_once(
    s,
    """  return typeof value.key === 'string'
    && /^[a-z][a-z0-9_]{1,62}$/u.test(value.key)
    && typeof value.version === 'number'
    && Number.isInteger(value.version)
    && value.version >= 1
    && typeof value.schemaHash === 'string'""",
    """  const versionIdentity = value.origin === 'external'
    ? value.version === undefined
      && typeof value.spaceId === 'string'
      && value.spaceId.length > 0
      && objectValue(value.runtimeCapabilities)
    : typeof value.version === 'number'
      && Number.isInteger(value.version)
      && value.version >= 1;
  return typeof value.key === 'string'
    && /^[a-z][a-z0-9_]{1,62}$/u.test(value.key)
    && versionIdentity
    && typeof value.schemaHash === 'string'""",
    'Agent snapshot dynamic identity',
)
p.write_text(s)

p = Path('nodes/agent/lifeSpaceToolFactory.ts')
s = p.read_text()
s = replace_once(
    s,
    """  DiscoveryModel,
} from '../lifespaceDiscovery';""",
    """  DiscoveryModel,
  modelSupportsRuntimeOperation,
} from '../lifespaceDiscovery';""",
    'Agent factory runtime capability import',
)
s = replace_once(
    s,
    """export function buildAgentToolDefinition(model: DiscoveryModel, config: AgentToolConfig): LifeSpaceAgentToolDefinition {
  if (!text(config.spaceId)) throw new Error('LifeSpace Agent Tool requires a Space ID');
  ensureConfiguredAccess(model, config);""",
    """export function buildAgentToolDefinition(model: DiscoveryModel, config: AgentToolConfig): LifeSpaceAgentToolDefinition {
  if (!text(config.spaceId)) throw new Error('LifeSpace Agent Tool requires a Space ID');
  if (!modelSupportsRuntimeOperation(model, config.operation)) {
    throw new Error(`LifeSpace ${model.key} does not expose ${config.operation} in its current runtime contract`);
  }
  ensureConfiguredAccess(model, config);""",
    'Agent definition capability gate',
)
s = replace_once(
    s,
    """  if (config.operation === 'batchCreate') {
    const items = validated.items;""",
    """  if (config.operation === 'batchCreate') {
    if (model.runtimeCapabilities && (!model.runtimeCapabilities.batchWrite || !model.runtimeCapabilities.atomicBatch)) {
      throw new Error(`LifeSpace ${model.key} does not support atomic Batch Create`);
    }
    const items = validated.items;""",
    'Agent batch capability guard',
)
s = replace_once(
    s,
    """  if (config.operation === 'update') {
    const body = semanticBody(schema, validated, mutationFields(model, 'update'), [RECORD_ID]);
    if (!Object.keys(body).length) throw new Error('LifeSpace Update requires at least one field to change');
    if (currentVersion === undefined) return { method: 'PATCH', path, body, needsCurrentVersion: true, versionParameter: 'version' };
    return { method: 'PATCH', path, body: { ...body, version: currentVersion } };
  }
  if (config.operation === 'delete') {
    if (currentVersion === undefined) return { method: 'DELETE', path, needsCurrentVersion: true, versionParameter: 'version' };
    return { method: 'DELETE', path, body: { version: currentVersion } };
  }""",
    """  if (config.operation === 'update') {
    const body = semanticBody(schema, validated, mutationFields(model, 'update'), [RECORD_ID]);
    if (!Object.keys(body).length) throw new Error('LifeSpace Update requires at least one field to change');
    if (model.runtimeCapabilities?.versionedWrite === false) return { method: 'PATCH', path, body };
    if (currentVersion === undefined) return { method: 'PATCH', path, body, needsCurrentVersion: true, versionParameter: 'version' };
    return { method: 'PATCH', path, body: { ...body, version: currentVersion } };
  }
  if (config.operation === 'delete') {
    if (model.runtimeCapabilities?.versionedWrite === false) return { method: 'DELETE', path, body: {} };
    if (currentVersion === undefined) return { method: 'DELETE', path, needsCurrentVersion: true, versionParameter: 'version' };
    return { method: 'DELETE', path, body: { version: currentVersion } };
  }""",
    'Agent versionless mutations',
)
p.write_text(s)

p = Path('nodes/LifeSpaceTool/LifeSpaceTool.node.ts')
s = p.read_text()
s = replace_once(s, "  loadRuntimeDiscoveryInventory,\n", "  loadRuntimeDiscoveryInventory,\n  modelSupportsRuntimeOperation,\n", 'Tool runtime operation import')
s = regex_once(
    s,
    r"function modelSupportsOperation\(model: DiscoveryModel, operation: string\): boolean \{.*?\n\}",
    """function modelSupportsOperation(model: DiscoveryModel, operation: string): boolean {
  if (!modelSupportsRuntimeOperation(model, operation)) return false;
  const access = requiredAccess(operation);
  if (access) return model.access.includes(access);
  if (operation === 'action') return model.actions.some((action) => model.access.includes(action.access));
  return false;
}""",
    'Tool operation capability gate',
)
s = replace_once(
    s,
    """        lifeSpaceSemanticToolName: runtime.definition.name,
        lifeSpaceModelVersion: runtime.model.version,
        lifeSpaceSchemaHash: runtime.model.schemaHash,""",
    """        lifeSpaceSemanticToolName: runtime.definition.name,
        ...(runtime.model.version !== undefined ? { lifeSpaceModelVersion: runtime.model.version } : {}),
        lifeSpaceSchemaHash: runtime.model.schemaHash,
        ...(runtime.model.origin ? { lifeSpaceModelOrigin: runtime.model.origin } : {}),""",
    'Tool metadata dynamic identity',
)
p.write_text(s)

# ---- Tests: replace the temporary filter test with real Dynamic Contract conformance. ----
Path('test/external-discovery-compat.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');
const { decodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');

const BASE_URL = 'https://example.invalid/api/v1';
const externalCapabilities = {
  get: true,
  query: true,
  create: false,
  update: false,
  delete: false,
  batchWrite: false,
  atomicBatch: false,
  transaction: false,
  versionedWrite: false,
  actions: false,
  relationTargetResolution: false,
};
const inventory = {
  data: {
    semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
    models: [
      {
        key: 'task', version: 7, schemaHash: 'sha256:task-v7',
        display: { singular: 'Task', plural: 'Tasks' }, capabilities: [], actions: [],
      },
      {
        key: 'health_document', origin: 'external', spaceId: 'spc_test', schemaHash: 'sha256:notion-a',
        display: { singular: 'Health Document', plural: 'Health Documents' },
        runtimeCapabilities: externalCapabilities, contract: { kind: 'dynamic', revision: null },
      },
      {
        key: 'health_document', origin: 'external', spaceId: 'spc_other', schemaHash: 'sha256:notion-b',
        display: { singular: 'Health Document', plural: 'Health Documents' },
        runtimeCapabilities: { ...externalCapabilities, create: true, update: true, batchWrite: true },
        contract: { kind: 'dynamic', revision: null },
      },
    ],
    spaces: [
      { spaceId: 'spc_test', spaceName: 'Test Space', models: [
        { modelKey: 'task', access: ['read', 'write'] },
        { modelKey: 'health_document', access: ['read'] },
      ] },
      { spaceId: 'spc_other', spaceName: 'Other Space', models: [
        { modelKey: 'health_document', access: ['read', 'write'] },
      ] },
    ],
  },
};

function externalDetail(spaceId = 'spc_test') {
  const other = spaceId === 'spc_other';
  const runtimeCapabilities = other
    ? { ...externalCapabilities, create: true, update: true, batchWrite: true }
    : externalCapabilities;
  return {
    data: {
      key: 'health_document', modelKey: 'health_document', origin: 'external', spaceId,
      schemaHash: other ? 'sha256:notion-b' : 'sha256:notion-a',
      display: { singular: 'Health Document', plural: 'Health Documents' },
      description: 'Provider-neutral dynamic document.',
      access: other ? ['read', 'write'] : ['read'],
      fields: [
        { key: 'f_title', title: 'Title', type: 'string', nullable: false, readable: true, writable: other, operators: ['eq', 'contains'], sortable: true },
        { key: 'f_created', title: 'Created', type: 'instant', nullable: false, readable: true, writable: false, operators: ['eq', 'gte'], sortable: true },
      ],
      actions: [], capabilities: [], capabilityBindings: {}, runtimeCapabilities,
      contract: { kind: 'dynamic', revision: null },
      query: { canonical: {
        invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query' },
        composition: { selectionFacets: ['search', 'filter'], selectionCombine: 'intersection', ordering: 'sort', pagination: 'cursor-pagination' },
        search: null,
        filter: { maxDepth: 2, maxNodes: 100, targets: [
          { field: 'f_title', kind: 'field', valueType: 'string', operators: ['eq', 'contains'], nullable: false },
          { field: 'f_created', kind: 'field', valueType: 'instant', operators: ['eq', 'gte'], nullable: false },
        ] },
        sort: { fields: ['f_title', 'f_created'], directions: ['asc', 'desc'], maxCriteria: 8, default: [], nullPlacement: 'provider-defined', stableTieBreaker: 'provider-defined', temporalRange: null },
        pagination: { limit: { minimum: 1, maximum: 100, default: 100 }, cursor: { opaque: true, binds: ['space', 'model', 'schema'], snapshotConsistency: false } },
      } },
    },
  };
}

function context(parameters = {}) {
  const calls = [];
  return {
    calls,
    getCredentials: async () => ({ baseUrl: BASE_URL }),
    getCurrentNodeParameter(name) { return Object.hasOwn(parameters, name) ? parameters[name] : undefined; },
    getNodeParameter(name, fallback) { return Object.hasOwn(parameters, name) ? parameters[name] : fallback; },
    getNode: () => ({ name: 'LifeSpace' }),
    helpers: { async httpRequestWithAuthentication(_credentialName, options) {
      calls.push(options);
      if (options.url === `${BASE_URL}/me/_discovery/inventory`) return structuredClone(inventory);
      const match = /\/spaces\/(spc_test|spc_other)\/_discovery\/models\/health_document$/u.exec(options.url);
      if (match) return externalDetail(match[1]);
      throw new Error(`Unexpected request ${options.method} ${options.url}`);
    } },
  };
}

test('Space selector keeps External models and does not collapse same modelKey across Spaces', async () => {
  const node = new LifeSpaceWorkflow();
  const current = context();
  const spaces = await node.methods.loadOptions.getSpaces.call(current);
  assert.deepEqual(spaces.map((item) => [item.value, item.description]), [
    ['spc_test', 'spc_test · 2 available Record Types'],
    ['spc_other', 'spc_other · 1 available Record Type'],
  ]);
});

test('Record Type selector projects current External runtime capabilities instead of filtering by origin', async () => {
  const node = new LifeSpaceWorkflow();
  const readContext = context({ spaceId: 'spc_test', operation: 'list' });
  const readTypes = await node.methods.loadOptions.getRecordTypes.call(readContext);
  const external = readTypes.find((item) => item.name.includes('Health Documents'));
  assert.ok(external);
  const selector = decodeRecordTypeSelector(external.value);
  assert.equal(selector.origin, 'external');
  assert.equal(selector.spaceId, 'spc_test');
  assert.equal(selector.schemaHash, 'sha256:notion-a');
  assert.equal(selector.runtimeCapabilities.query, true);

  const createContext = context({ spaceId: 'spc_test', operation: 'create' });
  const createTypes = await node.methods.loadOptions.getRecordTypes.call(createContext);
  assert.equal(createTypes.some((item) => item.name.includes('Health Documents')), false);

  const writableContext = context({ spaceId: 'spc_other', operation: 'create' });
  const writableTypes = await node.methods.loadOptions.getRecordTypes.call(writableContext);
  assert.equal(writableTypes.some((item) => item.name.includes('Health Documents')), true);
});

test('selected External Record Type loads Space-local dynamic fields without fabricating Native version', async () => {
  const node = new LifeSpaceWorkflow();
  const optionContext = context({ spaceId: 'spc_other', operation: 'create' });
  const options = await node.methods.loadOptions.getRecordTypes.call(optionContext);
  const external = options.find((item) => item.name.includes('Health Documents'));
  assert.ok(external);

  const fieldContext = context({ spaceId: 'spc_other', operation: 'create', recordType: external.value });
  const fields = await node.methods.resourceMapping.getHumanRecordFields.call(fieldContext);
  assert.deepEqual(fields.fields.map((field) => field.id), ['f_title']);
  const selector = decodeRecordTypeSelector(external.value);
  assert.equal(selector.schemaHash, 'sha256:notion-b');
  assert.equal(fieldContext.calls.some((call) => call.url.endsWith('/spaces/spc_other/_discovery/models/health_document')), true);
});
''')

# Extend execution request-count coverage: versionless External Update/Delete must remain one
# business request and retain the existing zero-execution-Discovery property.
p = Path('test/execution-request-counts.test.mjs')
s = p.read_text()
s = replace_once(
    s,
    "const TASK_RECORD_TYPE = encodeRecordTypeSelector('task');\n",
    """const TASK_RECORD_TYPE = encodeRecordTypeSelector('task');
const EXTERNAL_RECORD_TYPE = encodeRecordTypeSelector({
  key: 'health_document',
  origin: 'external',
  spaceId: 'spc_test',
  schemaHash: 'sha256:notion-runtime',
  runtimeCapabilities: {
    get: true, query: true, create: true, update: true, delete: true,
    batchWrite: true, atomicBatch: false, transaction: false,
    versionedWrite: false, actions: false, relationTargetResolution: false,
  },
});
""",
    'execution test External selector',
)
append_marker = """test('Delete without an explicit version performs only concurrency read plus mutation', async () => {
  const calls = await execute({
    operation: 'delete',
    recordId: 'rec_delete_auto',
    mutationOptions: {},
  });
  assert.deepEqual(requestShape(calls), [
    ['GET', `${BASE_URL}/spaces/spc_test/models/task/records/rec_delete_auto`],
    ['DELETE', `${BASE_URL}/spaces/spc_test/models/task/records/rec_delete_auto`],
  ]);
});
"""
external_tests = append_marker + """

test('versionless dynamic Record Type Update performs one PATCH without Native version pre-read', async () => {
  const calls = await execute({
    operation: 'update',
    recordType: EXTERNAL_RECORD_TYPE,
    recordId: 'rec_external_update',
    recordOptions: {},
    'fields.value': { f_title: 'Updated' },
  });
  assert.deepEqual(requestShape(calls), [
    ['PATCH', `${BASE_URL}/spaces/spc_test/models/health_document/records/rec_external_update`],
  ]);
  assert.equal('version' in calls[0].body, false);
});

test('versionless dynamic Record Type Delete performs one DELETE with no Native version', async () => {
  const calls = await execute({
    operation: 'delete',
    recordType: EXTERNAL_RECORD_TYPE,
    recordId: 'rec_external_delete',
    recordOptions: {},
  });
  assert.deepEqual(requestShape(calls), [
    ['DELETE', `${BASE_URL}/spaces/spc_test/models/health_document/records/rec_external_delete`],
  ]);
  assert.deepEqual(calls[0].body, {});
});
"""
s = replace_once(s, append_marker, external_tests, 'versionless External execution tests')
p.write_text(s)

# Agent Tool factory regression for a dynamic versionless contract.
p = Path('test/agent-tool.test.mjs')
s = p.read_text()
agent_append = r'''

test('dynamic External Tool Update/Delete never synthesize Native record version', async () => {
  const { buildAgentToolRequest } = require('../dist/nodes/agent/lifeSpaceToolFactory.js');
  const model = {
    key: 'health_document', origin: 'external', spaceId: 'spc_test', schemaHash: 'sha256:external',
    display: { singular: 'Document', plural: 'Documents' }, description: null,
    access: ['read', 'write'],
    fields: [{ key: 'f_title', title: 'Title', type: 'string', readOnly: false }], defaults: {},
    query: { searchable: [], filterable: [], sortable: [], search: null, filters: [], comparisons: [], capabilityQueries: [], sort: { parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8, default: [], envelopeFields: [], nullPlacement: 'provider-defined', genericValues: [] }, pagination: { limit: { parameter: 'limit', minimum: 1, maximum: 100, default: 100 }, cursor: { parameter: 'cursor', type: 'string' } } },
    actions: [], capabilities: [], capabilityBindings: {},
    runtimeCapabilities: { get: true, query: true, create: true, update: true, delete: true, batchWrite: true, atomicBatch: false, transaction: false, versionedWrite: false, actions: false, relationTargetResolution: false },
    contract: { kind: 'dynamic', revision: null },
  };
  const update = buildAgentToolRequest(model, { spaceId: 'spc_test', operation: 'update' }, { recordId: 'rec_external_1', f_title: 'Changed' });
  assert.equal(update.needsCurrentVersion, undefined);
  assert.deepEqual(update.body, { f_title: 'Changed' });
  const remove = buildAgentToolRequest(model, { spaceId: 'spc_test', operation: 'delete' }, { recordId: 'rec_external_1' });
  assert.equal(remove.needsCurrentVersion, undefined);
  assert.deepEqual(remove.body, {});
  assert.throws(
    () => buildAgentToolRequest(model, { spaceId: 'spc_test', operation: 'batchCreate' }, { items: [{ f_title: 'One' }] }),
    /does not support atomic Batch Create/u,
  );
});
'''
if 'dynamic External Tool Update/Delete never synthesize Native record version' not in s:
    s += agent_append
p.write_text(s)

print('dynamic External consumer changes staged')
