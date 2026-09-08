import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');
const { LifeSpaceTrigger } = require('../dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js');
const { decodeRecordTypeSelector, encodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');

const TASK_RECORD_TYPE = encodeRecordTypeSelector('task');
const NOTE_RECORD_TYPE = encodeRecordTypeSelector('note');

const BASE_URL = 'https://example.invalid/api/v1';

function discoveryFixture({ legacyAction = false } = {}) {
  return {
    data: {
      spaces: [
        {
          spaceId: 'spc_test',
          spaceName: 'Test Space',
          models: [
            {
              key: 'task',
              version: 4,
              schemaHash: 'sha256:test-task',
              display: { singular: 'Task', plural: 'Tasks' },
              description: 'Synthetic task model used only by adapter tests.',
              access: ['read', 'write'],
              fields: [
                { key: 'name', type: 'string', required: true },
                { key: 'priority', type: 'enum', required: true, values: ['normal', 'high'] },
                { key: 'status', type: 'enum', required: true, readOnly: true, values: ['pending', 'completed'] },
                { key: 'dueDate', type: 'date', nullable: true },
              ],
              defaults: {
                priority: 'normal',
                status: 'pending',
              },
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
              version: 1,
              schemaHash: 'sha256:test-note',
              display: { singular: 'Note', plural: 'Notes' },
              description: null,
              access: ['read'],
              fields: [{ key: 'text', type: 'text', required: true }],
              defaults: {},
              query: { searchable: ['text'], filterable: [], sortable: [] },
              actions: [],
            },
          ],
        },
        {
          spaceId: 'spc_read_only',
          models: [
            {
              key: 'note',
              version: 1,
              schemaHash: 'sha256:test-note',
              display: { singular: 'Note', plural: 'Notes' },
              description: null,
              access: ['read'],
              fields: [{ key: 'text', type: 'text', required: true }],
              defaults: {},
              query: { searchable: ['text'], filterable: [], sortable: [] },
              actions: [],
            },
          ],
        },
      ],
    },
  };
}

function semanticDetailFixture({ legacyAction = false } = {}) {
  const model = discoveryFixture({ legacyAction }).data.spaces[0].models[0];
  return {
    data: {
      key: model.key,
      version: model.version,
      schemaHash: model.schemaHash,
      display: model.display,
      description: model.description,
      declaredAccess: model.access,
      fields: model.fields,
      defaults: model.defaults,
      query: {
        searchable: model.query.searchable,
        filterable: model.query.filterable,
        sortable: model.query.sortable,
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
      actions: model.actions,
      capabilities: [],
      capabilityBindings: {},
    },
  };
}

function loadOptionsContext(discovery, parameters = {}) {
  return {
    getCredentials: async () => ({ baseUrl: `${BASE_URL}/` }),
    getNodeParameter(name, defaultValue) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    getCurrentNodeParameter(name) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : undefined;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        assert.equal(options.method, 'GET');
        assert.equal(options.url, `${BASE_URL}/me/_discovery`);
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
        if (options.url === `${BASE_URL}/me/_discovery/inventory`) {
          throw new Error('Synthetic legacy Core has no progressive inventory');
        }
        if (options.url === `${BASE_URL}/me/_discovery` && parameters.operation !== 'executeAction') {
          return discoveryFixture();
        }
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

test('Runtime Discovery drives Space and Record Type selection', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture();

  const spaces = await node.methods.loadOptions.getSpaces.call(loadOptionsContext(discovery));
  assert.deepEqual(spaces.map((item) => [item.name, item.value]), [
    ['Test Space', 'spc_test'],
    ['spc_read_only', 'spc_read_only'],
  ]);

  const createRecordTypes = await node.methods.loadOptions.getRecordTypes.call(
    loadOptionsContext(discovery, { spaceId: 'spc_test', operation: 'create' }),
  );
  assert.deepEqual(createRecordTypes.map((item) => decodeRecordTypeSelector(item.value)), [
    { modelKey: 'task' },
  ]);

  const listRecordTypes = await node.methods.loadOptions.getRecordTypes.call(
    loadOptionsContext(discovery, { spaceId: 'spc_test', operation: 'list' }),
  );
  assert.deepEqual(listRecordTypes.map((item) => decodeRecordTypeSelector(item.value)), [
    { modelKey: 'task' },
    { modelKey: 'note' },
  ]);
});

test('Create field mapping respects LifeSpace server defaults and Mutation Authority', async () => {
  const node = new LifeSpace();
  const fields = await node.methods.resourceMapping.getRecordFields.call(
    loadOptionsContext(discoveryFixture(), {
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      operation: 'create',
    }),
  );

  assert.deepEqual(fields.fields.map((field) => [field.id, field.required]), [
    ['name', true],
    ['priority', false],
  ]);

  const dates = await node.methods.loadOptions.getWritableDateFields.call(
    loadOptionsContext(discoveryFixture(), { spaceId: 'spc_test', recordType: TASK_RECORD_TYPE, operation: 'create' }),
  );
  assert.deepEqual(dates.map((field) => field.value), ['dueDate']);
});

test('Action Input contains semantic fields only when Discovery separates concurrency metadata', async () => {
  const node = new LifeSpace();
  const fields = await node.methods.resourceMapping.getActionInputFields.call(
    loadOptionsContext(discoveryFixture(), {
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      actionKey: 'complete',
    }),
  );

  assert.deepEqual(fields, { fields: [] });
});

test('Create sends only mapped semantic fields and leaves defaults authoritative in LifeSpace', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'create',
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      'fields.value': { name: 'Buy milk' },
    },
    () => ({ data: { id: 'tsk_created', name: 'Buy milk', priority: 'normal', status: 'pending', version: 1 } }),
  );

  await node.execute.call(context);

  assert.equal(context.calls.length, 1);
  assert.deepEqual(context.calls[0].options, {
    method: 'POST',
    url: `${BASE_URL}/spaces/spc_test/models/task/records`,
    body: { name: 'Buy milk' },
    json: true,
  });
});

