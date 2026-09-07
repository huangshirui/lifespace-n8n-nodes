import type {
  IExecuteFunctions,
  ILoadOptionsFunctions,
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
  type: 'string' | 'text' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'timezone' | 'enum' | 'person' | 'person_list' | 'record' | 'record_list';
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

export type DiscoveryCalendarCapabilityBinding = {
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

export type DiscoveryModel = {
  key: string;
  route: string;
  version: number;
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
    sort: {
      parameter: 'sort';
      syntax: 'field:direction';
      repeatable: true;
      ordered: true;
      maxCriteria: number;
      default: string[];
      envelopeFields: string[];
    };
  };
  actions: DiscoveryAction[];
  capabilities?: string[];
  capabilityBindings?: DiscoveryCapabilityBindings;
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

type InventoryModel = {
  key: string;
  route: string;
  version: number;
  schemaHash: string;
  display: { singular: string; plural: string };
  capabilities: string[];
  actions: InventoryAction[];
};

type InventorySpace = {
  spaceId: string;
  spaceName: string;
  models: Array<{
    modelKey: string;
    access: DiscoveryAccess[];
  }>;
};

type InventoryResponse = {
  data: {
    semanticDetailPathTemplate: string;
    models: InventoryModel[];
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

type SemanticDetail = {
  key: string;
  route: string;
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
    sort: {
      parameter: 'sort';
      syntax: 'field:direction';
      repeatable: true;
      ordered: true;
      maxCriteria: number;
      genericDefault: string[];
      envelopeFields: string[];
    };
  };
  actions: DiscoveryAction[];
  capabilities: string[];
  capabilityBindings: DiscoveryCapabilityBindings;
};

type SemanticDetailResponse = {
  data: SemanticDetail;
};

type DiscoverySelection = {
  spaceId: string;
  modelRoute: string;
};

const RELATION_TARGET_PAGE_SIZE = 100;
const RELATION_TARGET_OPTION_LIMIT = 1000;
const RELATION_TARGET_LOOKUP_PATH = '/api/v1/spaces/{spaceId}/_relation-targets/{modelKey}/{fieldKey}';

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
  context: ILoadOptionsFunctions | IExecuteFunctions,
  baseUrl: string,
  path: string,
): Promise<T> {
  return await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceApi',
    { method: 'GET', url: apiUrl(baseUrl, path), json: true },
  ) as T;
}

async function requestFullRuntimeDiscovery(
  context: ILoadOptionsFunctions | IExecuteFunctions,
  baseUrl: string,
): Promise<DiscoveryResponse> {
  try {
    return await authenticatedGet<DiscoveryResponse>(context, baseUrl, '/me/_discovery');
  } catch (error) {
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }
}

function loadOptionParameter(context: ILoadOptionsFunctions, name: string): string {
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

function stubModel(identity: InventoryModel, access: DiscoveryAccess[]): DiscoveryModel {
  return {
    key: identity.key,
    route: identity.route,
    version: identity.version,
    schemaHash: identity.schemaHash,
    display: identity.display,
    description: null,
    access,
    fields: [],
    defaults: {},
    query: {
      searchable: [],
      filterable: [],
      sortable: [],
      sort: {
        parameter: 'sort',
        syntax: 'field:direction',
        repeatable: true,
        ordered: true,
        maxCriteria: 8,
        default: ['createdAt:desc'],
        envelopeFields: ['createdAt', 'updatedAt'],
      },
    },
    actions: identity.actions.map((action) => ({ ...action, input: { fields: [] } })),
    capabilities: [...identity.capabilities],
    capabilityBindings: {},
  };
}

function detailedModel(detail: SemanticDetail, access: DiscoveryAccess[]): DiscoveryModel {
  return {
    key: detail.key,
    route: detail.route,
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
      sort: {
        parameter: detail.query.sort.parameter,
        syntax: detail.query.sort.syntax,
        repeatable: detail.query.sort.repeatable,
        ordered: detail.query.sort.ordered,
        maxCriteria: detail.query.sort.maxCriteria,
        default: detail.query.sort.genericDefault,
        envelopeFields: detail.query.sort.envelopeFields,
      },
    },
    actions: detail.actions,
    capabilities: detail.capabilities,
    capabilityBindings: detail.capabilityBindings,
  };
}

function replacePathTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (path, [key, value]) => path.replace(`{${key}}`, encodeURIComponent(value)),
    template,
  );
}

