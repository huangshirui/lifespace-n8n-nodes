import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export type LifeSpaceErrorDetails = {
  code?: string;
  message: string;
  status?: number;
  requestId?: string;
};

type UnknownObject = Record<string, unknown>;

const CONTINUE_ON_FAIL_PREFIX = '__lifespace_error__:';

function objectValue(value: unknown): UnknownObject | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as UnknownObject;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as UnknownObject
      : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function statusValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{3}$/u.test(value.trim())) return Number(value.trim());
  return undefined;
}

function errorEnvelope(value: unknown): UnknownObject | null {
  const body = objectValue(value);
  if (!body) return null;
  const nested = objectValue(body.error);
  if (nested && stringValue(nested.message)) return nested;
  if (stringValue(body.message) && (stringValue(body.code) || stringValue(body.requestId))) return body;
  return null;
}

export function normalizeLifeSpaceError(error: unknown): LifeSpaceErrorDetails | null {
  const root = objectValue(error);
  if (!root) return null;
  const context = objectValue(root.context);
  const response = objectValue(root.response);
  const cause = objectValue(root.cause);

  const candidates = [
    context?.data,
    context?.body,
    response?.data,
    response?.body,
    cause?.data,
    cause?.body,
    root.data,
    root.body,
  ];

  let envelope: UnknownObject | null = null;
  for (const candidate of candidates) {
    envelope = errorEnvelope(candidate);
    if (envelope) break;
  }
  if (!envelope) return null;

  const message = stringValue(envelope.message);
  if (!message) return null;

  const statusCandidates = [
    root.httpCode,
    root.statusCode,
    context?.httpCode,
    context?.statusCode,
    response?.status,
    response?.statusCode,
    cause?.status,
    cause?.statusCode,
  ];
  let status: number | undefined;
  for (const candidate of statusCandidates) {
    status = statusValue(candidate);
    if (status !== undefined) break;
  }

  return {
    ...(stringValue(envelope.code) ? { code: stringValue(envelope.code) } : {}),
    message,
    ...(status !== undefined ? { status } : {}),
    ...(stringValue(envelope.requestId) ? { requestId: stringValue(envelope.requestId) } : {}),
  };
}

function encodeContinueOnFailError(details: LifeSpaceErrorDetails): Error {
  return new Error(`${CONTINUE_ON_FAIL_PREFIX}${JSON.stringify(details)}`);
}

export function decodeContinueOnFailError(value: unknown): LifeSpaceErrorDetails | null {
  if (typeof value !== 'string' || !value.startsWith(CONTINUE_ON_FAIL_PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(CONTINUE_ON_FAIL_PREFIX.length)) as unknown;
    const object = objectValue(parsed);
    const message = stringValue(object?.message);
    if (!object || !message) return null;
    return {
      ...(stringValue(object.code) ? { code: stringValue(object.code) } : {}),
      message,
      ...(statusValue(object.status) !== undefined ? { status: statusValue(object.status) } : {}),
      ...(stringValue(object.requestId) ? { requestId: stringValue(object.requestId) } : {}),
    };
  } catch {
    return null;
  }
}

export function projectLifeSpaceHttpError(context: IExecuteFunctions, error: unknown): Error {
  const details = normalizeLifeSpaceError(error);
  if (!details) return error instanceof Error ? error : new Error(String(error));
  if (context.continueOnFail()) return encodeContinueOnFailError(details);

  const metadata = [
    details.code ? `Code: ${details.code}` : '',
    details.status !== undefined ? `HTTP ${details.status}` : '',
    details.requestId ? `Request ID: ${details.requestId}` : '',
  ].filter(Boolean).join(' · ');

  return new NodeOperationError(
    context.getNode(),
    details.message,
    metadata ? { description: metadata } : {},
  );
}

export function restoreLifeSpaceContinueOnFailErrors(
  executions: INodeExecutionData[][],
): INodeExecutionData[][] {
  return executions.map((items) => items.map((item) => {
    const details = decodeContinueOnFailError(item.json.error);
    if (!details) return item;
    return {
      ...item,
      json: {
        ...item.json,
        error: details as unknown as IDataObject,
      },
    };
  }));
}
