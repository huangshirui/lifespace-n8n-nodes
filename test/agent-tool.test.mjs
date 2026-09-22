import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
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

async function emitAgentToolContract(fileName, tool) {
  const directory = process.env.LIFESPACE_AGENT_TOOL_CONTRACT_DIR?.trim();
  if (!directory) return;

  await mkdir(directory, { recursive: true });
  const structuralTool = {
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
  };
  const openAiFunctionTool = {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    },
  };

  await writeFile(
    join(directory, fileName),
    JSON.stringify({ structuralTool, openAiFunctionTool }, null, 2) + '\n',
    'utf8',
  );
}

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
        {
          key: 'assigneePersonIds',
          type: 'person_list',
          title: 'Assignees',
          nullable: true,
          relation: {
            targetModel: 'person',
            cardinality: 'many',
            lookup: {
              supported: true,
              method: 'GET',
              pathTemplate: '/api/v1/spaces/{spaceId}/_relation-targets/{modelKey}/{fieldKey}',
              searchParameter: 'q',
              cursorParameter: 'cursor',
              limitParameter: 'limit',
            },
          },
        },
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

function canonicalEventDetail() {
  return {
    data: {
      key: 'event',
      version: 9,
      schemaHash: HASH_EVENT,
      display: { singular: 'Event', plural: 'Events' },
      description: 'A calendar occurrence.',
      declaredAccess: ['read', 'write'],
      fields: [
        { key: 'summary', type: 'string', title: 'Summary', required: true },
        { key: 'when', type: 'temporal_range', title: 'When', description: 'When the occurrence happens.', required: true },
        {
          key: 'attendeePersonIds',
          type: 'person_list',
          title: 'Attendees',
          relation: {
            targetModel: 'person',
            cardinality: 'many',
            lookup: {
              supported: true,
              method: 'GET',
              pathTemplate: '/api/v1/spaces/{spaceId}/_relation-targets/{modelKey}/{fieldKey}',
              searchParameter: 'q',
              cursorParameter: 'cursor',
              limitParameter: 'limit',
            },
          },
        },
        { key: 'status', type: 'enum', title: 'Status', required: true, values: ['active', 'cancelled'] },
      ],
      defaults: { status: 'active' },
      query: {
        searchable: ['summary'],
        filterable: ['when', 'attendeePersonIds'],
        sortable: ['when', 'summary'],
        search: { parameter: 'q', minLength: 1, maxLength: 100 },
        filters: [],
        comparisons: [],
        capabilityQueries: [],
        sort: {
          parameter: 'sort',
          syntax: 'field:direction',
          repeatable: true,
          ordered: true,
          maxCriteria: 8,
          genericDefault: ['createdAt:desc'],
          envelopeFields: ['createdAt', 'updatedAt'],
          nullPlacement: 'last',
          genericValues: ['createdAt:desc', 'when:asc', 'when:desc', 'summary:asc', 'summary:desc'],
        },
        pagination: {
          limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
          cursor: { parameter: 'cursor', type: 'string' },
        },
        canonical: {
          invocation: {
            method: 'POST',
            pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query',
          },
          search: { fields: ['summary'], minLength: 1, maxLength: 100 },
          filter: {
            maxDepth: 8,
            maxNodes: 100,
            targets: [
              {
                field: 'attendeePersonIds',
                kind: 'field',
                valueType: 'person_list',
                operators: ['contains'],
                nullable: false,
                acceptsCurrentActorPersonAlias: 'me',
              },
              {
                field: 'when',
                kind: 'field',
                valueType: 'temporal_range',
                operators: ['overlaps', 'contains', 'before', 'after', 'kindIs'],
                nullable: false,
              },
            ],
          },
          sort: {
            fields: ['createdAt', 'summary', 'updatedAt', 'when'],
            directions: ['asc', 'desc'],
            maxCriteria: 8,
            default: [{ field: 'createdAt', direction: 'desc' }],
            nullPlacement: 'last',
            stableTieBreaker: 'record-id-asc',
            temporalRange: {
              context: 'context.viewingTimezone',
              ordering: ['projectedStart', 'projectedEnd', 'record-id-asc'],
            },
          },
          pagination: {
            limit: { minimum: 1, maximum: 200, default: 100 },
            cursor: {
              opaque: true,
              binds: ['normalized-search', 'normalized-filter', 'effective-sort', 'temporal-viewing-context', 'continuation-key'],
              snapshotConsistency: false,
            },
          },
        },
      },
      actions: [{
        key: 'reschedule',
        access: 'write',
        kind: 'workflow',
        input: { fields: [{ key: 'when', type: 'temporal_range', title: 'When', required: true }] },
        concurrency: { strategy: 'record-version', required: true, transport: { in: 'body', name: 'version' } },
        invocation: {
          method: 'POST',
          pathTemplate: '/api/v1/spaces/{spaceId}/models/event/records/{recordId}/actions/reschedule',
        },
      }],
      capabilities: ['calendar'],
      capabilityBindings: { calendar: { rangeField: 'when', attendeePersonField: 'attendeePersonIds' } },
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
    getTimezone: () => 'Asia/Shanghai',
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

test('native LifeSpace Tool uses n8n node identity while preserving semantic Tool metadata and schema', async () => {
  const node = new LifeSpaceTool();
  const queryContext = supplyContext(baseToolParameters);
  const queryTool = (await node.supplyData.call(queryContext, 0)).response;
  await emitAgentToolContract('task-query.json', queryTool);

  const createContext = supplyContext({ ...baseToolParameters, operation: 'create' });
  const createTool = (await node.supplyData.call(createContext, 0)).response;

  assert.equal(queryTool.name, 'LifeSpace_Tool');
  assert.equal(createTool.name, 'LifeSpace_Tool');
  assert.match(queryTool.metadata.lifeSpaceSemanticToolName, /^lifespace_query_task_s/u);
  assert.match(createTool.metadata.lifeSpaceSemanticToolName, /^lifespace_create_task_s/u);
  assert.notEqual(
    queryTool.metadata.lifeSpaceSemanticToolName,
    createTool.metadata.lifeSpaceSemanticToolName,
  );
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

test('Agent Tool Create Event accepts semantic when and attendee names then lowers to canonical values', async () => {
  const businessCalls = [];
  const context = supplyContext(
    { ...baseToolParameters, recordType: 'event', operation: 'create' },
    {
      model: eventIdentity,
      detail: canonicalEventDetail(),
      business(options) {
        businessCalls.push(options);
        if (options.method === 'GET' && options.url.includes('/_relation-targets/event/attendeePersonIds')) {
          assert.equal(options.qs.q, '小天');
          return { data: { items: [{ id: 'per_xiaotian', label: '小天' }], nextCursor: null } };
        }
        return { data: { id: 'rec_event', version: 1, data: options.body } };
      },
    },
  );

  const tool = (await new LifeSpaceTool().supplyData.call(context, 0)).response;
  await emitAgentToolContract('event-create.json', tool);
  assert.match(tool.description, /workflow timezone Asia\/Shanghai/u);
  assert.deepEqual(tool.schema.required, ['summary', 'when']);
  assert.ok(tool.schema.properties.when.oneOf);
  assert.equal(tool.schema.properties.attendeePersonIds.type, 'array');
  assert.ok(tool.schema.properties.attendeePersonIds.items.oneOf);

  await tool.invoke({
    summary: '数学课',
    when: {
      kind: 'instant',
      start: '2026-09-20T19:00:00+08:00',
      end: '2026-09-20T20:30:00+08:00',
    },
    attendeePersonIds: [{ name: '小天' }],
  });

  const post = businessCalls.find((call) => call.method === 'POST');
  assert.ok(post);
  assert.deepEqual(post.body, {
    summary: '数学课',
    when: {
      kind: 'instant',
      start: '2026-09-20T19:00:00+08:00',
      endExclusive: '2026-09-20T20:30:00+08:00',
    },
    attendeePersonIds: ['per_xiaotian'],
  });
});

test('Agent Tool Canonical Query resolves relation names, inclusive date windows and TemporalRange sort timezone', async () => {
  const businessCalls = [];
  const context = supplyContext(
    { ...baseToolParameters, recordType: 'event', operation: 'query' },
    {
      model: eventIdentity,
      detail: canonicalEventDetail(),
      business(options) {
        businessCalls.push(options);
        if (options.method === 'GET' && options.url.includes('/_relation-targets/event/attendeePersonIds')) {
          return { data: { items: [{ id: 'per_xiaotian', label: '小天' }], nextCursor: null } };
        }
        return { data: { items: [], nextCursor: null } };
      },
    },
  );

  const tool = (await new LifeSpaceTool().supplyData.call(context, 0)).response;
  await emitAgentToolContract('event-query.json', tool);
  assert.deepEqual(tool.schema.properties.match.enum, ['all', 'any']);
  assert.deepEqual(tool.schema.properties.timeWindow.required, ['startDate', 'endDate']);
  assert.match(tool.schema.properties.timeWindow.description, /today\/tomorrow\/this week/u);
  assert.match(tool.description, /Calendar query guidance: use timeWindow/u);

  const filterBranches = tool.schema.properties.filters.items.oneOf;
  const whenOverlap = filterBranches.find((branch) =>
    branch.properties?.field?.enum?.[0] === 'when'
    && branch.properties?.operator?.enum?.[0] === 'overlaps');
  assert.ok(whenOverlap);
  assert.match(whenOverlap.properties.field.description, /When the occurrence happens/u);
  assert.match(whenOverlap.properties.operator.description, /Allowed range operators/u);

  await tool.invoke({
    timeWindow: {
      startDate: '2026-09-20',
      endDate: '2026-09-20',
    },
    filters: [
      {
        field: 'attendeePersonIds',
        operator: 'contains',
        value: { name: '小天' },
      },
    ],
    sort: [{ field: 'when', direction: 'asc' }],
  });

  const query = businessCalls.find((call) => call.method === 'POST' && call.url.endsWith('/records/query'));
  assert.ok(query);
  assert.deepEqual(query.body, {
    filter: {
      and: [
        {
          field: 'when',
          op: 'overlaps',
          value: {
            kind: 'local_date_window',
            startDate: '2026-09-20',
            endDateExclusive: '2026-09-21',
            timezone: 'Asia/Shanghai',
          },
        },
        { field: 'attendeePersonIds', op: 'contains', value: 'per_xiaotian' },
      ],
    },
    sort: [{ field: 'when', direction: 'asc' }],
    context: { viewingTimezone: 'Asia/Shanghai' },
  });
});

test('Calendar Agent Query makes search/person/sort semantics explicit and returns retryable query errors', async () => {
  const context = supplyContext(
    { ...baseToolParameters, recordType: 'event', operation: 'query' },
    {
      model: eventIdentity,
      detail: canonicalEventDetail(),
      business() {
        return { data: { items: [], nextCursor: null } };
      },
    },
  );

  const tool = (await new LifeSpaceTool().supplyData.call(context, 0)).response;
  assert.match(tool.schema.properties.search.description, /summary only/u);
  assert.match(tool.schema.properties.search.description, /Never attendee names/u);
  assert.match(tool.description, /named attendee.*attendeePersonIds/u);
  assert.match(tool.description, /chronological order sort by "when" directly/u);
  assert.match(tool.description, /Search matches only summary/u);
  assert.match(tool.description, /Never invent nested sort paths/u);
  assert.match(tool.description, /Example date\+attendee\+chronological query/u);
  assert.match(tool.description, /"field":"attendeePersonIds".*"field":"when","direction":"asc"/u);
  assert.match(tool.description, /error\.retryable=true/u);
  assert.match(tool.description, /error\.retryable=false/u);

  const sortItem = tool.schema.properties.sort.items;
  assert.deepEqual(sortItem.properties.field.enum, ['createdAt', 'summary', 'updatedAt', 'when']);
  assert.match(sortItem.properties.field.description, /Chronological calendar order = "when"/u);
  assert.match(tool.description, /"when\.start\.instant"/u);

  const compactFilters = JSON.stringify(tool.schema.properties.filters);
  assert.doesNotMatch(compactFilters, /local_date_window|endExclusive/u);
  const compactBranches = tool.schema.properties.filters.items.oneOf;
  assert.equal(compactBranches.length, 3);
  const whenRangeBranch = compactBranches.find((branch) =>
    branch.properties?.field?.enum?.[0] === 'when'
    && branch.properties?.operator?.enum?.includes('overlaps'));
  assert.ok(whenRangeBranch);
  assert.deepEqual(whenRangeBranch.properties.operator.enum, ['overlaps', 'contains', 'before', 'after']);
  assert.equal(whenRangeBranch.properties.value.oneOf.length, 2);

  const invalidSort = JSON.parse(await tool.invoke({
    timeWindow: { startDate: '2026-09-20', endDate: '2026-09-20' },
    sort: [{ field: 'when.start.instant', direction: 'asc' }],
  }));
  assert.equal(invalidSort.ok, false);
  assert.equal(invalidSort.error.code, 'INVALID_QUERY_SORT');
  assert.equal(invalidSort.error.retryable, true);
  assert.equal(invalidSort.error.nextAction, 'retry_with_corrected_arguments');
  assert.equal(invalidSort.error.field, 'when.start.instant');
  assert.deepEqual(invalidSort.error.allowedFields, ['createdAt', 'summary', 'updatedAt', 'when']);
  assert.match(invalidSort.error.hint, /use field "when" directly/iu);

  const invalidFilter = JSON.parse(await tool.invoke({
    filters: [{ field: 'attendee.name', operator: 'contains', value: '小天' }],
  }));
  assert.equal(invalidFilter.ok, false);
  assert.equal(invalidFilter.error.code, 'INVALID_QUERY_FILTER_FIELD');
  assert.deepEqual(invalidFilter.error.allowedFields, ['attendeePersonIds', 'when']);
});

test('Agent Tool returns structured ambiguity instead of guessing relation IDs', async () => {
  const context = supplyContext(
    { ...baseToolParameters, recordType: 'event', operation: 'create' },
    {
      model: eventIdentity,
      detail: canonicalEventDetail(),
      business(options) {
        if (options.method === 'GET' && options.url.includes('/_relation-targets/event/attendeePersonIds')) {
          return {
            data: {
              items: [
                { id: 'per_1', label: '王老师' },
                { id: 'per_2', label: '王老师' },
              ],
              nextCursor: null,
            },
          };
        }
        throw new Error('mutation must not run after ambiguous reference');
      },
    },
  );
  const tool = (await new LifeSpaceTool().supplyData.call(context, 0)).response;
  const output = JSON.parse(await tool.invoke({
    summary: '家长会',
    when: {
      kind: 'date',
      start: '2026-09-20',
      end: '2026-09-20',
    },
    attendeePersonIds: [{ name: '王老师' }],
  }));

  assert.equal(output.ok, false);
  assert.equal(output.error.code, 'AMBIGUOUS_REFERENCE');
  assert.equal(output.error.retryable, false);
  assert.equal(output.error.nextAction, 'ask_user');
  assert.match(output.error.instruction, /Do not guess/u);
  assert.equal(output.error.field, 'attendeePersonIds');
  assert.equal(output.error.candidates.length, 2);
});

test('Agent Tool treats missing relation names as terminal user-clarification outcomes', async () => {
  let lookupCalls = 0;
  const context = supplyContext(
    { ...baseToolParameters, recordType: 'event', operation: 'query' },
    {
      model: eventIdentity,
      detail: canonicalEventDetail(),
      business(options) {
        if (options.method === 'GET' && options.url.includes('/_relation-targets/event/attendeePersonIds')) {
          lookupCalls += 1;
          assert.equal(options.qs.q, '小天');
          return { data: { items: [], nextCursor: null } };
        }
        throw new Error('event query must not run after an unresolved Person reference');
      },
    },
  );
  const tool = (await new LifeSpaceTool().supplyData.call(context, 0)).response;
  const output = JSON.parse(await tool.invoke({
    filters: [{
      field: 'attendeePersonIds',
      operator: 'contains',
      value: { name: '小天' },
    }],
    timeWindow: { startDate: '2026-09-20', endDate: '2026-09-20' },
    sort: [{ field: 'when', direction: 'asc' }],
  }));

  assert.equal(lookupCalls, 1);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, 'REFERENCE_NOT_FOUND');
  assert.equal(output.error.retryable, false);
  assert.equal(output.error.nextAction, 'ask_user');
  assert.equal(output.error.field, 'attendeePersonIds');
  assert.equal(output.error.input, '小天');
  assert.match(output.error.instruction, /Do not retry this Tool/u);
  assert.match(output.error.instruction, /ask them to provide or choose an existing reference/u);
});

test('Agent Tool supports Any/OR filter composition and rejects empty updates', () => {
  const model = {
    ...canonicalEventDetail().data,
    access: ['read', 'write'],
  };
  const query = buildAgentToolRequest(
    model,
    { spaceId: 'spc_test', operation: 'query', queryMode: 'generic', viewingTimezone: 'Asia/Shanghai' },
    {
      match: 'any',
      filters: [
        { field: 'attendeePersonIds', operator: 'contains', value: 'per_a' },
        { field: 'attendeePersonIds', operator: 'contains', value: 'per_b' },
      ],
    },
  );
  assert.deepEqual(query.body.filter, {
    or: [
      { field: 'attendeePersonIds', op: 'contains', value: 'per_a' },
      { field: 'attendeePersonIds', op: 'contains', value: 'per_b' },
    ],
  });

  assert.throws(
    () => buildAgentToolRequest(
      model,
      { spaceId: 'spc_test', operation: 'update' },
      { recordId: 'rec_event' },
    ),
    /requires at least one field/u,
  );
});

test('Agent Tool Action lowers TemporalRange semantic input after record lookup', () => {
  const model = {
    ...canonicalEventDetail().data,
    access: ['read', 'write'],
  };
  const request = buildAgentToolRequest(
    model,
    { spaceId: 'spc_test', operation: 'action', actionKey: 'reschedule' },
    {
      recordId: 'rec_event',
      when: {
        kind: 'date',
        start: '2026-09-20',
        end: '2026-09-22',
      },
    },
    7,
  );

  assert.deepEqual(request.body, {
    when: {
      kind: 'date',
      start: '2026-09-20',
      endExclusive: '2026-09-23',
    },
    version: 7,
  });
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