test('List omits sort and cursor unless the user configures them', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'list',
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      search: 'milk',
      returnAll: false,
      limit: 25,
      options: {},
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
    url: `${BASE_URL}/spaces/spc_test/models/task/records`,
    qs: {
      q: 'milk',
      limit: 25,
      status: 'pending',
      dueDateFrom: '2026-09-01',
    },
    json: true,
  });
});

test('Typed filters serialize enum, boolean, number and calendar-date values through the Generic Query contract', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture();
  const task = discovery.data.spaces[0].models[0];
  task.fields.push({ key: 'flagged', type: 'boolean', title: 'Flagged' }, { key: 'score', type: 'number', title: 'Score' });
  task.query.filterable.push('flagged', 'score');
  const context = executeContext(
    {
      resource: 'modelRecord', operation: 'list', spaceId: 'spc_test', recordType: TASK_RECORD_TYPE, search: '',
      returnAll: false, limit: 10, options: {}, 'filters.filter': [],
      filters: {
        enum: [{ field: 'status', values: ['pending', 'completed'] }],
        boolean: [{ field: 'flagged', value: false }],
        number: [{ field: 'score', operator: 'from', value: 3.5 }],
        temporal: [{ field: 'date:dueDate', operator: 'to', value: '2026-09-30T00:00:00.000+08:00' }],
      },
    },
    () => ({ data: { items: [], nextCursor: null } }),
  );
  await node.execute.call(context);
  assert.deepEqual(context.calls[0].options.qs, {
    limit: 10, status: 'pending,completed', flagged: 'false', scoreFrom: 3.5, dueDateTo: '2026-09-30',
  });
});

test('Return All follows LifeSpace nextCursor automatically', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'list',
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      search: '',
      returnAll: true,
      options: { sortField: 'dueDate', sortDirection: 'asc' },
      'filters.filter': [],
    },
    (_options, callIndex) => callIndex === 0
      ? { data: { items: [{ id: 'tsk_1' }], nextCursor: 'cur_2' } }
      : { data: { items: [{ id: 'tsk_2' }], nextCursor: null } },
  );

  const result = await node.execute.call(context);

  assert.equal(context.calls.length, 2);
  assert.deepEqual(context.calls[0].options.qs, {
    sort: 'dueDate:asc',
    limit: 200,
  });
  assert.deepEqual(context.calls[1].options.qs, {
    sort: 'dueDate:asc',
    limit: 200,
    cursor: 'cur_2',
  });
  assert.deepEqual(result[0][0].json, {
    data: {
      items: [{ id: 'tsk_1' }, { id: 'tsk_2' }],
      nextCursor: null,
    },
  });
});

