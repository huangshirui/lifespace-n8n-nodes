import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');
const { encodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');
const BASE_URL = 'https://example.invalid/api/v1';
const RECORD_TYPE = encodeRecordTypeSelector('task');
const model = {
  key: 'task', version: 1, schemaHash: 'sha256:task', display: { singular: 'Task', plural: 'Tasks' }, description: 'Task', access: ['read', 'write'],
  fields: [{ key: 'name', type: 'string', title: 'Name', required: true }], defaults: {},
  query: { searchable: ['name'], filterable: [], sortable: [], sort: { parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8, default: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'] } },
  actions: [{ key: 'complete', access: 'write', kind: 'workflow', input: { fields: [] } }], capabilities: [], capabilityBindings: {},
};
const inventory = { data: {
  semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
  models: [{ key: 'task', version: 1, schemaHash: 'sha256:task', display: { singular: 'Task', plural: 'Tasks' }, capabilities: [], actions: [{ key: 'complete', access: 'write', kind: 'workflow' }] }],
  spaces: [{ spaceId: 'spc_test', spaceName: 'Test', models: [{ modelKey: 'task', access: ['read', 'write'] }] }],
} };
const detail = { data: {
  key: 'task', version: 1, schemaHash: 'sha256:task', display: { singular: 'Task', plural: 'Tasks' }, description: 'Task', declaredAccess: ['read', 'write'],
  fields: [{ key: 'name', type: 'string', title: 'Name', required: true }], defaults: {},
  query: { searchable: ['name'], filterable: [], sortable: [], sort: { parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8, genericDefault: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'] } },
  actions: [{ key: 'complete', access: 'write', kind: 'workflow', input: { fields: [] } }], capabilities: [], capabilityBindings: {},
} };
const aggregate = { data: { spaces: [{ spaceId: 'spc_test', spaceName: 'Test', models: [model] }] } };

function context(current, saved = current) {
  const calls = [];
  return {
    calls,
    getCredentials: async () => ({ baseUrl: `${BASE_URL}/` }),
    getNodeParameter(name, fallback) { return Object.prototype.hasOwnProperty.call(saved, name) ? saved[name] : fallback; },
    getCurrentNodeParameter(name) { return Object.prototype.hasOwnProperty.call(current, name) ? current[name] : undefined; },
    getCurrentNodeParameters() { return current; },
    getNode: () => ({ name: 'LifeSpace' }),
    helpers: { async httpRequestWithAuthentication(_credential, options) {
      calls.push(options);
      if (options.url === `${BASE_URL}/me/_discovery/inventory`) return inventory;
      if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/task`) return detail;
      if (options.url === `${BASE_URL}/me/_discovery`) return aggregate;
      throw new Error(`Unexpected request ${options.url}`);
    } },
  };
}

test('Fields and Actions use editor-current Record Type before save', async () => {
  const node = new LifeSpace();
  const current = { spaceId: 'spc_test', recordType: RECORD_TYPE, operation: 'create' };
  const saved = { spaceId: 'spc_test', operation: 'create' };
  const fieldsContext = context(current, saved);
  const fields = await node.methods.resourceMapping.getRecordFields.call(fieldsContext);
  assert.deepEqual(fields.fields.map((field) => field.id), ['name']);
  assert.deepEqual(fieldsContext.calls.map((call) => call.url), [`${BASE_URL}/me/_discovery/inventory`, `${BASE_URL}/spaces/spc_test/_discovery/models/task`]);
  const actions = await node.methods.loadOptions.getActions.call(context(current, saved));
  assert.deepEqual(actions.map((entry) => entry.value), ['complete']);
});

test('Empty editor-current Record Type does not reuse stale saved selection', async () => {
  const node = new LifeSpace();
  const c = context({ spaceId: 'spc_test', recordType: '', operation: 'create' }, { spaceId: 'spc_test', recordType: RECORD_TYPE, operation: 'create' });
  const fields = await node.methods.resourceMapping.getRecordFields.call(c);
  assert.deepEqual(fields.fields, []);
  assert.deepEqual(c.calls, []);
});

test('Legacy 0.1.3 modelRoute still loads design-time fields', async () => {
  const node = new LifeSpace();
  const c = context({ spaceId: 'spc_test', modelRoute: 'tasks', operation: 'create' });
  const fields = await node.methods.resourceMapping.getRecordFields.call(c);
  assert.deepEqual(fields.fields.map((field) => field.id), ['name']);
  assert.deepEqual(c.calls.map((call) => call.url), [`${BASE_URL}/me/_discovery`]);
});

