import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');
const { decodeRecordTypeSelector, encodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');

const TASK_RECORD_TYPE = encodeRecordTypeSelector('task', 'tasks');
const NOTE_RECORD_TYPE = encodeRecordTypeSelector('note', 'notes');

const BASE_URL = 'https://example.invalid/api/v1';

const inventory = {
  data: {
    semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
    models: [
      {
        key: 'task',
        route: 'tasks',
        version: 7,
        schemaHash: 'sha256:task-v7',
        display: { singular: 'Task', plural: 'Tasks' },
        capabilities: [],
        actions: [{ key: 'complete', access: 'write', kind: 'workflow' }],
      },
      {
        key: 'note',
        route: 'notes',
        version: 2,
        schemaHash: 'sha256:note-v2',
        display: { singular: 'Note', plural: 'Notes' },
        capabilities: [],
        actions: [],
      },
    ],
    spaces: [
      {
        spaceId: 'spc_test',
        spaceName: 'Test Space',
        models: [
          { modelKey: 'task', access: ['read', 'write'] },
          { modelKey: 'note', access: ['read'] },
        ],
      },
    ],
  },
};

const taskDetail = {
  data: {
    key: 'task',
    route: 'tasks',
    version: 7,
    schemaHash: 'sha256:task-v7',
    display: { singular: 'Task', plural: 'Tasks' },
    description: 'Synthetic progressive detail.',
    referenceLabel: { fields: ['name'], separator: ' · ' },
    declaredAccess: ['read', 'write'],
    fields: [
      { key: 'name', type: 'string', title: 'Name', required: true },
      { key: 'status', type: 'enum', title: 'Status', required: true, readOnly: true, values: ['pending', 'completed'] },
      { key: 'dueDate', type: 'date', title: 'Due Date', nullable: true },
      {
        key: 'assigneePersonIds',
        type: 'person_list',
        title: 'Assignees',
        relation: {
          targetModel: 'person',
          cardinality: 'many',
          resolution: {
            supported: true,
            method: 'POST',
            pathTemplate: '/api/v1/spaces/{spaceId}/_reference-resolutions/{modelKey}/{fieldKey}',
            maxIds: 50,
          },
        },
      },
    ],
    defaults: { status: 'pending' },
    query: {
      searchable: ['name'],
      filterable: ['status', 'dueDate', 'assigneePersonIds'],
      sortable: ['dueDate', 'name'],
      search: { parameter: 'q', minLength: 1, maxLength: 100 },
      filters: [],
      sort: {
        parameter: 'sort',
        syntax: 'field:direction',
        repeatable: true,
        ordered: true,
        maxCriteria: 8,
        genericDefault: ['createdAt:desc'],
        envelopeFields: ['createdAt', 'updatedAt'],
        nullPlacement: 'last',
        genericValues: [],
        semantic: { standalone: true, values: [], defaults: {} },
      },
      pagination: {
        limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
        cursor: { parameter: 'cursor', type: 'string' },
      },
      capabilityParameters: [],
    },
    actions: [
      {
        key: 'complete',
        access: 'write',
        kind: 'workflow',
        input: { fields: [] },
        concurrency: {
          strategy: 'record-version',
          required: true,
          transport: { in: 'body', name: 'version' },
        },
        invocation: {
          method: 'POST',
          pathTemplate: '/api/v1/spaces/{spaceId}/tasks/{recordId}/actions/complete',
        },
      },
    ],
    capabilities: [],
    capabilityBindings: {},
  },
};

function progressiveContext(parameters = {}) {
  const calls = [];
  return {
    calls,
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
        calls.push(options);
        if (options.url === `${BASE_URL}/me/_discovery/inventory`) return inventory;
        if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/task`) return taskDetail;
        if (options.url === `${BASE_URL}/spaces/spc_test/_relation-targets/task/assigneePersonIds`) {
          return { data: { items: [{ id: 'per_a', label: 'Alice' }], nextCursor: null } };
        }
        throw new Error(`Unexpected request ${options.method} ${options.url}`);
      },
    },
  };
}

function parameterValue(parameters, name, itemIndex, defaultValue) {
  if (!Object.prototype.hasOwnProperty.call(parameters, name)) return defaultValue;
  const value = parameters[name];
  return typeof value === 'function' ? value(itemIndex) : value;
}

function progressiveExecuteContext(parameters = {}, itemCount = 1) {
  const calls = [];
  return {
    calls,
    getInputData: () => Array.from({ length: itemCount }, () => ({ json: {} })),
    getCredentials: async () => ({ baseUrl: `${BASE_URL}/` }),
    getNodeParameter(name, itemIndex, defaultValue) {
      return parameterValue(parameters, name, itemIndex, defaultValue);
    },
    getNode: () => ({ name: 'LifeSpace' }),
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        calls.push(options);
        if (options.url === `${BASE_URL}/me/_discovery/inventory`) return inventory;
        if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/task`) return taskDetail;
        if (options.url === `${BASE_URL}/spaces/spc_test/tasks` && options.method === 'POST') {
          return { data: { id: 'tsk_created', version: 1, ...options.body } };
        }
        const recordMatch = new RegExp(`^${BASE_URL}/spaces/spc_test/tasks/(rec_[^/]+)$`, 'u').exec(options.url);
        if (recordMatch && options.method === 'GET') {
          return { data: { id: recordMatch[1], version: 3, name: 'Current task' } };
        }
        const actionMatch = new RegExp(`^${BASE_URL}/spaces/spc_test/tasks/(rec_[^/]+)/actions/complete$`, 'u').exec(options.url);
        if (actionMatch && options.method === 'POST') {
          return { data: { id: actionMatch[1], version: 4, status: 'completed' } };
        }
        if (options.url === `${BASE_URL}/spaces/spc_test/tasks/rec_test` && options.method === 'GET') {
          return { data: { id: 'rec_test', version: 1, name: 'Direct selector Get' } };
        }
        throw new Error(`Unexpected request ${options.method} ${options.url}`);
      },
    },
  };
}

