import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceTool } = require('../dist/nodes/agent/LifeSpaceAgentToolBase.js');
const {
  buildAgentToolDefinition,
  buildAgentToolRequest,
} = require('../dist/nodes/agent/lifeSpaceToolFactory.js');

const BASE_URL = 'https://example.invalid/api/v1';
const HASH_TASK = 'sha256:synthetic-task-v10';
const HASH_EVENT = 'sha256:synthetic-event-v9';

const explicitOperators = (field) => ['eq', 'lt', 'lte', 'gt', 'gte'].map((operator) => ({
  operator,
  parameter: `${field}.${operator}`,
  transport: 'explicit',
}));

const taskIdentity = {
  key: 'task', version: 10, schemaHash: HASH_TASK,
  display: { singular: 'Task', plural: 'Tasks' }, capabilities: [],
  actions: [{ key: 'complete', access: 'write', kind: 'workflow' }],
};

const eventIdentity = {
  key: 'event', version: 9, schemaHash: HASH_EVENT,
  display: { singular: 'Event', plural: 'Events' }, capabilities: ['calendar'], actions: [],
};

function inventory(model = taskIdentity) {
  return {
    data: {
      semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
      models: [model],
      spaces: [{
        spaceId: 'spc_test', spaceName: 'Test Space',
        models: [{ modelKey: model.key, access: ['read', 'write'] }],
      }],
    },
  };
}

function taskDetail(overrides = {}) {
  return {
    data: {
      key: 'task', version: 10, schemaHash: HASH_TASK,
      display: { singular: 'Task', plural: 'Tasks' },
      description: 'A synthetic task used to verify metadata-driven Agent Tools.',
      declaredAccess: ['read', 'write'],
      fields: [
        { key: 'name', type: 'string', title: 'Name', required: true, minLength: 1, maxLength: 120 },
        { key: 'status', type: 'enum', title: 'Status', required: true, values: ['open', 'done'] },
        { key: 'assigneePersonIds', type: 'person_list', title: 'Assignees', nullable: true },
        { key: 'dueDate', type: 'date', title: 'Due Date', nullable: true },
        { key: 'score', type: 'number', title: 'Score', nullable: true },
        { key: 'externalKey', type: 'string', title: 'External Key', immutable: true },
        { key: 'computed', type: 'string', title: 'Computed', readOnly: true },
      ],
      defaults: { status: 'open' },
      query: {
        searchable: ['name'], filterable: ['status', 'dueDate', 'score'], sortable: ['dueDate'],
        search: { parameter: 'q', minLength: 1, maxLength: 100 },
        filters: [
          { field: 'status', parameter: 'status', mode: 'enum-set' },
          { field: 'dueDate', parameter: 'dueDate', mode: 'exact', range: { fromParameter: 'dueDateFrom', toParameter: 'dueDateTo' } },
          { field: 'score', parameter: 'score', mode: 'exact', range: { fromParameter: 'scoreFrom', toParameter: 'scoreTo' } },
        ],
        comparisons: [
          { field: 'dueDate', source: 'model', valueType: 'date', operators: explicitOperators('dueDate') },
          { field: 'score', source: 'model', valueType: 'number', operators: explicitOperators('score') },
          {
            field: 'createdAt', source: 'envelope', valueType: 'datetime', operators: explicitOperators('createdAt'),
            localDateWindow: {
              dateStartParameter: 'createdAt.dateStart', dateEndExclusiveParameter: 'createdAt.dateEndExclusive',
              timezoneParameter: 'createdAt.timezone', bounds: '[)', lowerOperator: 'gte', upperOperator: 'lt',
            },
          },
          { field: 'updatedAt', source: 'envelope', valueType: 'datetime', operators: explicitOperators('updatedAt') },
        ],
        capabilityQueries: [],
        sort: {
          parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8,
          genericDefault: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'], nullPlacement: 'last',
          genericValues: ['createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc', 'dueDate:asc', 'dueDate:desc'],
        },
        pagination: {
          limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
          cursor: { parameter: 'cursor', type: 'string' },
        },
      },
      actions: [{
        key: 'complete', access: 'write', kind: 'workflow', input: { fields: [{ key: 'note', type: 'text', nullable: true }] },
        concurrency: { strategy: 'record-version', required: true, transport: { in: 'body', name: 'version' } },
        invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/task/records/{recordId}/actions/complete' },
      }],
      capabilities: [], capabilityBindings: {},
      ...overrides,
    },
  };
}