test('LifeSpace 0.22 field titles and sortable envelope metadata drive generated labels', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture();
  const task = discovery.data.spaces[0].models[0];
  task.fields.find((field) => field.key === 'name').title = 'Task Name';
  task.fields.find((field) => field.key === 'dueDate').title = 'Due Date';
  task.query.sortable = ['dueDate', 'name'];
  task.query.sort = {
    parameter: 'sort',
    syntax: 'field:direction',
    repeatable: true,
    ordered: true,
    maxCriteria: 8,
    default: ['createdAt:desc'],
    envelopeFields: ['createdAt', 'updatedAt'],
  };

  const fields = await node.methods.resourceMapping.getRecordFields.call(
    loadOptionsContext(discovery, { spaceId: 'spc_test', recordType: TASK_RECORD_TYPE, operation: 'create' }),
  );
  assert.equal(fields.fields.find((field) => field.id === 'name').displayName, 'Task Name');

  const sorts = await node.methods.loadOptions.getSortableFields.call(
    loadOptionsContext(discovery, { spaceId: 'spc_test', recordType: TASK_RECORD_TYPE }),
  );
  assert.deepEqual(sorts.map((item) => [item.name, item.value]), [
    ['Created At', 'createdAt'],
    ['Updated At', 'updatedAt'],
    ['Due Date', 'dueDate'],
    ['Task Name', 'name'],
  ]);
});

test('List sends ordered LifeSpace 0.22 multi-sort as repeated query parameters', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'list',
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      search: '',
      returnAll: false,
      limit: 25,
      'sorts.sort': [
        { field: 'dueDate', direction: 'asc' },
        { field: 'name', direction: 'desc' },
      ],
      options: {},
      'filters.filter': [],
    },
    () => ({ data: { items: [], nextCursor: null } }),
  );

  await node.execute.call(context);
  assert.deepEqual(context.calls[0].options.qs.sort, ['dueDate:asc', 'name:desc']);
  assert.equal(context.calls[0].options.arrayFormat, 'repeat');
});

test('Update fetches current version by default and sends it with the mutation', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'update',
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      recordId: 'tsk_test',
      mutationOptions: {},
      'fields.value': { name: 'Updated' },
    },
    (options) => {
      if (options.method === 'GET') return { data: { id: 'tsk_test', version: 7 } };
      return { data: { id: 'tsk_test', name: 'Updated', version: 8 } };
    },
  );

  await node.execute.call(context);

  assert.deepEqual(context.calls.map((call) => [call.options.method, call.options.url]), [
    ['GET', `${BASE_URL}/spaces/spc_test/models/task/records/tsk_test`],
    ['PATCH', `${BASE_URL}/spaces/spc_test/models/task/records/tsk_test`],
  ]);
  assert.deepEqual(context.calls[1].options.body, { name: 'Updated', version: 7 });
});

test('Update accepts an explicit advanced version without an extra read', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'update',
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      recordId: 'tsk_test',
      mutationOptions: { version: 5 },
      'fields.value': { name: 'Updated' },
    },
    () => ({ data: { id: 'tsk_test', name: 'Updated', version: 6 } }),
  );

  await node.execute.call(context);

  assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0].options.method, 'PATCH');
  assert.deepEqual(context.calls[0].options.body, { name: 'Updated', version: 5 });
});

