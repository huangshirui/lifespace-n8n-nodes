import type {
  IExecuteFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export type DiscoveryAccess = 'read' | 'write' | 'manage';

export type DiscoveryField = {
  key: string;
  type: 'string' | 'text' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'timezone' | 'enum' | 'person' | 'person_list' | 'record' | 'record_list';
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
  };
  actions: DiscoveryAction[];
};

export type DiscoverySpace = {
  spaceId: string;
  models: DiscoveryModel[];
};

export type DiscoveryResponse = {
  data: {
    spaces: DiscoverySpace[];
  };
};

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