function eventDetail() {
  return {
    data: {
      key: 'event', version: 9, schemaHash: HASH_EVENT,
      display: { singular: 'Event', plural: 'Events' }, description: 'Synthetic Calendar event.',
      declaredAccess: ['read', 'write'], fields: [{ key: 'summary', type: 'string', required: true }], defaults: {},
      query: {
        searchable: ['summary'], filterable: [], sortable: [],
        search: { parameter: 'q', minLength: 1, maxLength: 100 }, filters: [], comparisons: [],
        capabilityQueries: [{
          key: 'calendar.window', capability: 'calendar', semantics: 'record-interval-overlap', recurrenceExpansion: false,
          parameters: [
            { parameter: 'windowStartDate', type: 'date', required: true, role: 'window-start-date' },
            { parameter: 'windowEndDateExclusive', type: 'date', required: true, role: 'window-end-date-exclusive' },
            { parameter: 'viewingTimezone', type: 'timezone', required: true, role: 'viewing-timezone' },
          ],
          ordering: { parameter: 'sort', values: ['calendarStart:asc', 'calendarStart:desc'], default: 'calendarStart:asc' },
        }],
        sort: {
          parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8,
          genericDefault: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'], nullPlacement: 'last',
          genericValues: ['createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc'],
        },
        pagination: {
          limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
          cursor: { parameter: 'cursor', type: 'string' },
        },
      },
      actions: [], capabilities: ['calendar'], capabilityBindings: {},
    },
  };
}

