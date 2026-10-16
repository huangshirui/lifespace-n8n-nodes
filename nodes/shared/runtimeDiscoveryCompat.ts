import type { IExecuteFunctions, IHttpRequestOptions, ILoadOptionsFunctions } from 'n8n-workflow';

type SupportedContext = ILoadOptionsFunctions | IExecuteFunctions;
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function sanitizeInventory(response: unknown): unknown {
  const root = asRecord(response);
  const data = asRecord(root?.data);
  if (!root || !data || !Array.isArray(data.models) || !Array.isArray(data.spaces)) return response;

  const externalKeys = new Set<string>();
  const models = data.models.filter((candidate) => {
    const model = asRecord(candidate);
    if (model?.origin !== 'external') return true;
    if (typeof model.key === 'string' && model.key) externalKeys.add(model.key);
    return false;
  });

  if (!externalKeys.size) return response;

  const spaces = data.spaces.map((candidate) => {
    const space = asRecord(candidate);
    if (!space || !Array.isArray(space.models)) return candidate;
    return {
      ...space,
      models: space.models.filter((edgeCandidate) => {
        const edge = asRecord(edgeCandidate);
        return typeof edge?.modelKey !== 'string' || !externalKeys.has(edge.modelKey);
      }),
    };
  });

  return { ...root, data: { ...data, models, spaces } };
}

function sanitizeFullDiscovery(response: unknown): unknown {
  const root = asRecord(response);
  const data = asRecord(root?.data);
  if (!root || !data || !Array.isArray(data.spaces)) return response;

  const spaces = data.spaces.map((candidate) => {
    const space = asRecord(candidate);
    if (!space || !Array.isArray(space.models)) return candidate;
    return {
      ...space,
      models: space.models.filter((modelCandidate) => asRecord(modelCandidate)?.origin !== 'external'),
    };
  });

  return { ...root, data: { ...data, spaces } };
}

export function sanitizeUnsupportedExternalDiscovery(
  options: IHttpRequestOptions,
  response: unknown,
): unknown {
  const url = String(options.url ?? '');
  if (url.endsWith('/me/_discovery/inventory')) return sanitizeInventory(response);
  if (url.endsWith('/me/_discovery')) return sanitizeFullDiscovery(response);
  return response;
}

export function withNativeDiscoveryCompatibility<T extends SupportedContext>(context: T): T {
  const helpers = context.helpers;
  const requestWithAuthentication = helpers.httpRequestWithAuthentication.bind(context) as (
    credentialName: string,
    options: IHttpRequestOptions,
  ) => Promise<unknown>;

  const compatibleHelpers = new Proxy(helpers, {
    get(target, property, receiver) {
      if (property === 'httpRequestWithAuthentication') {
        return async (credentialName: string, options: IHttpRequestOptions) => {
          const response = await requestWithAuthentication(credentialName, options);
          return sanitizeUnsupportedExternalDiscovery(options, response);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return new Proxy(context, {
    get(target, property, receiver) {
      if (property === 'helpers') return compatibleHelpers;
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
