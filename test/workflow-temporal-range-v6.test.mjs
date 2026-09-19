import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');
const {
  canonicalTimeWindowSelector,
  projectCanonicalTimeWindows,
  projectHumanTemporalRanges,
  projectMutationValues,
} = require('../dist/nodes/LifeSpaceWorkflow/humanProjection.js');

const BASE_URL = 'https://example.invalid/api/v1';

const inventory = {
  data: {
    semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
    models: [{
      key: 'event',
      version: 6,
      schemaHash: 'sha256:event-v6',
      display: { singular: 'Event', plural: 'Events' },
      capabilities: ['calendar'],
      actions: [{ key: 'reschedule', access: 'write', kind: 'workflow' }],
    }],
    spaces: [{
      spaceId: 'spc_test',
      spaceName: 'Test Space',
      models: [{ modelKey: 'event', access: ['read', 'write'] }],
    }],
  },
};

const canonical = {
  invocation: {
    method: 'POST',
    pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query',
  },
  composition: {
    selectionFacets: ['search', 'filter'],
    selectionCombine: 'intersection',
    ordering: 'sort',
    pagination: 'cursor-pagination',
  },
  search: { fields: ['summary'], minLength: 1, maxLength: 100 },
  filter: {
    maxDepth: 8,
    maxNodes: 100,
    targets: [
      {
        field: 'when',
        kind: 'field',
        valueType: 'temporal_range',
        operators: ['overlaps', 'contains', 'before', 'after', 'kindIs'],
        nullable: false,
      },
      {
        field: 'startsAt',
        kind: 'field',
        valueType: 'instant',
        operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'within'],
        nullable: true,
      },
      {
        field: 'vacationWindow',
        kind: 'field',
        valueType: 'range<date>',
        operators: ['overlaps', 'contains', 'before', 'after'],
        nullable: true,
      },
    ],
  },
  sort: {
    fields: ['createdAt', 'updatedAt', 'when', 'startsAt'],
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
      binds: [
        'normalized-search',
        'normalized-filter',
        'effective-sort',
        'temporal-viewing-context',
        'continuation-key',
      ],
      snapshotConsistency: false,
    },
  },
};

const detail = {
  data: {
    key: 'event',
    version: 6,
    schemaHash: 'sha256:event-v6',
    display: { singular: 'Event', plural: 'Events' },
    description: 'Current Event TemporalRange fixture.',
    declaredAccess: ['read', 'write'],
    fields: [
      { key: 'summary', type: 'string', title: 'Summary', required: true },
      { key: 'when', type: 'temporal_range', title: 'When', required: true },
      { key: 'startsAt', type: 'instant', title: 'Starts At' },
      { key: 'vacationWindow', type: 'range<date>', title: 'Vacation Window' },
      { key: 'busyWindow', type: 'range<instant>', title: 'Busy Window' },
      { key: 'attendeePersonIds', type: 'person_list', title: 'Attendees' },
    ],
    defaults: {},
    query: {
      searchable: ['summary'],
      filterable: ['when', 'startsAt', 'vacationWindow'],
      sortable: ['when', 'startsAt'],
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
        genericValues: ['createdAt:desc', 'when:asc', 'when:desc', 'startsAt:asc', 'startsAt:desc'],
      },
      pagination: {
        limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
        cursor: { parameter: 'cursor', type: 'string' },
      },
      canonical,
    },
    actions: [{
      key: 'reschedule',
      access: 'write',
      kind: 'workflow',
      input: {
        fields: [{ key: 'when', type: 'temporal_range', title: 'When', required: true }],
      },
    }],
    capabilities: ['calendar'],
    capabilityBindings: {
      calendar: {
        rangeField: 'when',
        attendeePersonField: 'attendeePersonIds',
      },
    },
  },
};

