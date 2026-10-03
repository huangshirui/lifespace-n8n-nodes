import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceDelegation } = require('../dist/nodes/LifeSpaceDelegation/LifeSpaceDelegation.node.js');

const CORE_BASE = 'https://core.example.com/api/v1';
const IDENTITY_BASE = 'https://identity.example.com';

function context(inputData, parameters) {
  const calls = [];
  return {
    calls,
    getInputData: () => inputData,
    getCredentials: async (name) => {
      assert.equal(name, 'lifeSpaceAgentExecutionApi');
      return {
        coreBaseUrl: CORE_BASE,
        identityBaseUrl: IDENTITY_BASE,
        applicationSecret: 'lsa_test',
        agentId: 'agt_homemew',
      };
    },
    getNodeParameter(name, itemIndex, defaultValue) {
      const value = parameters[name];
      if (value === undefined) return defaultValue;
      return typeof value === 'function' ? value(itemIndex) : value;
    },
    getNode: () => ({ name: 'LifeSpace Delegation', typeVersion: 1 }),
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ transport: 'credential', credentialName, options });
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        assert.equal(options.method, 'POST');
        assert.equal(options.url, `${IDENTITY_BASE}/internal/v1/tokens`);
        assert.deepEqual(options.body, {
          subjectId: 'usr_test',
          scopes: ['resources:write'],
        });
        return { data: { accessToken: 'user.jwt.test' } };
      },
      async httpRequest(options) {
        calls.push({ transport: 'direct', options });
        const index = calls.filter((call) => call.transport === 'direct').length - 1;
        return {
          data: {
            id: index === 0 ? 'dlg_one' : 'dlg_two',
            principal: { type: 'user', id: 'usr_test' },
            actor: { type: 'agent', id: 'agt_homemew' },
          },
        };
      },
    },
  };
}

test('confirmed authorization creates one Root Delegation per input item and reuses the User token', async () => {
  const execution = context(
    [{ json: { request: 1 } }, { json: { request: 2 } }],
    {
      principalUserId: 'usr_test',
      spaceId: 'spc_test',
      targetType: 'model',
      targetId: (itemIndex) => itemIndex === 0 ? 'event' : 'task',
      maxAccess: 'write',
      singleUse: (itemIndex) => itemIndex === 0,
      options: {},
    },
  );

  const [output] = await new LifeSpaceDelegation().execute.call(execution);

  const identity = execution.calls.filter((call) => call.transport === 'credential');
  const core = execution.calls.filter((call) => call.transport === 'direct');
  assert.equal(identity.length, 1, 'same Principal + scope set should reuse one short-lived User token');
  assert.equal(core.length, 2);

  assert.deepEqual(core[0].options, {
    method: 'POST',
    url: `${CORE_BASE}/spaces/spc_test/delegations`,
    headers: { Authorization: 'Bearer user.jwt.test' },
    body: {
      actor: { type: 'agent', id: 'agt_homemew' },
      scope: {
        target: { type: 'model', id: 'event' },
        maxAccess: 'write',
      },
      constraints: { maxUses: 1 },
    },
    json: true,
  });
  assert.deepEqual(core[1].options.body, {
    actor: { type: 'agent', id: 'agt_homemew' },
    scope: {
      target: { type: 'model', id: 'task' },
      maxAccess: 'write',
    },
  });

  assert.deepEqual(output.map((item) => item.pairedItem), [{ item: 0 }, { item: 1 }]);
  assert.deepEqual(output.map((item) => item.json.data.id), ['dlg_one', 'dlg_two']);
});

test('Space target must equal route Space and fails before any network call', async () => {
  const execution = context(
    [{ json: {} }],
    {
      principalUserId: 'usr_test',
      spaceId: 'spc_one',
      targetType: 'space',
      targetId: 'spc_two',
      maxAccess: 'write',
      singleUse: true,
      options: {},
    },
  );

  await assert.rejects(
    () => new LifeSpaceDelegation().execute.call(execution),
    /must equal Space ID/u,
  );
  assert.equal(execution.calls.length, 0);
});

test('Free / Busy is rejected for Model and Record Delegation before any network call', async () => {
  const execution = context(
    [{ json: {} }],
    {
      principalUserId: 'usr_test',
      spaceId: 'spc_test',
      targetType: 'model',
      targetId: 'event',
      maxAccess: 'free_busy',
      singleUse: true,
      options: {},
    },
  );

  await assert.rejects(
    () => new LifeSpaceDelegation().execute.call(execution),
    /valid only for a Space-scoped Delegation/u,
  );
  assert.equal(execution.calls.length, 0);
});
