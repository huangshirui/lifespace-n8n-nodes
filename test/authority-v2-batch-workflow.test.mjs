import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');

const CORE_BASE = 'https://core.example.com/api/v1';
const IDENTITY_BASE = 'https://identity.example.com';

function context(parameters, mode, inputData = [{ json: {} }]) {
  const calls = [];
  return {
    calls,
    getInputData: () => inputData,
    getCredentials: async (name) => {
      if (name === 'lifeSpaceApi') {
        if (mode === 'delegatedAgent') throw new Error('delegated Batch must not request Service PAT');
        return { baseUrl: CORE_BASE, token: 'lsp_pat_test' };
      }
      if (name === 'lifeSpaceAgentExecutionApi') {
        return {
          coreBaseUrl: CORE_BASE,
          identityBaseUrl: IDENTITY_BASE,
          applicationSecret: 'lsa_test',
          agentId: 'agt_test',
        };
      }
      throw new Error(`unexpected credential ${name}`);
    },
    getNodeParameter(name, itemIndex, defaultValue) {
      if (!Object.hasOwn(parameters, name)) return defaultValue;
      const value = parameters[name];
      return typeof value === 'function' ? value(itemIndex) : value;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ transport: 'credential', credentialName, options });
        if (credentialName === 'lifeSpaceAgentExecutionApi') {
          assert.equal(options.url, `${IDENTITY_BASE}/internal/v1/agent-execution-tokens`);
          return {
            data: {
              accessToken: 'agent.jwt.batch',
              principalId: 'usr_test',
              principalType: 'user',
              actor: { type: 'agent', id: 'agt_test' },
              applicationId: 'app_test',
              purpose: 'agent_execution',
            },
          };
        }
        if (credentialName === 'lifeSpaceApi') {
          if (options.method === 'GET') {
            return { data: { id: 'rec_single', version: 5 } };
          }
          if (options.url.endsWith('/models/batch')) {
            const operations = options.body?.operations ?? [];
            return {
              data: {
                changeSetId: 'cgs_service',
                items: operations.map((operation, index) => ({
                  index,
                  operation: operation.operation,
                  modelKey: operation.modelKey,
                  recordId: operation.recordId ?? `rec_created_${index}`,
                  version: (operation.version ?? 1) + (operation.operation === 'create' ? 0 : 1),
                })),
              },
            };
          }
          if (options.url.endsWith('/models/bulk')) {
            const operations = options.body?.operations ?? [];
            return {
              data: {
                bulkId: 'blk_service',
                items: operations.map((operation, index) => ({
                  index,
                  ok: true,
                  operation: operation.operation,
                  modelKey: operation.modelKey,
                  recordId: operation.recordId ?? `rec_bulk_${index}`,
                  version: 1,
                })),
              },
            };
          }
          return { data: { id: 'rec_single', version: 6 } };
        }
        throw new Error(`unexpected authenticated request ${credentialName}`);
      },
      async httpRequest(options) {
        calls.push({ transport: 'direct', options });
        return {
          data: {
            changeSetId: 'cgs_delegated',
            items: [{ recordId: 'rec_updated', version: 8 }],
          },
        };
      },
    },
  };
}

test('human Workflow node exposes only Service API credential and no Agent authority controls', () => {
  const node = new LifeSpaceWorkflow();
  assert.deepEqual(node.description.credentials, [{ name: 'lifeSpaceApi', required: true }]);
  assert.equal(node.description.properties.some((entry) => entry.name === 'batchAuthorityMode'), false);
  assert.equal(node.description.properties.some((entry) => entry.name === 'batchPrincipalUserId'), false);
  assert.equal(node.description.usableAsTool, undefined);
});

test('human Service Batch sends exactly one atomic Core mutation request', async () => {
  const operations = [
    { operation: 'create', modelKey: 'task', data: { name: 'One' } },
    { operation: 'update', modelKey: 'event', recordId: 'rec_event', data: { summary: 'Updated' } },
    { operation: 'delete', modelKey: 'task', recordId: 'rec_task' },
  ];
  const execution = context({
    resource: 'batchMutation',
    spaceId: 'spc_test',
    batchAuthorityMode: 'service',
    batchOperations: JSON.stringify(operations),
  }, 'service');

  await new LifeSpaceWorkflow().execute.call(execution);

  const business = execution.calls.filter((call) => call.credentialName === 'lifeSpaceApi');
  assert.equal(business.length, 1);
  assert.equal(business[0].options.method, 'POST');
  assert.equal(business[0].options.url, `${CORE_BASE}/spaces/spc_test/models/batch`);
  assert.deepEqual(business[0].options.body, { operations });
});

test('legacy human delegated Batch fails explicitly instead of silently changing Principal', async () => {
  const operations = [
    {
      operation: 'update',
      modelKey: 'task',
      recordId: 'rec_task',
      version: 7,
      data: { name: 'Updated' },
      delegationId: 'dlg_update',
    },
  ];
  const execution = context({
    resource: 'batchMutation',
    spaceId: 'spc_test',
    batchAuthorityMode: 'delegatedAgent',
    batchPrincipalUserId: 'usr_test',
    batchOperations: JSON.stringify(operations),
  }, 'delegatedAgent');

  await assert.rejects(
    () => new LifeSpaceWorkflow().execute.call(execution),
    /no longer allows Delegated Agent Authority/u,
  );
  assert.equal(execution.calls.length, 0);
});

