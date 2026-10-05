from pathlib import Path
import json

node = Path('nodes/LifeSpace/LifeSpace.node.ts')
source = node.read_text()
start = source.index('function recordBatchMode(')
end = source.index('async function actionBodyWithConcurrency(', start)
replacement = r'''type RecordBatchSettings = { batchProcessing: boolean; atomicConsistency: boolean };

function recordBatchSettings(
  context: IExecuteFunctions,
  itemIndex: number,
): RecordBatchSettings {
  const options = context.getNodeParameter('recordOptions', itemIndex, {}) as IDataObject;
  // 0.1.x compatibility: the retired Batch Mode flag meant atomic batching.
  const legacyAtomicBatch = options.batchMode === true;
  return {
    batchProcessing: legacyAtomicBatch || options.batchProcessing !== false,
    atomicConsistency: legacyAtomicBatch || options.atomicConsistency === true,
  };
}

function configuredRecordModelKey(
  context: IExecuteFunctions,
  itemIndex: number,
): string {
  const recordType = decodeRecordTypeSelector(context.getNodeParameter('recordType', itemIndex, ''));
  const legacyModelRoute = String(context.getNodeParameter('modelRoute', itemIndex, '') ?? '').trim();
  const modelKey = recordType?.modelKey ?? LEGACY_MODEL_ROUTE_TO_KEY[legacyModelRoute];
  if (!modelKey) {
    throw new NodeOperationError(
      context.getNode(),
      'LifeSpace Record Type selector is invalid. Choose a Record Type from Discovery or pass a Trigger recordType value.',
      { itemIndex },
    );
  }
  return modelKey;
}

async function executeNativeRecordBatch(
  context: IExecuteFunctions,
  items: INodeExecutionData[],
  atomicConsistency: boolean,
): Promise<INodeExecutionData[]> {
  if (items.length < 1) return [];
  if (items.length > 20) {
    throw new NodeOperationError(
      context.getNode(),
      'LifeSpace Batch Processing accepts at most 20 input items per request',
    );
  }

  const operation = String(context.getNodeParameter('operation', 0, ''));
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new NodeOperationError(
      context.getNode(),
      'LifeSpace Batch Processing is available only for Create, Update, or Delete',
    );
  }

  let sourceSpaceId = '';
  let sourceModelKey = '';
  const operations: BatchMutationOperation[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const itemOperation = String(context.getNodeParameter('operation', itemIndex, operation));
    if (itemOperation !== operation) {
      throw new NodeOperationError(
        context.getNode(),
        'All input items in LifeSpace Batch Processing must use the same operation',
        { itemIndex },
      );
    }

    const rawSpaceId = String(context.getNodeParameter('spaceId', itemIndex, '') ?? '').trim();
    if (!rawSpaceId) {
      throw new NodeOperationError(context.getNode(), 'LifeSpace Batch Processing requires a Space ID', { itemIndex });
    }
    const modelKey = configuredRecordModelKey(context, itemIndex);

    if (!sourceSpaceId) sourceSpaceId = rawSpaceId;
    if (!sourceModelKey) sourceModelKey = modelKey;
    if (rawSpaceId !== sourceSpaceId || modelKey !== sourceModelKey) {
      throw new NodeOperationError(
        context.getNode(),
        'All input items in LifeSpace Batch Processing must resolve to the same Space and Record Type',
        { itemIndex },
      );
    }

    if (operation === 'create') {
      operations.push({ operation: 'create', modelKey, data: mutationMappedValues(context, itemIndex) });
      continue;
    }

    const recordId = String(context.getNodeParameter('recordId', itemIndex, '') ?? '').trim();
    if (!/^rec_[A-Za-z0-9_-]+$/u.test(recordId)) {
      throw new NodeOperationError(
        context.getNode(),
        'Record ID must be a valid rec_* identifier in Batch Processing',
        { itemIndex },
      );
    }
    const version = configuredMutationVersion(context, itemIndex);

    if (operation === 'delete') {
      operations.push({
        operation: 'delete',
        modelKey,
        recordId,
        ...(version === undefined ? {} : { version }),
      });
      continue;
    }

    operations.push({
      operation: 'update',
      modelKey,
      recordId,
      ...(version === undefined ? {} : { version }),
      data: mutationMappedValues(context, itemIndex),
    });
  }

  const baseUrl = normalizeBaseUrl((await context.getCredentials('lifeSpaceApi', 0)).baseUrl);
  const response = await context.helpers.httpRequestWithAuthentication.call(
    context,
    'lifeSpaceApi',
    {
      method: 'POST',
      url: `${baseUrl}/spaces/${encodeURIComponent(sourceSpaceId)}/models/${atomicConsistency ? 'batch' : 'bulk'}`,
      body: { operations } as unknown as IDataObject,
      json: true,
    },
  ) as { data?: { changeSetId?: unknown; bulkId?: unknown; items?: unknown } };

  const results = response?.data?.items;
  if (!Array.isArray(results) || results.length !== items.length) {
    throw new NodeOperationError(
      context.getNode(),
      `LifeSpace ${atomicConsistency ? 'Batch' : 'Bulk'} response did not match the input item count`,
    );
  }

  if (!atomicConsistency) {
    const bulkId = String(response?.data?.bulkId ?? '').trim();
    if (!/^blk_[A-Za-z0-9_-]+$/u.test(bulkId)) {
      throw new NodeOperationError(context.getNode(), 'LifeSpace Bulk response did not expose a valid bulkId');
    }
    return results.map((result, itemIndex) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new NodeOperationError(context.getNode(), `LifeSpace Bulk result ${itemIndex} is invalid`, { itemIndex });
      }
      return { json: { ...(result as IDataObject), bulkId }, pairedItem: { item: itemIndex } };
    });
  }

  const changeSetId = String(response?.data?.changeSetId ?? '').trim();
  if (!/^cgs_[A-Za-z0-9_-]+$/u.test(changeSetId)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace Batch response did not expose a valid changeSetId');
  }
  return results.map((result, itemIndex) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new NodeOperationError(context.getNode(), `LifeSpace Batch result ${itemIndex} is invalid`, { itemIndex });
    }
    return { json: { ...(result as IDataObject), changeSetId }, pairedItem: { item: itemIndex } };
  });
}

'''
source = source[:start] + replacement + source[end:]
old_options = """        options: [{
          displayName: 'Batch Mode',
          name: 'batchMode',
          type: 'boolean',
          default: false,
          description: 'Whether to send all incoming n8n items as one atomic LifeSpace Batch. Limited to 20 items in one Space and Record Type; the node never auto-chunks because that would weaken atomic semantics.',
        }],"""
