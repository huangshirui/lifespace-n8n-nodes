import {
  validateAgentToolInput,
  type AgentToolRequest,
  type AgentToolSchema,
  type JsonSchema,
} from './lifeSpaceToolFactory';

export type PersonToolOperation = 'list' | 'get' | 'create' | 'update' | 'delete';

export type PersonToolDefinition = {
  name: string;
  description: string;
  schema: AgentToolSchema;
  operation: PersonToolOperation;
  requiredAccess: 'read' | 'write';
};

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function personIdSchema(): JsonSchema {
  return {
    type: 'string',
    minLength: 1,
    description: 'Stable LifeSpace Space Person ID (per_*). If unknown, use the Person List / Search Tool first; never guess it.',
  };
}

function alternateNamesPatchSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      set: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        description: 'Replace the complete alternate-name set. An empty array clears all alternate names. Do not combine with add/remove/rename.',
      },
      add: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
        description: 'Alternate names to add.',
      },
      remove: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
        description: 'Active alternate names to remove.',
      },
      rename: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
          },
          required: ['from', 'to'],
          additionalProperties: false,
        },
        description: 'Active alternate names to rename.',
      },
    },
    additionalProperties: false,
    description: 'Aggregate alternate-name mutation. Use set alone, or one or more of add/remove/rename.',
  };
}

function schemaFor(operation: PersonToolOperation): AgentToolSchema {
  if (operation === 'list') {
    return {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          minLength: 1,
          description: 'Optional substring search across canonical display names and active alternate names.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 50,
          description: 'Maximum People to return in this page.',
        },
        cursor: {
          type: 'string',
          minLength: 1,
          description: 'Opaque cursor from a previous Person Directory page.',
        },
      },
      additionalProperties: false,
    };
  }
  if (operation === 'get' || operation === 'delete') {
    return {
      type: 'object',
      properties: { personId: personIdSchema() },
      required: ['personId'],
      additionalProperties: false,
    };
  }
  if (operation === 'create') {
    return {
      type: 'object',
      properties: {
        displayName: {
          type: 'string',
          minLength: 1,
          description: 'Canonical display name for the new Space Person.',
        },
        alternateNames: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description: 'Optional Space-local alternate names/aliases used for Person lookup.',
        },
      },
      required: ['displayName'],
      additionalProperties: false,
    };
  }
  return {
    type: 'object',
    properties: {
      personId: personIdSchema(),
      displayName: {
        type: 'string',
        minLength: 1,
        description: 'New canonical display name. Omit to keep the current display name.',
      },
      alternateNames: alternateNamesPatchSchema(),
    },
    required: ['personId'],
    additionalProperties: false,
  };
}

function validatePersonId(personId: unknown): string {
  const value = String(personId ?? '').trim();
  if (!/^per_[A-Za-z0-9_-]+$/u.test(value)) throw new Error('personId must be a valid per_* identifier');
  return value;
}

function cleanNames(value: unknown, label: string, allowEmpty: boolean): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const names = value.map((entry) => String(entry ?? '').trim());
  if (names.some((entry) => !entry)) throw new Error(`${label} cannot contain empty names`);
  if (!allowEmpty && !names.length) throw new Error(`${label} must contain at least one name`);
  return names;
}

function normalizedAlternateNamesPatch(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('alternateNames must be an object');
  const input = value as Record<string, unknown>;
  const set = cleanNames(input.set, 'alternateNames.set', true);
  const add = cleanNames(input.add, 'alternateNames.add', false);
  const remove = cleanNames(input.remove, 'alternateNames.remove', false);
  const rename = input.rename === undefined
    ? undefined
    : (input.rename as Array<Record<string, unknown>>).map((entry) => ({
      from: String(entry.from ?? '').trim(),
      to: String(entry.to ?? '').trim(),
    }));
  if (rename?.some((entry) => !entry.from || !entry.to)) {
    throw new Error('alternateNames.rename requires non-empty from and to values');
  }
  if (set !== undefined && (add !== undefined || remove !== undefined || rename !== undefined)) {
    throw new Error('alternateNames.set cannot be combined with add/remove/rename');
  }
  if (set === undefined && add === undefined && remove === undefined && rename === undefined) {
    throw new Error('alternateNames requires set or at least one add/remove/rename change');
  }
  return {
    ...(set !== undefined ? { set } : {}),
    ...(add !== undefined ? { add } : {}),
    ...(remove !== undefined ? { remove } : {}),
    ...(rename !== undefined ? { rename } : {}),
  };
}