test('human Batch rejects more than 20 operations before any network call', async () => {
  const operations = Array.from({ length: 21 }, (_, index) => ({
    operation: 'create',
    modelKey: 'task',
    data: { name: `Task ${index}` },
  }));
  const execution = context({
    resource: 'batchMutation',
    spaceId: 'spc_test',
    batchAuthorityMode: 'service',
    batchOperations: JSON.stringify(operations),
  }, 'service');

  await assert.rejects(
    () => new LifeSpaceWorkflow().execute.call(execution),
    /1 to 20/u,
  );
  assert.equal(execution.calls.length, 0);
});

test('Record Batch Mode maps incoming n8n items to one Core Batch and preserves paired output', async () => {
  const inputData = [{ json: { source: 1 } }, { json: { source: 2 } }];
  const execution = context({
    resource: 'modelRecord',
    operation: 'update',
    recordOptions: { batchMode: true },
    spaceId: 'spc_test',
    recordType: 'task',
    recordId: (itemIndex) => itemIndex === 0 ? 'rec_one' : 'rec_two',
    'fields.value': (itemIndex) => ({ name: itemIndex === 0 ? 'One' : 'Two' }),
    mutationOptions: (itemIndex) => itemIndex === 0 ? { version: 7 } : {},
  }, 'service', inputData);

  const [output] = await new LifeSpaceWorkflow().execute.call(execution);

  const business = execution.calls.filter((call) => call.credentialName === 'lifeSpaceApi');
  assert.equal(business.length, 1);
  assert.equal(business[0].options.method, 'POST');
  assert.equal(business[0].options.url, `${CORE_BASE}/spaces/spc_test/models/batch`);
  assert.deepEqual(business[0].options.body, {
    operations: [
      {
        operation: 'update',
        modelKey: 'task',
        recordId: 'rec_one',
        version: 7,
        data: { name: 'One' },
      },
      {
        operation: 'update',
        modelKey: 'task',
        recordId: 'rec_two',
        data: { name: 'Two' },
      },
    ],
  });
  assert.equal(output.length, 2);
  assert.deepEqual(output.map((item) => item.pairedItem), [{ item: 0 }, { item: 1 }]);
  assert.deepEqual(output.map((item) => item.json.changeSetId), ['cgs_service', 'cgs_service']);
  assert.equal(
    execution.calls.some((call) => call.options?.method === 'GET'),
    false,
  );
});

test('Record mutations default to non-atomic Bulk when Batch Processing is omitted', async () => {
  const inputData = [{ json: { source: 1 } }, { json: { source: 2 } }];
  const execution = context({
    resource: 'modelRecord',
    operation: 'create',
    spaceId: 'spc_test',
    recordType: 'task',
    'fields.value': (itemIndex) => ({ name: itemIndex === 0 ? 'One' : 'Two' }),
  }, 'service', inputData);

  const [output] = await new LifeSpaceWorkflow().execute.call(execution);

  const business = execution.calls.filter((call) => call.credentialName === 'lifeSpaceApi');
  assert.equal(business.length, 1);
  assert.equal(business[0].options.method, 'POST');
  assert.equal(business[0].options.url, `${CORE_BASE}/spaces/spc_test/models/bulk`);
  assert.deepEqual(business[0].options.body, {
    operations: [
      { operation: 'create', modelKey: 'task', data: { name: 'One' } },
      { operation: 'create', modelKey: 'task', data: { name: 'Two' } },
    ],
  });
  assert.deepEqual(output.map((item) => item.json.bulkId), ['blk_service', 'blk_service']);
  assert.deepEqual(output.map((item) => item.pairedItem), [{ item: 0 }, { item: 1 }]);
});

test('Record Batch Mode rejects more than 20 input items without auto-chunking', async () => {
  const execution = context({
    resource: 'modelRecord',
    operation: 'create',
    recordOptions: { batchMode: true },
    spaceId: 'spc_test',
    recordType: 'task',
    'fields.value': { name: 'Task' },
  }, 'service', Array.from({ length: 21 }, () => ({ json: {} })));

  await assert.rejects(
    () => new LifeSpaceWorkflow().execute.call(execution),
    /at most 20 input items/u,
  );
  assert.equal(execution.calls.length, 0);
});

test('Record Batch Mode rejects mixed resolved Space before mutation', async () => {
  const execution = context({
    resource: 'modelRecord',
    operation: 'delete',
    recordOptions: { batchMode: true },
    spaceId: (itemIndex) => itemIndex === 0 ? 'spc_one' : 'spc_two',
    recordType: 'task',
    recordId: (itemIndex) => itemIndex === 0 ? 'rec_one' : 'rec_two',
    mutationOptions: {},
  }, 'service', [{ json: {} }, { json: {} }]);

  await assert.rejects(
    () => new LifeSpaceWorkflow().execute.call(execution),
    /same Space and Record Type/u,
  );
  assert.equal(execution.calls.length, 0);
});

test('Record single Update keeps Version optional and pre-reads when Batch Processing is off', async () => {
  const execution = context({
    resource: 'modelRecord',
    operation: 'update',
    recordOptions: { batchProcessing: false },
    spaceId: 'spc_test',
    recordType: 'task',
    recordId: 'rec_single',
    'fields.value': { name: 'Single' },
    mutationOptions: {},
  }, 'service');

  await new LifeSpaceWorkflow().execute.call(execution);

  const business = execution.calls.filter((call) => call.credentialName === 'lifeSpaceApi');
  assert.equal(business.length, 2);
  assert.equal(business[0].options.method, 'GET');
  assert.equal(business[1].options.method, 'PATCH');
  assert.equal(business[1].options.body.version, 5);
});