new_options = """        options: [
          {
            displayName: 'Batch Processing',
            name: 'batchProcessing',
            type: 'boolean',
            default: true,
            description: 'Whether to group incoming n8n items into one LifeSpace request. When enabled without Atomic Consistency, items succeed or fail independently and partial success is preserved.',
          },
          {
            displayName: 'Atomic Consistency',
            name: 'atomicConsistency',
            type: 'boolean',
            default: false,
            description: 'Whether the grouped mutation must commit all items or roll back the whole request. Enable only when the business operation requires all-or-none semantics.',
          },
        ],"""
if old_options not in source:
    raise SystemExit('recordOptions batch block not found')
source = source.replace(old_options, new_options, 1)
old_exec = """      if (
        resource === 'modelRecord'
        && ['create', 'update', 'delete'].includes(operation)
        && recordBatchMode(this, 0)
      ) {
        try {
          return [await executeNativeRecordBatch(this, items)];"""
new_exec = """      const batchSettings = recordBatchSettings(this, 0);
      if (
        resource === 'modelRecord'
        && ['create', 'update', 'delete'].includes(operation)
        && batchSettings.batchProcessing
      ) {
        try {
          return [await executeNativeRecordBatch(this, items, batchSettings.atomicConsistency)];"""
if old_exec not in source:
    raise SystemExit('batch execution block not found')
source = source.replace(old_exec, new_exec, 1)
source = source.replace(
    'In Batch Mode, omission is sent to Core for set-wise current-version resolution before atomic commit.',
    'In Batch Processing, omission is sent to Core for set-wise current-version resolution before commit.',
)
node.write_text(source)

