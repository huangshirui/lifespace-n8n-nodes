import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');

const CORE_BASE = 'https://core.example.com/api/v1';
const IDENTITY_BASE = 'https://identity.example.com';

function context(parameters, mode) {
  const calls = [];
  return {
    calls,
    getInputData: () => [{ json: {} }],
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
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ transport: 'credential', credentialName, options });
        if (credentialName === 'lifeSpaceAgentExecutionApi') {
          assert.equal(options.url, `${IDENTITY_BASE}/internal/v1/agent-tokens`);
          return {
            data: {
              accessToken: 'agent.jwt.batch',
              principalId: 'usr_test',
              actor: { type: 'agent', id: 'agt_test' },
              applicationId: 'app_test',
            },
          };
        }
        if (credentialName === 'lifeSpaceApi') {
          return {
            data: {
              changeSetId: 'cgs_service',
              items: [{ recordId: 'rec_created', version: 1 }],
            },
          };
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

test('human Service Batch sends exactly one atomic Core mutation request', async () => {
  const operations = [
    { operation: 'create', modelKey: 'task', data: { name: 'One' } },
    { operation: 'update', modelKey: 'event', recordId: 'rec_event', version: 7, data: { summary: 'Updated' } },
    { operation: 'delete', modelKey: 'task', recordId: 'rec_task', version: 3 },
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

test('human delegated Batch uses Agent JWT, per-item selectors and no Service PAT', async () => {
  const operations = [
    {
      operation: 'update',
      modelKey: 'task',
      recordId: 'rec_task',
      version: 7,
      data: { name: 'Updated' },
      delegationId: 'dlg_update',
    },
    {
      operation: 'delete',
      modelKey: 'event',
      recordId: 'rec_event',
      version: 4,
      delegationId: 'dlg_delete',
    },
  ];
  const execution = context({
    resource: 'batchMutation',
    spaceId: 'spc_test',
    batchAuthorityMode: 'delegatedAgent',
    batchPrincipalUserId: 'usr_test',
    batchOperations: JSON.stringify(operations),
  }, 'delegatedAgent');

  await new LifeSpaceWorkflow().execute.call(execution);

  const identity = execution.calls.filter((call) => call.credentialName === 'lifeSpaceAgentExecutionApi');
  const core = execution.calls.filter((call) => call.transport === 'direct');
  assert.equal(identity.length, 1);
  assert.deepEqual(identity[0].options.body, {
    subjectId: 'usr_test',
    agentId: 'agt_test',
    scopes: ['resources:read', 'resources:write'],
  });
  assert.equal(core.length, 1);
  assert.equal(core[0].options.method, 'POST');
  assert.equal(core[0].options.url, `${CORE_BASE}/spaces/spc_test/models/batch`);
  assert.equal(core[0].options.headers.Authorization, 'Bearer agent.jwt.batch');
  assert.equal(core[0].options.headers['X-LifeSpace-Delegation-Id'], undefined);
  assert.deepEqual(core[0].options.body, { operations });
  assert.equal(
    execution.calls.some((call) => call.credentialName === 'lifeSpaceApi'),
    false,
  );
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