async function requestProgressiveRuntimeDiscovery(
  context: ILoadOptionsFunctions | IExecuteFunctions,
  baseUrl: string,
  selection?: DiscoverySelection,
): Promise<DiscoveryResponse | null> {
  let inventory: InventoryResponse;
  try {
    inventory = await authenticatedGet<InventoryResponse>(context, baseUrl, '/me/_discovery/inventory');
  } catch {
    return null;
  }

  if (!inventory?.data || !Array.isArray(inventory.data.models) || !Array.isArray(inventory.data.spaces)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace Runtime Discovery inventory returned an invalid response');
  }

  const identities = new Map(inventory.data.models.map((model) => [model.key, model]));
  const selectedSpaceId = selection?.spaceId ?? '';
  const selectedModelRoute = selection?.modelRoute ?? '';
  let selectedDetail: SemanticDetail | null = null;
  let selectedModelKey = '';

  if (selectedSpaceId && selectedModelRoute) {
    const selectedSpace = inventory.data.spaces.find((space) => space.spaceId === selectedSpaceId);
    const selectedIdentity = [...identities.values()].find((model) => model.route === selectedModelRoute);
    if (selectedSpace && selectedIdentity && selectedSpace.models.some((edge) => edge.modelKey === selectedIdentity.key)) {
      selectedModelKey = selectedIdentity.key;
      const path = replacePathTemplate(inventory.data.semanticDetailPathTemplate, {
        spaceId: selectedSpaceId,
        modelKey: selectedIdentity.key,
      });
      try {
        const response = await authenticatedGet<SemanticDetailResponse>(context, baseUrl, path);
        selectedDetail = response.data;
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
          const identity = identities.get(edge.modelKey);
          if (!identity) return [];
          return [selectedDetail && edge.modelKey === selectedModelKey && space.spaceId === selectedSpaceId
            ? detailedModel(selectedDetail, edge.access)
            : stubModel(identity, edge.access)];
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
  context: ILoadOptionsFunctions,
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

export async function loadRuntimeDiscovery(this: ILoadOptionsFunctions): Promise<DiscoveryResponse> {
  const credentials = await this.getCredentials('lifeSpaceApi');
  const baseUrl = normalizeBaseUrl(credentials.baseUrl);
  const selection = {
    spaceId: loadOptionParameter(this, 'spaceId'),
    modelRoute: loadOptionParameter(this, 'modelRoute'),
  };
  const progressive = await requestProgressiveRuntimeDiscovery(this, baseUrl, selection);
  return progressive ?? requestFullRuntimeDiscovery(this, baseUrl);
}

export async function loadExecutionRuntimeDiscovery(
  context: IExecuteFunctions,
  baseUrl: string,
  spaceId?: string,
  modelRoute?: string,
): Promise<DiscoveryResponse> {
  const selection = spaceId && modelRoute ? { spaceId, modelRoute } : undefined;
  const progressive = await requestProgressiveRuntimeDiscovery(context, baseUrl, selection);
  return progressive ?? requestFullRuntimeDiscovery(context, baseUrl);
}

export function discoverySpace(discovery: DiscoveryResponse, spaceId: string): DiscoverySpace | undefined {
  return discovery.data.spaces.find((space) => space.spaceId === spaceId);
}

export function discoveryModel(
  discovery: DiscoveryResponse,
  spaceId: string,
  modelRoute: string,
): DiscoveryModel | undefined {
  return discoverySpace(discovery, spaceId)?.models.find((model) => model.route === modelRoute);
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