function designContext(parameters = {}) {
  const values = {
    spaceId: 'spc_test',
    recordType: 'event',
    operation: 'create',
    ...parameters,
  };
  return {
    getCredentials: async () => ({ baseUrl: BASE_URL }),
    getNode: () => ({ name: 'LifeSpace' }),
    getNodeParameter(name, fallback) {
      return Object.hasOwn(values, name) ? values[name] : fallback;
    },
    getCurrentNodeParameter(name) {
      return Object.hasOwn(values, name) ? values[name] : undefined;
    },
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        if (options.url === `${BASE_URL}/me/_discovery/inventory`) return inventory;
        if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/event`) return detail;
        throw new Error(`Unexpected request ${options.method} ${options.url}`);
      },
    },
  };
}

test('ordinary Workflow projects TemporalRange mutations through a dedicated human form', async () => {
  const node = new LifeSpaceWorkflow();
  const createFields = await node.methods.resourceMapping.getHumanRecordFields.call(designContext());
  const byName = Object.fromEntries(createFields.fields.map((field) => [field.displayName, field]));

  assert.equal(byName.Summary.type, 'string');
  assert.equal(byName.When, undefined);
  assert.equal(byName['Starts At'].type, 'dateTime');
  assert.equal(byName['Vacation Window'].type, 'object');
  assert.equal(byName['Busy Window'].type, 'object');

  const temporalFields = await node.methods.loadOptions.getHumanTemporalRangeFields.call(
    designContext({ operation: 'create' }),
  );
  assert.deepEqual(temporalFields.map((option) => [option.name, option.value]), [
    ['When (Required)', 'when'],
  ]);

  const temporalProperty = node.description.properties.find((entry) => entry.name === 'humanTemporalRanges');
  assert.ok(temporalProperty);
  assert.deepEqual(temporalProperty.displayOptions.show.operation, ['create', 'update']);
  const values = temporalProperty.options[0].values;
  assert.deepEqual(values.find((entry) => entry.name === 'kind')?.options.map((option) => option.value), ['date', 'instant']);
  assert.equal(values.find((entry) => entry.name === 'dateStart')?.typeOptions.dateOnly, true);
  assert.equal(values.find((entry) => entry.name === 'dateEnd')?.typeOptions.dateOnly, true);

  const actionFields = await node.methods.resourceMapping.getActionInputFields.call(
    designContext({ operation: 'executeAction', actionKey: 'reschedule' }),
  );
  assert.deepEqual(actionFields.fields.map((field) => [field.displayName, field.type, field.required]), [
    ['When', 'object', true],
  ]);
});

test('ordinary Workflow exposes current TemporalRange query predicates and kind selector', async () => {
  const node = new LifeSpaceWorkflow();
  const filters = await node.methods.resourceMapping.getHumanQueryFilterFields.call(
    designContext({ operation: 'list' }),
  );
  const overlaps = filters.fields.find((field) => field.displayName === 'When — Overlaps');
  const kind = filters.fields.find((field) => field.displayName === 'When — Range Kind Is');

  assert.equal(overlaps?.type, 'object');
  assert.equal(kind?.type, 'options');
  assert.deepEqual(kind?.options?.map((option) => [option.name, option.value]), [
    ['Date', 'date'],
    ['Instant', 'instant'],
  ]);

  const operators = await node.methods.loadOptions.getCanonicalFilterOperators.call(
    designContext({ operation: 'list', '&field': 'when' }),
  );
  assert.deepEqual(operators.map((option) => option.name), [
    'Overlaps Start',
    'Overlaps End',
    'Before',
    'After',
    'Range Kind Is',
  ]);

  const timeWindows = await node.methods.loadOptions.getCanonicalTimeWindowFields.call(
    designContext({ operation: 'list' }),
  );
  assert.ok(timeWindows.some((option) => option.name === 'when — overlaps'));
});

test('ordinary Workflow normalizes date-shaped Range mutation values but preserves canonical object shape', async () => {
  const node = new LifeSpaceWorkflow();
  const fields = await node.methods.resourceMapping.getHumanRecordFields.call(designContext());
  const when = fields.fields.find((field) => field.displayName === 'When');
  const vacation = fields.fields.find((field) => field.displayName === 'Vacation Window');
  assert.ok(when);
  assert.ok(vacation);

  const projected = projectMutationValues({
    [when.id]: {
      kind: 'date',
      start: '2026-09-20T00:00:00.000Z',
      endExclusive: '2026-09-22T00:00:00.000Z',
    },
    [vacation.id]: {
      start: '2026-10-01T00:00:00.000Z',
      endExclusive: '2026-10-08T00:00:00.000Z',
    },
  }, fields.fields);

  assert.deepEqual(projected.when, {
    kind: 'date',
    start: '2026-09-20',
    endExclusive: '2026-09-22',
  });
  assert.deepEqual(projected.vacationWindow, {
    start: '2026-10-01',
    endExclusive: '2026-10-08',
  });
});

test('Create and Update TemporalRange form lowers all-day End as inclusive human date', () => {
  const projected = projectHumanTemporalRanges(
    { getNode: () => ({ name: 'LifeSpace' }) },
    [{
      field: 'when',
      kind: 'date',
      dateStart: '2026-09-20',
      dateEnd: '2026-09-22',
    }],
  );

  assert.deepEqual(projected, {
    when: {
      kind: 'date',
      start: '2026-09-20',
      endExclusive: '2026-09-23',
    },
  });
});

test('Create and Update TemporalRange form normalizes timed values and validates ordering', () => {
  const context = { getNode: () => ({ name: 'LifeSpace' }) };
  const projected = projectHumanTemporalRanges(context, [{
    field: 'when',
    kind: 'instant',
    instantStart: '2026-09-20T10:00:00+08:00',
    instantEnd: '2026-09-20T11:30:00+08:00',
  }]);

  assert.deepEqual(projected, {
    when: {
      kind: 'instant',
      start: '2026-09-20T02:00:00.000Z',
      endExclusive: '2026-09-20T03:30:00.000Z',
    },
  });

  assert.throws(
    () => projectHumanTemporalRanges(context, [{
      field: 'when',
      kind: 'instant',
      instantStart: '2026-09-20T11:30:00+08:00',
      instantEnd: '2026-09-20T10:00:00+08:00',
    }]),
    /End must be later than Start/u,
  );

  assert.throws(
    () => projectHumanTemporalRanges(context, [
      {
        field: 'when',
        kind: 'date',
        dateStart: '2026-09-20',
        dateEnd: '2026-09-20',
      },
      {
        field: 'when',
        kind: 'date',
        dateStart: '2026-09-21',
        dateEnd: '2026-09-21',
      },
    ]),
    /configured more than once/u,
  );
});

test('ordinary Workflow local-date-window convenience targets canonical TemporalRange predicates', () => {
  const projected = projectCanonicalTimeWindows([{
    target: canonicalTimeWindowSelector('when', 'overlaps'),
    startDate: '2026-09-20T00:00:00.000Z',
    endDateExclusive: '2026-09-21T00:00:00.000Z',
    timezone: 'Asia/Shanghai',
  }]);
  assert.deepEqual(projected, [{
    field: 'when',
    op: 'overlaps',
    value: {
      kind: 'local_date_window',
      startDate: '2026-09-20',
      endDateExclusive: '2026-09-21',
      timezone: 'Asia/Shanghai',
    },
  }]);
});

test('ordinary Workflow defaults TemporalRange sort timezone to n8n and allows an Options override', async () => {
  const node = new LifeSpaceWorkflow();
  const sortOptions = await node.methods.loadOptions.getSortableFields.call(
    designContext({ operation: 'list' }),
  );
  const whenSort = sortOptions.find((option) => option.name === 'When');
  assert.ok(whenSort);
  assert.notEqual(whenSort.value, 'when');

  const calls = [];
  const parameters = {
    resource: 'modelRecord',
    operation: 'list',
    spaceId: 'spc_test',
    recordType: 'event',
    modelRoute: '',
    search: '',
    returnAll: false,
    limit: 20,
    options: {},
    'sorts.sort': [{ field: whenSort.value, direction: 'asc' }],
    'queryFilters.value': {},
    'queryTimeWindows.window': [],
  };
  const context = {
    getInputData: () => [{ json: {} }],
    getCredentials: async () => ({ baseUrl: BASE_URL }),
    getNode: () => ({ name: 'LifeSpace' }),
    getTimezone: () => 'Asia/Shanghai',
    getNodeParameter(name, _itemIndex, fallback) {
      return Object.hasOwn(parameters, name) ? parameters[name] : fallback;
    },
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ credentialName, options });
        return { data: { items: [], nextCursor: null } };
      },
    },
  };

  await node.execute.call(context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.url, `${BASE_URL}/spaces/spc_test/models/event/records/query`);
  assert.deepEqual(calls[0].options.body, {
    sort: [{ field: 'when', direction: 'asc' }],
    context: { viewingTimezone: 'Asia/Shanghai' },
    page: { limit: 20 },
  });

  calls.length = 0;
  parameters.options = { viewingTimezone: 'Asia/Tokyo' };
  await node.execute.call(context);
  assert.deepEqual(calls[0].options.body.context, { viewingTimezone: 'Asia/Tokyo' });
});
