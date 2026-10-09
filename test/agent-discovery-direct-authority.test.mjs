import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceAgentTool } = require('../dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js');

const CORE_BASE = 'https://core.example.com/api/v1';

function loadOptionsContext(readDelegationId = '') {
  const calls = [];
  const parameters = {
    readDelegationId,
    operation: 'query',
    spaceId: '',
    recordType: '',
  };

  return {
    calls,
    getCurrentNodeParameter(name) {
      return parameters[name];
    },
    getNodeParameter(name, defaultValue) {
      return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue;
    },
    getCredentials: async (name) => {
      assert.equal(name, 'lifeSpaceAgentExecutionApi');
      return {
        coreBaseUrl: CORE_BASE,
        agentSecret: 'lsp_agt_test',
      };
    },
    getNode: () => ({ name: 'LifeSpace Agent Tool', typeVersion: 1 }),
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ credentialName, options });
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        return {
          data: {
            semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
            models: [{
              key: 'task',
              version: 1,
              schemaHash: 'sha256:agent-discovery-test',
              display: { singular: 'Task', plural: 'Tasks' },
              capabilities: [],
              actions: [],
            }],
            spaces: [{
              spaceId: 'spc_test',
              spaceName: 'Test Space',
              models: [{ modelKey: 'task', access: ['read'] }],
            }],
          },
        };
      },
    },
  };
}

// Editor configuration happens before any User Authorization can produce a dlg_*.
// Every Discovery request in this context must therefore remain direct Agent execution.
async function assertDirectEditorDiscovery(readDelegationId = '') {
  const node = new LifeSpaceAgentTool();
  const context = loadOptionsContext(readDelegationId);

  const options = await node.methods.loadOptions.getSpaces.call(context);

  assert.deepEqual(options, [{ name: 'Test Space', value: 'spc_test' }]);
  assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0].options.method, 'GET');
  assert.equal(context.calls[0].options.url, `${CORE_BASE}/me/_discovery/inventory`);
  assert.equal(context.calls[0].options.headers?.['X-LifeSpace-Delegation-Id'], undefined);
}

test('Agent Tool configuration Discovery uses direct Agent authority without a Delegation', async () => {
  await assertDirectEditorDiscovery();
});

test('Agent Tool configuration Discovery never reuses a stale legacy read Delegation', async () => {
  await assertDirectEditorDiscovery('dlg_stale_legacy_value');
});
