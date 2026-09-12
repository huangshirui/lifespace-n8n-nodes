import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');

const BASE_URL = 'https://example.invalid/api/v1';

const explicitOperators = (field) => ['eq', 'lt', 'lte', 'gt', 'gte'].map((operator) => ({
  operator,
  parameter: `${field}.${operator}`,
  transport: 'explicit',
}));

const inventory = {
  data: {
    semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
    models: [{
      key: 'event', version: 9, schemaHash: 'sha256:synthetic-event-v9',
      display: { singular: 'Event', plural: 'Events' }, capabilities: ['calendar'], actions: [],
    }],
    spaces: [{ spaceId: 'spc_test', spaceName: 'Test Space', models: [{ modelKey: 'event', access: ['read'] }] }],
  },
};

const detail = {
  data: {
    key: 'event', version: 9, schemaHash: 'sha256:synthetic-event-v9',
    display: { singular: 'Event', plural: 'Events' }, description: 'Synthetic Time Semantics fixture.',
    declaredAccess: ['read'],
    fields: [
      { key: 'score', type: 'number', title: 'Score' },
      { key: 'dueDate', type: 'date', title: 'Due Date' },
      { key: 'startsAt', type: 'datetime', title: 'Starts At' },
    ],
    defaults: {},
    query: {
      searchable: [], filterable: ['score', 'dueDate', 'startsAt'], sortable: ['startsAt'],
      comparisons: [
        { field: 'score', source: 'model', valueType: 'number', operators: explicitOperators('score') },
        { field: 'dueDate', source: 'model', valueType: 'date', operators: explicitOperators('dueDate') },
        {
          field: 'startsAt', source: 'model', valueType: 'datetime', operators: explicitOperators('startsAt'),
          localDateWindow: {
            dateStartParameter: 'startsAt.dateStart', dateEndExclusiveParameter: 'startsAt.dateEndExclusive',
            timezoneParameter: 'startsAt.timezone', bounds: '[)', lowerOperator: 'gte', upperOperator: 'lt',
          },
        },
        {
          field: 'createdAt', source: 'envelope', valueType: 'datetime', operators: explicitOperators('createdAt'),
          localDateWindow: {
            dateStartParameter: 'createdAt.dateStart', dateEndExclusiveParameter: 'createdAt.dateEndExclusive',
            timezoneParameter: 'createdAt.timezone', bounds: '[)', lowerOperator: 'gte', upperOperator: 'lt',
          },
        },
        { field: 'updatedAt', source: 'envelope', valueType: 'datetime', operators: explicitOperators('updatedAt') },
      ],
      sort: {
        parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8,
        genericDefault: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'],
      },
      capabilityQueries: [{
        key: 'calendar.window', capability: 'calendar', semantics: 'record-interval-overlap', recurrenceExpansion: false,
        parameters: [
          { parameter: 'windowStartDate', type: 'date', required: true, role: 'window-start-date' },
          { parameter: 'windowEndDateExclusive', type: 'date', required: true, role: 'window-end-date-exclusive' },
          { parameter: 'viewingTimezone', type: 'timezone', required: true, role: 'viewing-timezone' },
        ],
        ordering: {
          parameter: 'sort', values: ['calendarStart:asc', 'calendarStart:desc'], default: 'calendarStart:asc',
          dateBasis: 'viewing-timezone', allDayPlacement: 'before-timed-within-date', timedOrder: 'instant', tieBreaker: 'record-id-asc',
        },
      }],
    },
    actions: [], capabilities: ['calendar'], capabilityBindings: {},
  },
};