test('Execute Action resolves record-version concurrency from selected-model semantic detail', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'executeAction',
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      recordId: 'tsk_test',
      actionKey: 'complete',
      'actionInput.value': {},
    },
    (options) => {
      if (options.url.endsWith('/spaces/spc_test/_discovery/models/task')) return semanticDetailFixture();
      if (options.method === 'GET' && options.url.endsWith('/models/task/records/tsk_test')) {
        return { data: { id: 'tsk_test', version: 7 } };
      }
      if (options.method === 'POST' && options.url.endsWith('/models/task/records/tsk_test/actions/complete')) {
        return { data: { id: 'tsk_test', status: 'completed', version: 8 } };
      }
      throw new Error(`Unexpected request: ${options.method} ${options.url}`);
    },
  );

  await node.execute.call(context);

  assert.equal(context.calls.length, 3);
  assert.deepEqual(context.calls.map((call) => [call.options.method, call.options.url]), [
    ['GET', `${BASE_URL}/spaces/spc_test/_discovery/models/task`],
    ['GET', `${BASE_URL}/spaces/spc_test/models/task/records/tsk_test`],
    ['POST', `${BASE_URL}/spaces/spc_test/models/task/records/tsk_test/actions/complete`],
  ]);
  assert.deepEqual(context.calls[2].options.body, { version: 7 });
});

test('Execute Action preserves compatibility when semantic detail still carries version as semantic input', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'executeAction',
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      recordId: 'tsk_legacy',
      actionKey: 'complete',
      'actionInput.value': { version: 4 },
    },
    (options) => {
      if (options.url.endsWith('/spaces/spc_test/_discovery/models/task')) return semanticDetailFixture({ legacyAction: true });
      if (options.method === 'POST' && options.url.endsWith('/models/task/records/tsk_legacy/actions/complete')) {
        return { data: { id: 'tsk_legacy', status: 'completed', version: 5 } };
      }
      throw new Error(`Unexpected request: ${options.method} ${options.url}`);
    },
  );

  await node.execute.call(context);

  assert.equal(context.calls.length, 2);
  assert.deepEqual(context.calls.map((call) => [call.options.method, call.options.url]), [
    ['GET', `${BASE_URL}/spaces/spc_test/_discovery/models/task`],
    ['POST', `${BASE_URL}/spaces/spc_test/models/task/records/tsk_legacy/actions/complete`],
  ]);
  assert.deepEqual(context.calls[1].options.body, { version: 4 });
});

test('LifeSpace Trigger accepts a correctly signed event for any selected Record Type', async () => {
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
    getCredentials: async (name) => name === 'lifeSpaceWebhookApi' ? { signingSecret } : { baseUrl: BASE_URL },
    getBodyData: () => body,
    getNodeParameter(name, defaultValue) {
      const parameters = {
        eventTypes: ['record.created', 'record.updated', 'record.deleted'],
        spaceId: 'spc_test',
        recordTypes: [TASK_RECORD_TYPE, NOTE_RECORD_TYPE],
      };
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    helpers: {
      returnJsonArray: (value) => [{ json: value }],
    },
  });

  assert.equal(state.statusCode, null);
  assert.deepEqual(result.workflowData, [[{ json: { ...body, recordType: TASK_RECORD_TYPE } }]]);
});