cancel_dir = Path('nodes/LifeSpaceCancelAuthorizationTool')
cancel_dir.mkdir(parents=True, exist_ok=True)
cancel_dir.joinpath('LifeSpaceCancelAuthorizationTool.node.ts').write_text(r'''import type { INodeType, INodeTypeDescription, ISupplyDataFunctions, SupplyData } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { agentAuthorizationRequest, requiredIdentifier, toolOutput } from '../authorization/lifeSpaceAuthorizationRequest';

type StructuralAiTool = {
  name: string;
  description: string;
  schema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  metadata: Record<string, unknown>;
  invoke: (query: unknown) => Promise<string>;
};

export class LifeSpaceCancelAuthorizationTool implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LifeSpace Cancel Authorization (Agent Tool)',
    name: 'lifeSpaceCancelAuthorizationTool',
    icon: 'file:../LifeSpace/lifespace.svg',
    group: ['transform'],
    version: 1,
    description: 'Cancel a pending Authorization Request that the requesting Agent no longer needs',
    defaults: { name: 'LifeSpace Cancel Authorization' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiTool],
    outputNames: ['Tool'],
    credentials: [{ name: 'lifeSpaceAgentExecutionApi', required: true }],
    properties: [],
  };

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const tool: StructuralAiTool = {
      name: 'lifespace_cancel_authorization',
      description: 'Cancel a pending LifeSpace Authorization Request that this Agent no longer needs.',
      schema: {
        type: 'object',
        properties: {
          spaceId: { type: 'string', description: 'LifeSpace spc_* from the Authorization Request.' },
          requestId: { type: 'string', description: 'LifeSpace arq_* to cancel.' },
        },
        required: ['spaceId', 'requestId'],
        additionalProperties: false,
      },
      metadata: { lifeSpaceAuthority: 'cancel', principalContext: 'requesting_agent' },
      invoke: async (query: unknown): Promise<string> => {
        try {
          if (!query || typeof query !== 'object' || Array.isArray(query)) {
            throw new NodeOperationError(this.getNode(), 'Tool input must be an object');
          }
          const input = query as Record<string, unknown>;
          const spaceId = requiredIdentifier(this, input.spaceId, 'Space ID', /^spc_[A-Za-z0-9_-]+$/u);
          const requestId = requiredIdentifier(this, input.requestId, 'Authorization Request ID', /^arq_[A-Za-z0-9_-]+$/u);
          const response = await agentAuthorizationRequest(this, itemIndex, {
            method: 'POST',
            url: `/spaces/${encodeURIComponent(spaceId)}/authorization-requests/${encodeURIComponent(requestId)}/cancel`,
          });
          return toolOutput(response);
        } catch (error) {
          return toolOutput({
            ok: false,
            error: {
              code: 'AUTHORIZATION_CANCEL_FAILED',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
    };
    return { response: tool };
  }
}
''')

package_path = Path('package.json')
package = json.loads(package_path.read_text())
package['n8n']['nodes'] = [
    'dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js',
    'dist/nodes/LifeSpaceDelegation/LifeSpaceDelegation.node.js',
    'dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js',
    'dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js',
    'dist/nodes/LifeSpaceRequestAuthorization/LifeSpaceRequestAuthorization.node.js',
    'dist/nodes/LifeSpaceConfirmAuthorization/LifeSpaceConfirmAuthorization.node.js',
    'dist/nodes/LifeSpaceConfirmAuthorizationTool/LifeSpaceConfirmAuthorizationTool.node.js',
    'dist/nodes/LifeSpaceDenyAuthorization/LifeSpaceDenyAuthorization.node.js',
    'dist/nodes/LifeSpaceCancelAuthorization/LifeSpaceCancelAuthorization.node.js',
    'dist/nodes/LifeSpaceCancelAuthorizationTool/LifeSpaceCancelAuthorizationTool.node.js',
]
package_path.write_text(json.dumps(package, indent=2) + '\n')

test_path = Path('test/release-020-contract.test.mjs')
test_path.write_text(r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('0.2.0 exposes split batch processing and atomic consistency semantics', () => {
  const source = readFileSync('nodes/LifeSpace/LifeSpace.node.ts', 'utf8');
  assert.match(source, /name: 'batchProcessing'[\s\S]*default: true/u);
  assert.match(source, /name: 'atomicConsistency'[\s\S]*default: false/u);
  assert.match(source, /atomicConsistency \? 'batch' : 'bulk'/u);
});

test('0.2.0 package registers the complete authorization request node surface', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const name of [
    'LifeSpaceRequestAuthorization',
    'LifeSpaceConfirmAuthorization',
    'LifeSpaceConfirmAuthorizationTool',
    'LifeSpaceDenyAuthorization',
    'LifeSpaceCancelAuthorization',
    'LifeSpaceCancelAuthorizationTool',
  ]) assert.ok(pkg.n8n.nodes.some((entry) => entry.includes(name)), `${name} must be registered`);
});
''')