function designContext(parameters = {}) {
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
        if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/event`) return detail;
        throw new Error(`Unexpected request ${options.method} ${options.url}`);
      },
    },
  };
}

function executeContext(parameters) {
  const calls = [];
  return {
    calls,
    getInputData: () => [{ json: {} }],
    getCredentials: async () => ({ baseUrl: BASE_URL }),
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ credentialName, options });
        return { data: { items: [], nextCursor: null } };
      },
    },
  };
}

function baseListParameters(overrides = {}) {
  return {
    resource: 'modelRecord', operation: 'list', spaceId: 'spc_test', recordType: 'event', search: '',
    returnAll: false, limit: 20, options: {}, 'sorts.sort': [], 'filters.filter': [], filters: {},
    'localDateWindows.window': [], 'semanticQueryInput.value': {}, semanticSort: '',
    ...overrides,
  };
}

test('progressive semantic detail exposes envelope comparisons and exact explicit operator transport', async () => {
  const node = new LifeSpace();
  const fieldsContext = designContext({ spaceId: 'spc_test', recordType: 'event', operation: 'list' });
  const fields = await node.methods.loadOptions.getTemporalComparisonFields.call(fieldsContext);
  assert.deepEqual(fields.map((entry) => entry.value), ['date:dueDate', 'datetime:startsAt', 'datetime:createdAt', 'datetime:updatedAt']);

  const operatorContext = designContext({ spaceId: 'spc_test', recordType: 'event', operation: 'list', '&field': 'datetime:createdAt' });
  const operators = await node.methods.loadOptions.getComparisonOperatorsForCurrentField.call(operatorContext);
  assert.deepEqual(operators.map((entry) => entry.value), ['createdAt.eq', 'createdAt.lt', 'createdAt.lte', 'createdAt.gt', 'createdAt.gte']);
});

test('explicit comparisons persist published parameter names and List execution performs no Discovery request', async () => {
  const node = new LifeSpace();
  const context = executeContext(baseListParameters({
    filters: {
      numberComparison: [{ field: 'number:score', parameter: 'score.lt', value: 7.5 }],
      temporalComparison: [
        { field: 'date:dueDate', parameter: 'dueDate.gte', value: '2026-09-10T00:00:00.000Z' },
        { field: 'datetime:createdAt', parameter: 'createdAt.lt', value: '2026-09-11T00:00:00.000Z' },
      ],
    },
  }));
  await node.execute.call(context);
  assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0].options.url, `${BASE_URL}/spaces/spc_test/models/event/records`);
  assert.deepEqual(context.calls[0].options.qs, {
    limit: 20, 'score.lt': 7.5, 'dueDate.gte': '2026-09-10', 'createdAt.lt': '2026-09-11T00:00:00.000Z',
  });
});

test('local date window selector carries published transport and leaves timezone conversion to Core', async () => {
  const node = new LifeSpace();
  const design = designContext({ spaceId: 'spc_test', recordType: 'event', operation: 'list' });
  const windows = await node.methods.loadOptions.getLocalDateWindowFields.call(design);
  const createdAt = windows.find((entry) => entry.name === 'Created At');
  assert.ok(createdAt);

  const context = executeContext(baseListParameters({
    filters: { localDateWindow: [{
      field: createdAt.value,
      dateStart: '2026-09-10T00:00:00.000+02:00',
      dateEndExclusive: '2026-09-11T00:00:00.000+02:00',
      timezone: 'Europe/Amsterdam',
    }] },
  }));
  await node.execute.call(context);
  assert.deepEqual(context.calls[0].options.qs, {
    limit: 20,
    'createdAt.dateStart': '2026-09-10',
    'createdAt.dateEndExclusive': '2026-09-11',
    'createdAt.timezone': 'Europe/Amsterdam',
  });
  assert.equal(Object.values(context.calls[0].options.qs).some((value) => String(value).includes('T22:')), false);
});

test('capability query UI is generated from capabilityQueries and execution submits mapper keys unchanged', async () => {
  const node = new LifeSpace();
  const design = designContext({ spaceId: 'spc_test', recordType: 'event', operation: 'list', semanticQueryKey: 'calendar.window' });
  const queries = await node.methods.loadOptions.getCapabilityQueries.call(design);
  assert.deepEqual(queries.map((entry) => entry.value), ['calendar.window']);
  const fields = await node.methods.resourceMapping.getSemanticQueryInputFields.call(design);
  assert.deepEqual(fields.fields.map((field) => [field.id, field.required, field.type]), [
    ['windowStartDate', true, 'string'],
    ['windowEndDateExclusive', true, 'string'],
    ['viewingTimezone', true, 'string'],
  ]);
  const sorts = await node.methods.loadOptions.getSemanticSorts.call(design);
  assert.deepEqual(sorts.map((entry) => entry.value), ['calendarStart:asc', 'calendarStart:desc']);

  const context = executeContext(baseListParameters({
    'semanticQueryInput.value': {
      windowStartDate: '2026-09-10', windowEndDateExclusive: '2026-09-11', viewingTimezone: 'Asia/Shanghai',
    },
    semanticSort: 'calendarStart:desc',
  }));
  await node.execute.call(context);
  assert.equal(context.calls.length, 1);
  assert.deepEqual(context.calls[0].options.qs, {
    sort: 'calendarStart:desc', limit: 20,
    windowStartDate: '2026-09-10', windowEndDateExclusive: '2026-09-11', viewingTimezone: 'Asia/Shanghai',
  });
});

test('legacy exact/from/to filters remain compatible and preserve inclusive To transport', async () => {
  const node = new LifeSpace();
  const context = executeContext(baseListParameters({
    'filters.filter': [
      { field: 'dueDate', operator: 'from', value: '2026-09-01' },
      { field: 'dueDate', operator: 'to', value: '2026-09-30' },
    ],
  }));
  await node.execute.call(context);
  assert.deepEqual(context.calls[0].options.qs, { limit: 20, dueDateFrom: '2026-09-01', dueDateTo: '2026-09-30' });
});
