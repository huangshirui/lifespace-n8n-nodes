import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');
const { LifeSpaceTrigger } = require('../dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js');

const BASE_URL = 'https://example.invalid/api/v1/spaces/spc_test';

function discoveryFixture({ legacyAction = false } = {}) {
  return {
    data: {
      spaceId: 'spc_test',
      models: [
        {
          key: 'task',
          route: 'tasks',
          version: 3,
          schemaHash: 'sha256:test-task',
          display: { singular: 'Task', plural: 'Tasks' },
          description: 'Synthetic task model used only by adapter tests.',
          access: ['read', 'write'],
          fields: [
            { key: 'name', type: 'string', required: true },
            { key: 'status', type: 'enum', readOnly: true, values: ['pending', 'completed'] },
            { key: 'dueDate', type: 'date', nullable: true },
          ],
          query: {
            searchable: ['name'],
            filterable: ['status', 'dueDate'],
            sortable: ['dueDate'],
          },
          actions: [
            legacyAction
              ? {
                  key: 'complete',
                  access: 'write',
                  kind: 'workflow',
                  input: {
                    fields: [
                      {
                        key: 'version',
                        type: 'integer',
                        required: true,
                      },
                    ],
                  },
                }
              : {
                  key: 'complete',
                  access: 'write',
                  kind: 'workflow',
                  input: { fields: [] },
                  concurrency: {
                    strategy: 'record-version',
                    required: true,
                    transport: { in: 'body', name: 'version' },
                  },
                },
          ],
        },
        {
          key: 'note',
          route: 'notes',
          version: 1,
          schemaHash: 'sha256:test-note',
          display: { singular: 'Note', plural: 'Notes' },
          description: null,
          access: ['read'],
          fields: [{ key: 'text', type: 'text', required: true }],
          query: { searchable: ['text'], filterable: [], sortable: [] },
          actions: [],
        },
      ],
    },
  };
}

function parameterReader(parameters) {
  return (name, _itemIndexOrDefault, explicitDefault) => {
    if (Object.prototype.hasOwnProperty.call(parameters, name)) return parameters[name];
    if (arguments.length >= 3) return explicitDefault;
    return _itemIndexOrDefault;
  };
}

function loadOptionsContext(discovery, parameters = {}) {
  return {
    getCredentials: async () => ({ baseUrl: `${BASE_URL}/` }),
    getNodeParameter(name, defaultValue) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        assert.equal(options.method, 'GET');
        assert.equal(options.url, `${BASE_URL}/_discovery`);
        return discovery;
      },
    },
  };
}

function executeContext(parameters, responder) {
  const calls = [];
  return {
    calls,
    getInputData: () => [{ json: {} }],
    getCredentials: async () => ({ baseUrl: `${BASE_URL}/` }),
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ credentialName, options });
        return responder(options, calls.length - 1);
      },
    },
  };
}

function responseRecorder() {
  const state = { statusCode: null, body: null, ended: false };
  const response = {
    status(code) {
      state.statusCode = code;
      return response;
    },
    send(body) {
      state.body = body;
      return response;
    },
    end() {
      state.ended = true;
      return response;
    },
  };
  return { state, response };
}

test('Runtime Discovery drives model selection instead of adapter-owned model copies', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture();

  const createModels = await node.methods.loadOptions.getModels.call(
    loadOptionsContext(discovery, { operation: 'create' }),
  );
  assert.deepEqual(createModels.map((item) => item.value), ['tasks']);

  const actionModels = await node.methods.loadOptions.getModels.call(
    loadOptionsContext(discovery, { operation: 'executeAction' }),
  );
  assert.deepEqual(actionModels.map((item) => item.value), ['tasks']);
});

test('Action Input contains semantic fields only when Discovery separates concurrency metadata', async () => {
  const node = new LifeSpace();
  const fields = await node.methods.resourceMapping.getActionInputFields.call(
    loadOptionsContext(discoveryFixture(), { modelRoute: 'tasks', actionKey: 'complete' }),
  );

  assert.deepEqual(fields, { fields: [] });
});

test('Create sends only mapped semantic fields and leaves model defaults authoritative in LifeSpace', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'create',
      modelRoute: 'tasks',
      'fields.value': { name: 'Buy milk' },
    },
    () => ({ data: { id: 'tsk_created', name: 'Buy milk', status: 'pending', version: 1 } }),
  );

  await node.execute.call(context);

  assert.equal(context.calls.length, 1);
  assert.deepEqual(context.calls[0].options, {
    method: 'POST',
    url: `${BASE_URL}/tasks`,
    body: { name: 'Buy milk' },
    json: true,
  });
});

