import type { DiscoveryAction } from '../lifespaceDiscovery';

const ACTION_SNAPSHOT_PREFIX = 'lsact1.';

export type LifeSpaceActionSnapshot = {
  format: 1;
  modelKey: string;
  action: DiscoveryAction;
};

function objectValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validAction(value: unknown): value is DiscoveryAction {
  if (!objectValue(value)) return false;
  const input = value.input;
  return typeof value.key === 'string'
    && value.key.length > 0
    && ['read', 'write', 'manage'].includes(String(value.access))
    && ['workflow', 'capability'].includes(String(value.kind))
    && objectValue(input)
    && Array.isArray(input.fields);
}

export function encodeLifeSpaceActionSnapshot(snapshot: LifeSpaceActionSnapshot): string {
  return ACTION_SNAPSHOT_PREFIX + Buffer.from(
    JSON.stringify([snapshot.format, snapshot.modelKey, snapshot.action]),
    'utf8',
  ).toString('base64url');
}

export function decodeLifeSpaceActionSnapshot(value: unknown): LifeSpaceActionSnapshot | null {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith(ACTION_SNAPSHOT_PREFIX)) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(raw.slice(ACTION_SNAPSHOT_PREFIX.length), 'base64url').toString('utf8'),
    ) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== 1) return null;
    const [, modelKey, action] = decoded;
    if (
      typeof modelKey !== 'string'
      || !/^[a-z][a-z0-9_]{1,62}$/u.test(modelKey)
      || !validAction(action)
    ) return null;

    return { format: 1, modelKey, action };
  } catch {
    return null;
  }
}