test('LifeSpace Trigger always accepts a correctly signed endpoint.test payload', async () => {
  const node = new LifeSpaceTrigger();
  const body = { type: 'endpoint.test', spaceId: 'spc_other', modelKey: 'other' };
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signingSecret = 'a'.repeat(64);
  const signature = createHmac('sha256', signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const { response } = responseRecorder();

  const result = await node.webhook.call({
    getRequestObject: () => ({ rawBody }),
    getHeaderData: () => ({
      'x-lifespace-timestamp': timestamp,
      'x-lifespace-signature': `v1=${signature}`,
    }),
    getResponseObject: () => response,
    getCredentials: async (name) => name === 'lifeSpaceWebhookApi' ? { signingSecret } : { baseUrl: BASE_URL },
    getBodyData: () => body,
    getNodeParameter: () => [],
    helpers: {
      returnJsonArray: (value) => [{ json: value }],
    },
  });

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
    getCredentials: async (name) => name === 'lifeSpaceWebhookApi'
      ? { signingSecret: 'a'.repeat(64) }
      : { baseUrl: BASE_URL },
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

test('LifeSpace Person relations use native single/multi selectors backed by source-field-aware lookup', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture();
  const task = discovery.data.spaces[0].models[0];
  const lookup = { supported: true, method: 'GET', pathTemplate: '/api/v1/spaces/{spaceId}/_relation-targets/{modelKey}/{fieldKey}', searchParameter: 'q', cursorParameter: 'cursor', limitParameter: 'limit' };
  task.fields.push(
    { key: 'ownerPersonId', type: 'person', title: 'Owner', relation: { targetModel: 'person', cardinality: 'one', lookup } },
    { key: 'assigneePersonIds', type: 'person_list', title: 'Assignees', relation: { targetModel: 'person', cardinality: 'many', lookup } },
    { key: 'parentTaskId', type: 'record', title: 'Parent Task', targetModel: 'task', relation: { targetModel: 'task', cardinality: 'one', lookup: { supported: false, reason: 'reference-label-unavailable' } } },
  );
  const parameters = { spaceId: 'spc_test', recordType: TASK_RECORD_TYPE, operation: 'create', '&field': 'assigneePersonIds' };
  const context = loadOptionsContext(discovery, parameters);
  context.helpers = {
    async httpRequestWithAuthentication(_credentialName, options) {
      if (options.url === `${BASE_URL}/me/_discovery`) return discovery;
      assert.equal(options.url, `${BASE_URL}/spaces/spc_test/_relation-targets/task/assigneePersonIds`);
      return { data: { items: [{ id: 'per_alpha', label: 'Alpha Person' }, { id: 'per_beta', label: 'Beta Person' }], nextCursor: null } };
    },
  };
  const singles = await node.methods.loadOptions.getSingleRelationFields.call(context);
  const multiples = await node.methods.loadOptions.getMultiRelationFields.call(context);
  const targets = await node.methods.loadOptions.getRelationTargetsForCurrentField.call(context);
  const fields = await node.methods.resourceMapping.getRecordFields.call(context);
  assert.deepEqual(singles.map((entry) => entry.value), ['ownerPersonId']);
  assert.deepEqual(multiples.map((entry) => entry.value), ['assigneePersonIds']);
  assert.deepEqual(targets, [{ name: 'Alpha Person', value: 'per_alpha' }, { name: 'Beta Person', value: 'per_beta' }]);
  assert.equal(fields.fields.some((field) => field.id === 'ownerPersonId'), false);
  assert.equal(fields.fields.some((field) => field.id === 'assigneePersonIds'), false);
  assert.equal(fields.fields.find((field) => field.id === 'parentTaskId').type, 'string');
});

test('Person relation fields keep raw-ID fallback when Runtime Discovery has no lookup contract', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture();
  discovery.data.spaces[0].models[0].fields.push({
    key: 'assigneePersonIds',
    type: 'person_list',
    title: 'Assignees',
  });

  const fields = await node.methods.resourceMapping.getRecordFields.call(
    loadOptionsContext(discovery, { spaceId: 'spc_test', recordType: TASK_RECORD_TYPE, operation: 'create' }),
  );
  const assignees = fields.fields.find((field) => field.id === 'assigneePersonIds');
  assert.equal(assignees.type, 'array');
  assert.equal(assignees.options, undefined);
});

test('Create preserves selected LifeSpace Person IDs in the resource payload', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'create',
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      'fields.value': { name: 'Shared task' },
      'dateFields.date': [{ field: 'dueDate', value: '2026-09-30T00:00:00.000+08:00' }],
      'multiRelations.relation': [{ field: 'assigneePersonIds', targets: ['per_alpha', 'per_beta'] }],
    },
    () => ({ data: { id: 'tsk_created', version: 1 } }),
  );

  await node.execute.call(context);
  assert.deepEqual(context.calls[0].options.body, {
    name: 'Shared task',
    dueDate: '2026-09-30',
    assigneePersonIds: ['per_alpha', 'per_beta'],
  });
});

test('Trigger recordType output feeds Get directly without a model mapping or Discovery request', async () => {
  const recordNode = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'get',
      spaceId: 'spc_test',
      recordType: TASK_RECORD_TYPE,
      recordId: 'rec_from_trigger',
    },
    (options) => {
      assert.equal(options.url, `${BASE_URL}/spaces/spc_test/models/task/records/rec_from_trigger`);
      return { data: { id: 'rec_from_trigger', version: 1 } };
    },
  );

  const result = await recordNode.execute.call(context);
  assert.equal(result[0][0].json.data.id, 'rec_from_trigger');
  assert.equal(context.calls.length, 1);
});

