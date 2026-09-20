import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceAgentTool } = require('../dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js');

const BASE_URL = 'https://example.invalid/api/v1';
const MODEL_KEY = 'work_item';
const MODEL_HASH = 'sha256:work-item-v1';

function inventory() {
  return {
    data: {
      semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
      models: [{
        key: MODEL_KEY,
        version: 1,
        schemaHash: MODEL_HASH,
        display: { singular: 'Work Item', plural: 'Work Items' },
        capabilities: [],
        actions: [],
      }],
      spaces: [{
        spaceId: 'spc_test',
        spaceName: 'Test Space',
        models: [{ modelKey: MODEL_KEY, access: ['read', 'write'] }],
      }],
    },
  };
}

function detail() {
  return {
    data: {
      key: MODEL_KEY,
      version: 1,
      schemaHash: MODEL_HASH,
      display: { singular: 'Work Item', plural: 'Work Items' },
      description: 'Synthetic model for the registered Agent Tool surface.',
      declaredAccess: ['read', 'write'],
      fields: [
        { key: 'name', type: 'string', title: 'Name', required: true },
        { key: 'status', type: 'enum', title: 'Status', values: ['open', 'done'], required: true },
        { key: 'dueDate', type: 'date', title: 'Due Date', nullable: true },
        { key: 'score', type: 'number', title: 'Score', nullable: true },
      ],
      defaults: { status: 'open' },
      query: {
        searchable: ['name'],
        filterable: ['status', 'dueDate', 'score'],
        sortable: ['dueDate'],
        search: { parameter: 'q', minLength: 1, maxLength: 100 },
        filters: [{ field: 'status', parameter: 'status', mode: 'enum-set' }],
        comparisons: [
          {
            field: 'score', source: 'model', valueType: 'number',
            operators: [{ operator: 'gte', parameter: 'score.gte', transport: 'explicit' }],
          },
          {
            field: 'createdAt', source: 'envelope', valueType: 'datetime',
            operators: [{ operator: 'gte', parameter: 'createdAt.gte', transport: 'explicit' }],
            localDateWindow: {
              dateStartParameter: 'createdAt.dateStart',
              dateEndExclusiveParameter: 'createdAt.dateEndExclusive',
              timezoneParameter: 'createdAt.timezone',
              bounds: '[)', lowerOperator: 'gte', upperOperator: 'lt',
            },
          },
        ],
        capabilityQueries: [],
        sort: {
          parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true,
          maxCriteria: 8, genericDefault: ['createdAt:desc'],
          envelopeFields: ['createdAt', 'updatedAt'], nullPlacement: 'last',
          genericValues: ['dueDate:asc', 'dueDate:desc', 'createdAt:desc'],
        },
        pagination: {
          limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
          cursor: { parameter: 'cursor', type: 'string' },
        },
        canonical: {
          invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query' },
          pipeline: ['search', 'filter', 'sort', 'cursor-pagination'],
          search: { fields: ['name'], minLength: 1, maxLength: 100 },
          filter: {
            maxDepth: 8, maxNodes: 100,
            targets: [
              { field: 'status', kind: 'field', valueType: 'enum', operators: ['eq', 'ne'], nullable: false },
              { field: 'score', kind: 'field', valueType: 'number', operators: ['eq', 'gte', 'isNull'], nullable: true },
              { field: 'createdAt', kind: 'envelope', valueType: 'datetime', operators: ['gte', 'within'], nullable: false },
            ],
          },
          sort: {
            fields: ['dueDate', 'createdAt'], directions: ['asc', 'desc'], maxCriteria: 8,
            default: [{ field: 'createdAt', direction: 'desc' }], nullPlacement: 'last', stableTieBreaker: 'record-id-asc',
          },
          pagination: {
            limit: { minimum: 1, maximum: 200, default: 100 },
            cursor: { opaque: true, binds: ['search', 'filter', 'sort'], snapshotConsistency: false },
          },
        },
      },
      actions: [], capabilities: [], capabilityBindings: {},
    },
  };
}