test('Space and Record Type selectors use compact inventory only', async () => {
  const node = new LifeSpace();

  const spaceContext = progressiveContext();
  const spaces = await node.methods.loadOptions.getSpaces.call(spaceContext);
  assert.deepEqual(spaces.map((item) => [item.name, item.value]), [['Test Space', 'spc_test']]);
  assert.deepEqual(spaceContext.calls.map((call) => call.url), [`${BASE_URL}/me/_discovery/inventory`]);

  const modelContext = progressiveContext({ spaceId: 'spc_test', operation: 'list' });
  const models = await node.methods.loadOptions.getRecordTypes.call(modelContext);
  assert.deepEqual(models.map((item) => decodeRecordTypeSelector(item.value)), [
    { modelKey: 'task', route: 'tasks' },
    { modelKey: 'note', route: 'notes' },
  ]);
  assert.deepEqual(modelContext.calls.map((call) => call.url), [`${BASE_URL}/me/_discovery/inventory`]);
});

test('Field UI fetches only the selected model semantic detail', async () => {
  const node = new LifeSpace();
  const context = progressiveContext({
    spaceId: 'spc_test',
    recordType: TASK_RECORD_TYPE,
    operation: 'create',
  });

  const fields = await node.methods.resourceMapping.getRecordFields.call(context);
  assert.deepEqual(fields.fields.map((field) => field.id), ['name']);
  assert.deepEqual(context.calls.map((call) => call.url), [
    `${BASE_URL}/me/_discovery/inventory`,
    `${BASE_URL}/spaces/spc_test/_discovery/models/task`,
  ]);
  assert.equal(context.calls.some((call) => call.url.endsWith('/me/_discovery')), false);
  assert.equal(context.calls.some((call) => call.url.includes('/models/note')), false);
});

test('Relation options remain lazy and field-scoped after progressive detail', async () => {
  const node = new LifeSpace();
  const context = progressiveContext({
    spaceId: 'spc_test',
    recordType: TASK_RECORD_TYPE,
    '&field': 'assigneePersonIds',
  });

  const targets = await node.methods.loadOptions.getRelationTargetsForCurrentField.call(context);
  assert.deepEqual(targets, [{ name: 'Alice', value: 'per_a' }]);
  assert.deepEqual(context.calls.map((call) => call.url), [
    `${BASE_URL}/me/_discovery/inventory`,
    `${BASE_URL}/spaces/spc_test/_discovery/models/task`,
    `${BASE_URL}/spaces/spc_test/_relation-targets/task/assigneePersonIds`,
  ]);
});

