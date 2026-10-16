import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflowCompat } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflowCompat.node.js');

const BASE_URL = 'https://example.invalid/api/v1';
const inventory = {
  data: {
    semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
    models: [
      {
        key: 'task',
        version: 7,
        schemaHash: 'sha256:task-v7',
        display: { singular: 'Task', plural: 'Tasks' },
        capabilities: [],
        actions: [],
      },
      {
        key: 'notion_page',
        origin: 'external',
        spaceId: 'spc_test',
        schemaHash: 'sha256:notion-page',
        display: { singular: 'Notion Page', plural: 'Notion Pages' },
        runtimeCapabilities: { get: true, query: true, create: false, update: false, delete: false },
        contract: { kind: 'dynamic', revision: null },
      },
    ],
    spaces: [
      {
        spaceId: 'spc_test',
        spaceName: 'Test Space',
        models: [
          { modelKey: 'task', access: ['read'] },
          { modelKey: 'notion_page', access: ['read'] },
        ],
      },
    ],
  },
};

function context(parameters = {}) {
  const calls = [];
  return {
    calls,
    getCredentials: async () => ({ baseUrl: BASE_URL }),
    getCurrentNodeParameter(name) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : undefined;
    },
    getNodeParameter(name, fallback) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : fallback;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        calls.push(options);
        if (options.url === `${BASE_URL}/me/_discovery/inventory`) return structuredClone(inventory);
        throw new Error(`Unexpected request ${options.method} ${options.url}`);
      },
    },
  };
}

test('Space selector survives External models while n8n dynamic contracts are not yet supported', async () => {
  const node = new LifeSpaceWorkflowCompat();
  const current = context();

  const spaces = await node.methods.loadOptions.getSpaces.call(current);

  assert.deepEqual(spaces, [{
    name: 'Test Space',
    value: 'spc_test',
    description: 'spc_test · 1 available Record Type',
  }]);
  assert.deepEqual(current.calls.map((call) => call.url), [`${BASE_URL}/me/_discovery/inventory`]);
});

test('Record Type selector advertises only supported Native models from mixed inventory', async () => {
  const node = new LifeSpaceWorkflowCompat();
  const current = context({ spaceId: 'spc_test', operation: 'list' });

  const recordTypes = await node.methods.loadOptions.getRecordTypes.call(current);

  assert.deepEqual(recordTypes.map((item) => [item.name, item.value]), [['Tasks (task)', 'task']]);
  assert.deepEqual(current.calls.map((call) => call.url), [`${BASE_URL}/me/_discovery/inventory`]);
});
