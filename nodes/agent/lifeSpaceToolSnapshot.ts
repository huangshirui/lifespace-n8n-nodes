import type { DiscoveryModel } from '../lifespaceDiscovery';

const AGENT_TOOL_SNAPSHOT_PREFIX = 'lsats1.';

export type AgentToolSemanticSnapshot = {
  format: 1;
  spaceId: string;
  spaceName: string | null;
  model: DiscoveryModel;
};

function objectValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validModel(value: unknown): value is DiscoveryModel {
  if (!objectValue(value)) return false;
  const display = value.display;
  const query = value.query;
  return typeof value.key === 'string'
    && /^[a-z][a-z0-9_]{1,62}$/u.test(value.key)
    && typeof value.version === 'number'
    && Number.isInteger(value.version)
    && value.version >= 1
    && typeof value.schemaHash === 'string'
    && value.schemaHash.length > 0
    && objectValue(display)
    && typeof display.singular === 'string'
    && typeof display.plural === 'string'
    && Array.isArray(value.access)
    && Array.isArray(value.fields)
    && objectValue(value.defaults)
    && objectValue(query)
    && Array.isArray(value.actions);
}

export function encodeAgentToolSemanticSnapshot(snapshot: AgentToolSemanticSnapshot): string {
  const payload = [
    snapshot.format,
    snapshot.spaceId,
    snapshot.spaceName,
    snapshot.model,
  ];
  return AGENT_TOOL_SNAPSHOT_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeAgentToolSemanticSnapshot(value: unknown): AgentToolSemanticSnapshot | null {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith(AGENT_TOOL_SNAPSHOT_PREFIX)) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(raw.slice(AGENT_TOOL_SNAPSHOT_PREFIX.length), 'base64url').toString('utf8'),
    ) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 4 || decoded[0] !== 1) return null;

    const [, spaceId, spaceName, model] = decoded;
    if (
      typeof spaceId !== 'string'
      || !spaceId.trim()
      || (spaceName !== null && typeof spaceName !== 'string')
      || !validModel(model)
    ) return null;

    return {
      format: 1,
      spaceId,
      spaceName,
      model,
    };
  } catch {
    return null;
  }
}