test('List passes generic search, filter, sort, limit and cursor pagination to LifeSpace', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'list',
      modelRoute: 'tasks',
      search: 'milk',
      sortField: 'dueDate',
      sortDirection: 'asc',
      cursor: 'cur_test_next',
      limit: 25,
      'filters.filter': [
        { field: 'status', operator: 'exact', value: 'pending' },
        { field: 'dueDate', operator: 'from', value: '2026-09-01' },
      ],
    },
    () => ({ data: { items: [], nextCursor: 'cur_test_after' } }),
  );

  await node.execute.call(context);

  assert.equal(context.calls.length, 1);
  assert.deepEqual(context.calls[0].options, {
    method: 'GET',
    url: `${BASE_URL}/tasks`,
    qs: {
      q: 'milk',
      sort: 'dueDate:asc',
      limit: 25,
      cursor: 'cur_test_next',
      status: 'pending',
      dueDateFrom: '2026-09-01',
    },
    json: true,
  });
});

test('Execute Action resolves record-version concurrency from Discovery without exposing it as semantic input', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'executeAction',
      modelRoute: 'tasks',
      recordId: 'tsk_test',
      actionKey: 'complete',
      'actionInput.value': {},
    },
    (options) => {
      if (options.url.endsWith('/_discovery')) return discovery;
      if (options.method === 'GET' && options.url.endsWith('/tasks/tsk_test')) {
        return { data: { id: 'tsk_test', version: 7 } };
      }
      if (options.method === 'POST' && options.url.endsWith('/tasks/tsk_test/actions/complete')) {
        return { data: { id: 'tsk_test', status: 'completed', version: 8 } };
      }
      throw new Error(`Unexpected request: ${options.method} ${options.url}`);
    },
  );

  await node.execute.call(context);

  assert.equal(context.calls.length, 3);
  assert.deepEqual(context.calls.map((call) => [call.options.method, call.options.url]), [
    ['GET', `${BASE_URL}/_discovery`],
    ['GET', `${BASE_URL}/tasks/tsk_test`],
    ['POST', `${BASE_URL}/tasks/tsk_test/actions/complete`],
  ]);
  assert.deepEqual(context.calls[2].options.body, { version: 7 });
});

test('Execute Action preserves compatibility with legacy Discovery that carried version in Action Input', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture({ legacyAction: true });
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'executeAction',
      modelRoute: 'tasks',
      recordId: 'tsk_legacy',
      actionKey: 'complete',
      'actionInput.value': { version: 4 },
    },
    (options) => {
      if (options.url.endsWith('/_discovery')) return discovery;
      if (options.method === 'POST' && options.url.endsWith('/tasks/tsk_legacy/actions/complete')) {
        return { data: { id: 'tsk_legacy', status: 'completed', version: 5 } };
      }
      throw new Error(`Unexpected request: ${options.method} ${options.url}`);
    },
  );

  await node.execute.call(context);

  assert.equal(context.calls.length, 2);
  assert.deepEqual(context.calls[1].options.body, { version: 4 });
});

test('LifeSpace Trigger accepts a correctly signed model-agnostic domain event', async () => {
  const node = new LifeSpaceTrigger();
  const body = {
    id: 'evt_test',
    type: 'record.updated',
    spaceId: 'spc_test',
    modelKey: 'task',
    recordId: 'tsk_test',
  };
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signingSecret = 'a'.repeat(64);
  const signature = createHmac('sha256', signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const { state, response } = responseRecorder();

  const result = await node.webhook.call({
    getRequestObject: () => ({ rawBody }),
    getHeaderData: () => ({
      'x-lifespace-timestamp': timestamp,
      'x-lifespace-signature': `v1=${signature}`,
    }),
    getResponseObject: () => response,
    getCredentials: async () => ({ signingSecret }),
    getBodyData: () => body,
    getNodeParameter(name, defaultValue) {
      const parameters = {
        eventTypes: ['record.created', 'record.updated', 'record.deleted'],
        expectedSpaceId: 'spc_test',
        expectedModelKey: 'task',
      };
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    helpers: {
      returnJsonArray: (value) => [{ json: value }],
    },
  });

  assert.equal(state.statusCode, null);
  assert.deepEqual(result.workflowData, [[{ json: body }]]);
});

test('LifeSpace Trigger denies a webhook with an invalid signature', async () => {
  const node = new LifeSpaceTrigger();
  const rawBody = JSON.stringify({ type: 'record.updated', spaceId: 'spc_test', modelKey: 'task' });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const { state, response } = responseRecorder();

  const result = await node.webhook.call({
    getRequestObject: () => ({ rawBody }),
    getHeaderData: () => ({
      'x-lifespace-timestamp': timestamp,
      'x-lifespace-signature': `v1=${'0'.repeat(64)}`,
    }),
    getResponseObject: () => response,
    getCredentials: async () => ({ signingSecret: 'a'.repeat(64) }),
    getBodyData: () => ({ type: 'record.updated', spaceId: 'spc_test', modelKey: 'task' }),
    getNodeParameter: () => [],
    helpers: {
      returnJsonArray: (value) => [{ json: value }],
    },
  });

  assert.deepEqual(result, { noWebhookResponse: true });
  assert.equal(state.statusCode, 401);
  assert.equal(state.body, 'Unauthorized');
  assert.equal(state.ended, true);
});