function supplyContext(parameters, { model = taskIdentity, detail = taskDetail(), business } = {}) {
  const calls = [];
  const outputs = [];
  return {
    calls,
    outputs,
    getCredentials: async () => ({ baseUrl: BASE_URL }),
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace Tool', typeVersion: 1 }),
    addInputData: () => ({ index: 0 }),
    addOutputData: (...args) => outputs.push(args),
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ credentialName, options });
        if (options.url === `${BASE_URL}/me/_discovery/inventory`) return inventory(model);
        if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/${model.key}`) return detail;
        if (business) return business(options, calls);
        return { data: { id: 'rec_synthetic', version: 1 } };
      },
    },
  };
}

const baseToolParameters = {
  spaceId: 'spc_test', recordType: 'task', operation: 'query', queryMode: 'generic',
  capabilityQueryKey: '', actionKey: '', descriptionOverride: '',
};

test('native LifeSpace Tool supplies distinct automatic tool identities and model-derived create schema', async () => {
  const node = new LifeSpaceTool();
  const queryContext = supplyContext(baseToolParameters);
  const queryTool = (await node.supplyData.call(queryContext, 0)).response;

  const createContext = supplyContext({ ...baseToolParameters, operation: 'create' });
  const createTool = (await node.supplyData.call(createContext, 0)).response;

  assert.notEqual(queryTool.name, createTool.name);
  assert.match(queryTool.name, /^lifespace_query_task_s/u);
  assert.match(createTool.name, /^lifespace_create_task_s/u);
  assert.match(queryTool.description, /Query Tasks/u);
  assert.match(createTool.description, /Create a Task/u);
  assert.match(createTool.description, /Test Space/u);

  assert.deepEqual(createTool.schema.required, ['name']);
  assert.equal(createTool.schema.properties.status.default, 'open');
  assert.equal(Object.prototype.hasOwnProperty.call(createTool.schema.properties, 'computed'), false);
  assert.equal(createTool.schema.properties.assigneePersonIds.oneOf[0].type, 'array');
});

test('create invocation omits optional AI fields instead of synthesizing empty relation values', async () => {
  let posted;
  const context = supplyContext({ ...baseToolParameters, operation: 'create' }, {
    business(options) {
      posted = options;
      return { data: { id: 'rec_1', version: 1, data: options.body } };
    },
  });
  const tool = (await new LifeSpaceTool().supplyData.call(context, 0)).response;
  await tool.invoke({ name: 'Buy milk' });

  assert.equal(context.calls.length, 3, 'inventory + selected detail + one business POST');
  assert.equal(posted.method, 'POST');
  assert.equal(posted.url, `${BASE_URL}/spaces/spc_test/models/task/records`);
  assert.deepEqual(posted.body, { name: 'Buy milk' });
  assert.equal(Object.prototype.hasOwnProperty.call(posted.body, 'assigneePersonIds'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(posted.body, 'status'), false, 'Core applies its published default');
});

test('generic query schema exposes published explicit Time Semantics without legacy suffix inference', async () => {
  let requested;
  const context = supplyContext(baseToolParameters, {
    business(options) {
      requested = options;
      return { data: { items: [], nextCursor: null } };
    },
  });
  const tool = (await new LifeSpaceTool().supplyData.call(context, 0)).response;
  assert.ok(tool.schema.properties['createdAt.gte']);
  assert.ok(tool.schema.properties['updatedAt.lt']);
  assert.ok(tool.schema.properties['createdAt.dateStart']);
  assert.equal(tool.schema.properties.dueDateFrom, undefined);
  assert.equal(tool.schema.properties.scoreFrom, undefined);

  await tool.invoke({
    q: 'milk',
    status: ['open'],
    'createdAt.dateStart': '2026-09-10',
    'createdAt.dateEndExclusive': '2026-09-11',
    'createdAt.timezone': 'Asia/Shanghai',
    'score.gte': 3,
    sort: ['createdAt:desc'],
    limit: 20,
  });
  assert.equal(context.calls.length, 3, 'Tool invocation performs no execution-time Discovery');
  assert.deepEqual(requested.qs, {
    q: 'milk',
    status: 'open',
    'createdAt.dateStart': '2026-09-10',
    'createdAt.dateEndExclusive': '2026-09-11',
    'createdAt.timezone': 'Asia/Shanghai',
    'score.gte': 3,
    sort: ['createdAt:desc'],
    limit: 20,
  });
  assert.equal(requested.arrayFormat, 'repeat');
});

test('generic local-date window fails closed when the AI supplies only part of the published triplet', () => {
  const model = {
    ...taskDetail().data,
    access: ['read', 'write'],
    query: {
      ...taskDetail().data.query,
      sort: { ...taskDetail().data.query.sort, default: taskDetail().data.query.sort.genericDefault },
    },
  };
  assert.throws(
    () => buildAgentToolRequest(model, { spaceId: 'spc_test', operation: 'query', queryMode: 'generic' }, {
      'createdAt.dateStart': '2026-09-10',
    }),
    /requires createdAt\.dateEndExclusive/u,
  );
});

test('capability query is generated from metadata and does not guess generic-filter composability', async () => {
  const parameters = {
    ...baseToolParameters,
    recordType: 'event',
    queryMode: 'capability',
    capabilityQueryKey: 'calendar.window',
  };
  let requested;
  const context = supplyContext(parameters, {
    model: eventIdentity,
    detail: eventDetail(),
    business(options) {
      requested = options;
      return { data: { items: [], nextCursor: null } };
    },
  });
  const tool = (await new LifeSpaceTool().supplyData.call(context, 0)).response;
  assert.deepEqual(tool.schema.required, ['windowStartDate', 'windowEndDateExclusive', 'viewingTimezone']);
  assert.equal(tool.schema.properties.q, undefined, 'generic search stays narrowed until LifeSpace #228');
  assert.deepEqual(tool.schema.properties.sort.enum, ['calendarStart:asc', 'calendarStart:desc']);

  await tool.invoke({
    windowStartDate: '2026-09-10',
    windowEndDateExclusive: '2026-09-11',
    viewingTimezone: 'Asia/Shanghai',
    sort: 'calendarStart:desc',
  });
  assert.deepEqual(requested.qs, {
    windowStartDate: '2026-09-10', windowEndDateExclusive: '2026-09-11',
    viewingTimezone: 'Asia/Shanghai', sort: 'calendarStart:desc',
  });
});

test('update sends only explicitly supplied mutable fields plus the current record version', async () => {
  const businessCalls = [];
  const context = supplyContext({ ...baseToolParameters, operation: 'update' }, {
    business(options) {
      businessCalls.push(options);
      if (options.method === 'GET') return { data: { id: 'rec_1', version: 7 } };
      return { data: { id: 'rec_1', version: 8 } };
    },
  });
  const tool = (await new LifeSpaceTool().supplyData.call(context, 0)).response;
  assert.equal(tool.schema.properties.externalKey, undefined, 'immutable fields are not AI-updateable');
  await tool.invoke({ recordId: 'rec_1', name: 'Updated' });

  assert.equal(businessCalls.length, 2);
  assert.equal(businessCalls[0].method, 'GET');
  assert.equal(businessCalls[1].method, 'PATCH');
  assert.deepEqual(businessCalls[1].body, { name: 'Updated', version: 7 });
  assert.equal(Object.prototype.hasOwnProperty.call(businessCalls[1].body, 'assigneePersonIds'), false);
});

test('delete and Action keep record-version concurrency out of the AI schema', async () => {
  for (const parameters of [
    { ...baseToolParameters, operation: 'delete' },
    { ...baseToolParameters, operation: 'action', actionKey: 'complete' },
  ]) {
    const businessCalls = [];
    const context = supplyContext(parameters, {
      business(options) {
        businessCalls.push(options);
        if (options.method === 'GET') return { data: { id: 'rec_1', version: 4 } };
        return { data: { id: 'rec_1', version: 5 } };
      },
    });
    const tool = (await new LifeSpaceTool().supplyData.call(context, 0)).response;
    assert.equal(tool.schema.properties.version, undefined);
    await tool.invoke({ recordId: 'rec_1' });
    assert.equal(businessCalls.length, 2);
    assert.equal(businessCalls[0].method, 'GET');
    assert.equal(businessCalls[1].body.version, 4);
    if (parameters.operation === 'action') {
      assert.match(businessCalls[1].url, /\/actions\/complete$/u);
      assert.equal(Object.prototype.hasOwnProperty.call(businessCalls[1].body, 'note'), false);
    } else {
      assert.equal(businessCalls[1].method, 'DELETE');
    }
  }
});

test('future synthetic models require no source-specific Tool implementation', () => {
  const futureModel = {
    key: 'booking_slot', version: 1, schemaHash: 'sha256:future',
    display: { singular: 'Booking Slot', plural: 'Booking Slots' }, description: 'Future synthetic model.',
    access: ['read', 'write'],
    fields: [
      { key: 'label', type: 'string', required: true },
      { key: 'capacity', type: 'integer', nullable: true },
    ],
    defaults: {},
    query: {
      searchable: [], filterable: [], sortable: [], search: null, filters: [], comparisons: [], capabilityQueries: [],
      sort: {
        parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8,
        default: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'], nullPlacement: 'last',
        genericValues: ['createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc'],
      },
      pagination: {
        limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
        cursor: { parameter: 'cursor', type: 'string' },
      },
    },
    actions: [], capabilities: [], capabilityBindings: {},
  };
  const definition = buildAgentToolDefinition(futureModel, {
    spaceId: 'spc_future', spaceName: 'Future Space', operation: 'create',
  });
  assert.match(definition.name, /^lifespace_create_booking_slot_s/u);
  assert.deepEqual(definition.schema.required, ['label']);
  assert.ok(definition.schema.properties.capacity);
});

test('Progressive Discovery identity drift fails closed before an Agent Tool is supplied', async () => {
  const driftedDetail = taskDetail({ schemaHash: 'sha256:wrong' });
  const context = supplyContext(baseToolParameters, { detail: driftedDetail });
  await assert.rejects(
    () => new LifeSpaceTool().supplyData.call(context, 0),
    /identity drifted/u,
  );
  assert.equal(context.calls.length, 2);
});