test('non-Calendar create performs only the business mutation at execution time', async () => {
  const node = new LifeSpace();
  const context = progressiveExecuteContext({
    resource: 'modelRecord',
    operation: 'create',
    spaceId: 'spc_test',
    recordType: TASK_RECORD_TYPE,
    'fields.value': { name: 'Direct execution' },
    'dateFields.date': [],
    'singleRelations.relation': [],
    'multiRelations.relation': [],
  });

  await node.execute.call(context);
  assert.deepEqual(context.calls.map((call) => [call.method, call.url]), [
    ['POST', `${BASE_URL}/spaces/spc_test/tasks`],
  ]);
});

test('Record Type selectors preserve model identity and REST route for multiple models', () => {
  assert.deepEqual(decodeRecordTypeSelector(TASK_RECORD_TYPE), { modelKey: 'task', route: 'tasks' });
  assert.deepEqual(decodeRecordTypeSelector(NOTE_RECORD_TYPE), { modelKey: 'note', route: 'notes' });
});

test('Get decodes Record Type locally without a Discovery request', async () => {
  const node = new LifeSpace();
  const context = progressiveExecuteContext({
    resource: 'modelRecord',
    operation: 'get',
    spaceId: 'spc_test',
    recordType: TASK_RECORD_TYPE,
    recordId: 'rec_test',
  });

  const result = await node.execute.call(context);
  assert.equal(result[0][0].json.data.id, 'rec_test');
  assert.deepEqual(context.calls.map((call) => [call.method, call.url]), [
    ['GET', `${BASE_URL}/spaces/spc_test/tasks/rec_test`],
  ]);
});

test('Action execution goes directly to selected semantic detail without inventory', async () => {
  const node = new LifeSpace();
  const context = progressiveExecuteContext({
    resource: 'modelRecord',
    operation: 'executeAction',
    spaceId: 'spc_test',
    recordType: TASK_RECORD_TYPE,
    recordId: 'rec_one',
    actionKey: 'complete',
    'actionInput.value': {},
  });

  await node.execute.call(context);
  assert.deepEqual(context.calls.map((call) => [call.method, call.url]), [
    ['GET', `${BASE_URL}/spaces/spc_test/_discovery/models/task`],
    ['GET', `${BASE_URL}/spaces/spc_test/tasks/rec_one`],
    ['POST', `${BASE_URL}/spaces/spc_test/tasks/rec_one/actions/complete`],
  ]);
  assert.equal(context.calls.some((call) => call.url.endsWith('/me/_discovery/inventory')), false);
});

test('Action semantic detail is reused once per node execution for multiple items of the same model', async () => {
  const node = new LifeSpace();
  const context = progressiveExecuteContext({
    resource: 'modelRecord',
    operation: 'executeAction',
    spaceId: 'spc_test',
    recordType: TASK_RECORD_TYPE,
    recordId: (itemIndex) => `rec_${itemIndex + 1}`,
    actionKey: 'complete',
    'actionInput.value': {},
  }, 2);

  await node.execute.call(context);
  assert.equal(
    context.calls.filter((call) => call.url === `${BASE_URL}/spaces/spc_test/_discovery/models/task`).length,
    1,
  );
  assert.equal(context.calls.some((call) => call.url.endsWith('/me/_discovery/inventory')), false);
  assert.deepEqual(context.calls.map((call) => [call.method, call.url]), [
    ['GET', `${BASE_URL}/spaces/spc_test/_discovery/models/task`],
    ['GET', `${BASE_URL}/spaces/spc_test/tasks/rec_1`],
    ['POST', `${BASE_URL}/spaces/spc_test/tasks/rec_1/actions/complete`],
    ['GET', `${BASE_URL}/spaces/spc_test/tasks/rec_2`],
    ['POST', `${BASE_URL}/spaces/spc_test/tasks/rec_2/actions/complete`],
  ]);
});
