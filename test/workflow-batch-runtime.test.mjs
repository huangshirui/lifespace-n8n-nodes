import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');

const CORE = 'https://core.example.com/api/v1';
const IDENTITY = 'https://identity.example.com';

function context(parameters) {
  const calls = [];
  return {
    calls,
    getInputData: () => [{ json: {} }],
    getCredentials: async (name) => name === 'lifeSpaceApi'
      ? { baseUrl: CORE, token: 'lsp_pat_test' }
      : { identityBaseUrl: IDENTITY, applicationCredential: 'lsa_test', agentId: 'agt_workflow' },
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace Workflow', typeVersion: 1 }),
    getTimezone: () => 'Asia/Shanghai',
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(name, options) {
        calls.push({ transport: 'credential', name, options });
        if (name === 'lifeSpaceAgentExecution') {
          return {
            data: {
              accessToken: 'agent.workflow.jwt',
              principalId: 'usr_workflow',
              actor: { type: 'agent', id: 'agt_workflow' },
              applicationId: 'app_workflow',
            },
          };
        }
        return {
          data: {
            changeSetId: 'cgs_service',
            items: [{ index: 0, operation: 'create', modelKey: 'task', recordId: 'rec_1', version: 1 }],
          },
        };
      },
      async httpRequest(options) {
        calls.push({ transport: 'direct', options });
        return {
          data: {
            changeSetId: 'cgs_agent',
            items: [
              { index: 0, operation: 'create', modelKey: 'task', recordId: 'rec_2', version: 1 },
              { index: 1, operation: 'delete', modelKey: 'event', recordId: 'rec_old', version: 4 },
            ],
          },
        };
      },
    },
  };
}

test('Workflow Service Batch uses one Core mutation request', async () => {
  const execution = context({
    resource: 'batchMutation',
    batchAuthorityMode: 'service',
    spaceId: 'spc_test',
    batchOperations: [
      { operation: 'create', modelKey: 'task', data: { name: 'One' } },
    ],
  });

  const result = await new LifeSpaceWorkflow().execute.call(execution);
  const coreCalls = execution.calls.filter((call) => call.name === 'lifeSpaceApi');
  assert.equal(coreCalls.length, 1);
  assert.equal(coreCalls[0].options.url, `${CORE}/spaces/spc_test/models/batch`);
  assert.deepEqual(coreCalls[0].options.body, {
    operations: [{ operation: 'create', modelKey: 'task', data: { name: 'One' } }],
  });
  assert.equal(result[0][0].json.data.changeSetId, 'cgs_service');
});

test('Workflow delegated Batch mints one Agent token and sends per-item selectors in one Core mutation', async () => {
  const execution = context({
    resource: 'batchMutation',
    batchAuthorityMode: 'delegatedAgent',
    batchPrincipalUserId: 'usr_workflow',
    spaceId: 'spc_test',
    batchOperations: [
      { operation: 'create', modelKey: 'task', delegationId: 'dlg_create', data: { name: 'One' } },
      { operation: 'delete', modelKey: 'event', delegationId: 'dlg_delete', recordId: 'rec_old', version: 3 },
    ],
  });

  const result = await new LifeSpaceWorkflow().execute.call(execution);
  const identityCalls = execution.calls.filter((call) => call.name === 'lifeSpaceAgentExecution');
  const coreCalls = execution.calls.filter((call) => call.transport === 'direct');
  assert.equal(identityCalls.length, 1);
  assert.deepEqual(identityCalls[0].options.body, {
    subjectId: 'usr_workflow',
    agentId: 'agt_workflow',
    scopes: ['resources:read', 'resources:write'],
  });
  assert.equal(coreCalls.length, 1);
  assert.equal(coreCalls[0].options.url, `${CORE}/spaces/spc_test/models/batch`);
  assert.equal(coreCalls[0].options.headers.Authorization, 'Bearer agent.workflow.jwt');
  assert.equal(coreCalls[0].options.headers['X-LifeSpace-Delegation-Id'], undefined);
  assert.deepEqual(coreCalls[0].options.body.operations.map((operation) => operation.delegationId), [
    'dlg_create',
    'dlg_delete',
  ]);
  assert.equal(result[0][0].json.data.changeSetId, 'cgs_agent');
});