function context(parameters, onBusiness, input = [{ json: {} }]) {
  const calls = [];
  return {
    calls,
    getCredentials: async () => ({ baseUrl: BASE_URL }),
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace AI Tool', typeVersion: 1 }),
    getTimezone: () => 'Asia/Shanghai',
    getInputData: () => input,
    addInputData: () => ({ index: 0 }),
    addOutputData: () => undefined,
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        calls.push(options);
        if (options.url === `${BASE_URL}/me/_discovery/inventory`) return inventory();
        if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/${MODEL_KEY}`) return detail();
        if (onBusiness) return onBusiness(options);
        return { data: { items: [], nextCursor: null } };
      },
    },
  };
}

const baseParameters = {
  spaceId: 'spc_test',
  recordType: MODEL_KEY,
  operation: 'query',
  queryMode: 'generic',
  capabilityQueryKey: '',
  actionKey: '',
  descriptionOverride: '',
};

test('registered Agent Tool exposes and executes Canonical Query', async () => {
  const node = new LifeSpaceAgentTool();
  assert.equal(node.description.properties.some((property) => property.name === 'queryMode'), false);
  assert.equal(node.description.properties.some((property) => property.name === 'capabilityQueryKey'), false);

  let requested;
  const execution = context(baseParameters, (options) => {
    requested = options;
    return { data: { items: [], nextCursor: null } };
  });

  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;
  assert.ok(tool.schema.properties.filters);
  assert.equal(Object.hasOwn(tool.schema.properties, 'localDateWindows'), false);
  assert.ok(tool.schema.properties.sort);
  assert.equal(Object.hasOwn(tool.schema.properties, 'score.gte'), false);

  await tool.invoke({
    search: 'milk',
    filters: [
      { field: 'status', operator: 'eq', value: 'open' },
      { field: 'score', operator: 'gte', value: 3 },
      {
        field: 'createdAt',
        operator: 'within',
        value: {
          kind: 'local_date_window',
          startDate: '2026-09-10',
          endDate: '2026-09-10',
        },
      },
    ],
    sort: [{ field: 'dueDate', direction: 'asc' }],
    limit: 20,
  });

  assert.equal(requested.method, 'POST');
  assert.equal(requested.url, `${BASE_URL}/spaces/spc_test/models/${MODEL_KEY}/records/query`);
  assert.deepEqual(requested.body, {
    search: { text: 'milk' },
    filter: {
      and: [
        { field: 'status', op: 'eq', value: 'open' },
        { field: 'score', op: 'gte', value: 3 },
        {
          field: 'createdAt',
          op: 'within',
          value: {
            kind: 'local_date_window',
            startDate: '2026-09-10',
            endDateExclusive: '2026-09-11',
            timezone: 'Asia/Shanghai',
          },
        },
      ],
    },
    sort: [{ field: 'dueDate', direction: 'asc' }],
    page: { limit: 20 },
  });
});

test('registered Agent Tool execute path handles n8n tool simulation input', async () => {
  let requested;
  const execution = context(
    baseParameters,
    (options) => {
      requested = options;
      return { data: { items: [{ id: 'rec_1', data: { name: 'Milk' } }], nextCursor: null } };
    },
    [{
      json: {
        sessionId: 'session_test',
        action: 'sendMessage',
        chatInput: 'find milk',
        search: 'milk',
        sort: [{ field: 'dueDate', direction: 'asc' }],
        limit: 20,
        toolCallId: 'call_test',
      },
    }],
  );

  const node = new LifeSpaceAgentTool();
  assert.equal(typeof node.execute, 'function');

  const result = await node.execute.call(execution);
  assert.equal(requested.method, 'POST');
  assert.equal(requested.url, `${BASE_URL}/spaces/spc_test/models/${MODEL_KEY}/records/query`);
  assert.deepEqual(requested.body, {
    search: { text: 'milk' },
    sort: [{ field: 'dueDate', direction: 'asc' }],
    page: { limit: 20 },
  });
  assert.deepEqual(JSON.parse(result[0][0].json.response), {
    data: { items: [{ id: 'rec_1', data: { name: 'Milk' } }], nextCursor: null },
  });
});

test('registered Agent Tool execute path still validates semantic arguments after envelope projection', async () => {
  const execution = context(
    baseParameters,
    () => {
      throw new Error('business request must not run for invalid semantic input');
    },
    [{
      json: {
        action: 'sendMessage',
        chatInput: 'bad query',
        filters: [{ field: 'unknownField', operator: 'eq', value: 'x' }],
        toolCallId: 'call_invalid',
      },
    }],
  );

  const node = new LifeSpaceAgentTool();
  const result = await node.execute.call(execution);
  const failure = JSON.parse(result[0][0].json.response);
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, 'INVALID_QUERY_FILTER_FIELD');
  assert.equal(failure.error.field, 'unknownField');
  assert.ok(Array.isArray(failure.error.allowedFields));
});

test('registered Agent Tool delegates Create while preserving omission semantics', async () => {
  let requested;
  const execution = context({ ...baseParameters, operation: 'create' }, (options) => {
    requested = options;
    return { data: { id: 'rec_1', version: 1, data: options.body } };
  });

  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;
  assert.deepEqual(tool.schema.required, ['name']);
  assert.equal(tool.schema.properties.status.default, 'open');

  await tool.invoke({ name: 'Buy milk' });
  assert.equal(requested.method, 'POST');
  assert.deepEqual(requested.body, { name: 'Buy milk' });
  assert.equal(Object.hasOwn(requested.body, 'status'), false);
});
