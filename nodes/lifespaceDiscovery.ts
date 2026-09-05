import type {
  IExecuteFunctions,
  IHttpRequestOptions,
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

export type DiscoveryRelation = {
  targetModel: string;
  cardinality: 'one' | 'many';
  lookup: DiscoveryRelationLookup;
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

const RELATION_TARGET_PAGE_SIZE = 100;
const RELATION_TARGET_OPTION_LIMIT = 1000;

export function normalizeBaseUrl(value: unknown): string {
  return String(value ?? '').replace(/\/$/, '');
}

async function requestRuntimeDiscovery(
  context: ILoadOptionsFunctions | IExecuteFunctions,
  baseUrl: string,
): Promise<DiscoveryResponse> {
  const options: IHttpRequestOptions = {
    method: 'GET',
    url: `${baseUrl}/me/_discovery`,
    json: true,
  };

  try {
    return await context.helpers.httpRequestWithAuthentication.call(
      context,
      'lifeSpaceApi',
      options,
    ) as DiscoveryResponse;
  } catch (error) {
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }
}

function relationTargetUrl(
  baseUrl: string,
  pathTemplate: string,
  spaceId: string,
  modelKey: string,
  fieldKey: string,
): string {
  let path = pathTemplate
    .replace('{spaceId}', encodeURIComponent(spaceId))
    .replace('{modelKey}', encodeURIComponent(modelKey))
    .replace('{fieldKey}', encodeURIComponent(fieldKey));

  if (baseUrl.endsWith('/api/v1') && path.startsWith('/api/v1/')) {
    path = path.slice('/api/v1'.length);
  }
  if (!path.startsWith('/')) path = `/${path}`;
  return `${baseUrl}${path}`;
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
  return requestRuntimeDiscovery(this, normalizeBaseUrl(credentials.baseUrl));
}

export async function loadExecutionRuntimeDiscovery(
  context: IExecuteFunctions,
  baseUrl: string,
): Promise<DiscoveryResponse> {
  return requestRuntimeDiscovery(context, baseUrl);
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
