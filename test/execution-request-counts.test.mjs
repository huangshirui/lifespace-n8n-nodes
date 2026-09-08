import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');
const { encodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');

const BASE_URL = 'https://example.invalid/api/v1';
const TASK_RECORD_TYPE = encodeRecordTypeSelector('task');

function actionDetail() {
  return {
    data: {
      key: 'task',
      version: 7,
      schemaHash: 'sha256:task-v7',
      display: { singular: 'Task', plural: 'Tasks' },
      description: 'Synthetic request-count contract.',
      declaredAccess: ['read', 'write'],
      fields: [{ key: 'name', type: 'string', required: true }],
      defaults: {},
      query: {
        searchable: ['name'],
        filterable: [],
        sortable: [],
        sort: {
          parameter: 'sort',
          syntax: 'field:direction',
          repeatable: true,
          ordered: true,
          maxCriteria: 8,
          genericDefault: ['createdAt:desc'],
          envelopeFields: ['createdAt', 'updatedAt'],
        },
      },
      actions: [{
        key: 'complete',
        access: 'write',
        kind: 'workflow',
        input: { fields: [] },
        concurrency: {
          strategy: 'record-version',
          required: true,
          transport: { in: 'body', name: 'version' },
        },
      }],
      capabilities: [],
      capabilityBindings: {},
    },
  };
}

function valueFor(parameters, name, itemIndex, defaultValue) {
  if (!Object.prototype.hasOwnProperty.call(parameters, name)) return defaultValue;
  const value = parameters[name];
  return typeof value === 'function' ? value(itemIndex) : value;
}

function executionContext(parameters, itemCount = 1) {
  const calls = [];
  return {
    calls,
    getInputData: () => Array.from({ length: itemCount }, () => ({ json: {} })),
    getCredentials: async () => ({ baseUrl: `${BASE_URL}/` }),
    getNodeParameter(name, itemIndex, defaultValue) {
      return valueFor(parameters, name, itemIndex, defaultValue);
    },
    getNode: () => ({ name: 'LifeSpace' }),
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        calls.push(options);
        if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/task`) return actionDetail();
        if (options.method === 'GET' && /\/spaces\/spc_test\/models\/task\/records\/rec_/u.test(options.url)) {
          return { data: { id: options.url.split('/').at(-1), version: 7 } };
        }
        if (options.method === 'GET' && options.url === `${BASE_URL}/spaces/spc_test/models/task/records`) {
          return { data: { items: [], nextCursor: null } };
        }
        if (options.method === 'POST' && options.url.endsWith('/actions/complete')) {
          return { data: { id: 'rec_action', version: 8, status: 'completed' } };
        }
        if (options.method === 'DELETE') return { data: { deleted: true } };
        return { data: { id: 'rec_result', version: 8 } };
      },
    },
  };
}

const common = {
  resource: 'modelRecord',
  spaceId: 'spc_test',
  recordType: TASK_RECORD_TYPE,
  'dateFields.date': [],
  'singleRelations.relation': [],
  'multiRelations.relation': [],
};

async function execute(parameters, itemCount = 1) {
  const node = new LifeSpace();
  const context = executionContext({ ...common, ...parameters }, itemCount);
  await node.execute.call(context);
  return context.calls;
}

function requestShape(calls) {
  return calls.map((call) => [call.method, call.url]);
}

test('Get is one business request and zero Discovery requests', async () => {
  const calls = await execute({ operation: 'get', recordId: 'rec_get' });
  assert.deepEqual(requestShape(calls), [
    ['GET', `${BASE_URL}/spaces/spc_test/models/task/records/rec_get`],
  ]);
});

test('List is one business request per page and zero Discovery requests', async () => {
  const calls = await execute({ operation: 'list', returnAll: false, limit: 10, search: '', options: {}, filters: {}, 'filters.filter': [], 'sorts.sort': [] });
  assert.deepEqual(requestShape(calls), [
    ['GET', `${BASE_URL}/spaces/spc_test/models/task/records`],
  ]);
});

test('Create is one business mutation and zero Discovery requests', async () => {
  const calls = await execute({ operation: 'create', 'fields.value': { name: 'Create' } });
  assert.deepEqual(requestShape(calls), [
    ['POST', `${BASE_URL}/spaces/spc_test/models/task/records`],
  ]);
});

test('legacy 0.1.3 modelRoute executes through the canonical modelKey path without Discovery', async () => {
  const calls = await execute({
    operation: 'create',
    recordType: '',
    modelRoute: 'tasks',
    'fields.value': { name: 'Legacy workflow' },
  });
  assert.deepEqual(requestShape(calls), [
    ['POST', `${BASE_URL}/spaces/spc_test/models/task/records`],
  ]);
});

test('Update with an explicit version is one business mutation and zero Discovery requests', async () => {
  const calls = await execute({
    operation: 'update',
    recordId: 'rec_update_explicit',
    mutationOptions: { version: 5 },
    'fields.value': { name: 'Update' },
  });
  assert.deepEqual(requestShape(calls), [
    ['PATCH', `${BASE_URL}/spaces/spc_test/models/task/records/rec_update_explicit`],
  ]);
  assert.equal(calls[0].body.version, 5);
});

test('Update without an explicit version performs only concurrency read plus mutation', async () => {
  const calls = await execute({
    operation: 'update',
    recordId: 'rec_update_auto',
    mutationOptions: {},
    'fields.value': { name: 'Update' },
  });
  assert.deepEqual(requestShape(calls), [
    ['GET', `${BASE_URL}/spaces/spc_test/models/task/records/rec_update_auto`],
    ['PATCH', `${BASE_URL}/spaces/spc_test/models/task/records/rec_update_auto`],
  ]);
});

test('Delete with an explicit version is one business mutation and zero Discovery requests', async () => {
  const calls = await execute({
    operation: 'delete',
    recordId: 'rec_delete_explicit',
    mutationOptions: { version: 5 },
  });
  assert.deepEqual(requestShape(calls), [
    ['DELETE', `${BASE_URL}/spaces/spc_test/models/task/records/rec_delete_explicit`],
  ]);
  assert.equal(calls[0].body.version, 5);
});

test('Delete without an explicit version performs only concurrency read plus mutation', async () => {
  const calls = await execute({
    operation: 'delete',
    recordId: 'rec_delete_auto',
    mutationOptions: {},
  });
  assert.deepEqual(requestShape(calls), [
    ['GET', `${BASE_URL}/spaces/spc_test/models/task/records/rec_delete_auto`],
    ['DELETE', `${BASE_URL}/spaces/spc_test/models/task/records/rec_delete_auto`],
  ]);
});

test('Execute Action uses selected static semantic detail, concurrency read, and action request only', async () => {
  const calls = await execute({
    operation: 'executeAction',
    recordId: 'rec_action',
    actionKey: 'complete',
    'actionInput.value': {},
  });
  assert.deepEqual(requestShape(calls), [
    ['GET', `${BASE_URL}/spaces/spc_test/_discovery/models/task`],
    ['GET', `${BASE_URL}/spaces/spc_test/models/task/records/rec_action`],
    ['POST', `${BASE_URL}/spaces/spc_test/models/task/records/rec_action/actions/complete`],
  ]);
});

test('per-item Record Type expressions do not introduce Discovery for CRUD execution', async () => {
  const calls = await execute({
    operation: 'create',
    recordType: () => TASK_RECORD_TYPE,
    'fields.value': (itemIndex) => ({ name: `Create ${itemIndex}` }),
  }, 2);
  assert.deepEqual(requestShape(calls), [
    ['POST', `${BASE_URL}/spaces/spc_test/models/task/records`],
    ['POST', `${BASE_URL}/spaces/spc_test/models/task/records`],
  ]);
});

test('same-model multi-item Action reuses static semantic detail once per node execution', async () => {
  const calls = await execute({
    operation: 'executeAction',
    recordId: (itemIndex) => `rec_action_${itemIndex + 1}`,
    actionKey: 'complete',
    'actionInput.value': {},
  }, 2);
  assert.deepEqual(requestShape(calls), [
    ['GET', `${BASE_URL}/spaces/spc_test/_discovery/models/task`],
    ['GET', `${BASE_URL}/spaces/spc_test/models/task/records/rec_action_1`],
    ['POST', `${BASE_URL}/spaces/spc_test/models/task/records/rec_action_1/actions/complete`],
    ['GET', `${BASE_URL}/spaces/spc_test/models/task/records/rec_action_2`],
    ['POST', `${BASE_URL}/spaces/spc_test/models/task/records/rec_action_2/actions/complete`],
  ]);
});