export function personToolRequiredAccess(operation: PersonToolOperation): 'read' | 'write' {
  return operation === 'list' || operation === 'get' ? 'read' : 'write';
}

export function buildPersonToolDefinition(
  spaceId: string,
  spaceName: string | null | undefined,
  operation: PersonToolOperation,
  descriptionOverride = '',
): PersonToolDefinition {
  if (!/^spc_[A-Za-z0-9_-]+$/u.test(spaceId)) throw new Error('LifeSpace Person Tool requires a valid Space ID');
  const label = spaceName?.trim() || spaceId;
  const purpose = operation === 'list'
    ? 'List or search Space People by canonical or alternate name'
    : operation === 'get'
      ? 'Get one Space Person by stable per_* ID'
      : operation === 'create'
        ? 'Create an unlinked Space Person'
        : operation === 'update'
          ? 'Update a Space Person canonical or alternate names'
          : 'Delete an unlinked Space Person';
  const lookupHint = ['get', 'update', 'delete'].includes(operation)
    ? ' If personId is unknown, use a Person List / Search Tool first and never guess an ID.'
    : '';
  return {
    name: `lifespace_person_${operation}_s${stableHash(spaceId).slice(0, 7)}`,
    description: descriptionOverride.trim()
      || `${purpose} in Space "${label}". Person is a Kernel first-class directory resource, not an ordinary LifeSpace model.${lookupHint}`,
    schema: schemaFor(operation),
    operation,
    requiredAccess: personToolRequiredAccess(operation),
  };
}

export function buildPersonToolRequest(
  spaceId: string,
  operation: PersonToolOperation,
  raw: unknown,
  currentVersion?: number,
): AgentToolRequest {
  const schema = schemaFor(operation);
  const input = validateAgentToolInput(schema, raw);
  const collection = `/spaces/${encodeURIComponent(spaceId)}/people`;
  if (operation === 'list') {
    const qs: NonNullable<AgentToolRequest['qs']> = {};
    const search = String(input.search ?? '').trim();
    if (search) qs.q = search;
    qs.limit = input.limit === undefined ? 50 : Number(input.limit);
    const cursor = String(input.cursor ?? '').trim();
    if (cursor) qs.cursor = cursor;
    return { method: 'GET', path: collection, qs };
  }
  if (operation === 'create') {
    const displayName = String(input.displayName ?? '').trim();
    const alternateNames = cleanNames(input.alternateNames, 'alternateNames', true);
    return {
      method: 'POST',
      path: collection,
      body: {
        displayName,
        ...(alternateNames?.length ? { alternateNames } : {}),
      },
    };
  }

  const personId = validatePersonId(input.personId);
  const path = `${collection}/${encodeURIComponent(personId)}`;
  if (operation === 'get') return { method: 'GET', path };
  if (operation === 'delete') {
    if (currentVersion === undefined) return { method: 'DELETE', path, needsCurrentVersion: true, versionParameter: 'version' };
    return { method: 'DELETE', path, body: { version: currentVersion } };
  }

  const displayName = input.displayName === undefined ? '' : String(input.displayName).trim();
  const alternateNames = normalizedAlternateNamesPatch(input.alternateNames);
  if (!displayName && !alternateNames) throw new Error('Person Update requires displayName or alternateNames changes');
  const body: Record<string, unknown> = {
    ...(displayName ? { displayName } : {}),
    ...(alternateNames ? { alternateNames } : {}),
  };
  if (currentVersion === undefined) {
    return { method: 'PATCH', path, body, needsCurrentVersion: true, versionParameter: 'version' };
  }
  return { method: 'PATCH', path, body: { ...body, version: currentVersion } };
}
