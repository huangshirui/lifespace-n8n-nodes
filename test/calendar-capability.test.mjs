import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');
const { encodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');

const CALENDAR_RECORD_TYPE = encodeRecordTypeSelector('synthetic_calendar', 'synthetic-calendars');

const BASE_URL = 'https://example.invalid/api/v1';

const inventory = {
  data: {
    semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
    models: [{
      key: 'synthetic_calendar',
      route: 'synthetic-calendars',
      version: 1,
      schemaHash: 'sha256:synthetic-calendar-v1',
      display: { singular: 'Synthetic Calendar', plural: 'Synthetic Calendars' },
      capabilities: ['calendar'],
      actions: [],
    }],
    spaces: [{
      spaceId: 'spc_test',
      spaceName: 'Test Space',
      models: [{ modelKey: 'synthetic_calendar', access: ['read', 'write'] }],
    }],
  },
};

const detail = {
  data: {
    key: 'synthetic_calendar',
    route: 'synthetic-calendars',
    version: 1,
    schemaHash: 'sha256:synthetic-calendar-v1',
    display: { singular: 'Synthetic Calendar', plural: 'Synthetic Calendars' },
    description: 'Synthetic contract with intentionally unfamiliar Calendar field names.',
    declaredAccess: ['read', 'write'],
    fields: [
      { key: 'headline', type: 'string', title: 'Headline', required: true },
      { key: 'wholeDay', type: 'boolean', title: 'Whole Day', required: true },
      { key: 'instantBegin', type: 'datetime', title: 'Instant Begin', nullable: true },
      { key: 'instantFinish', type: 'datetime', title: 'Instant Finish', nullable: true },
      { key: 'zoneBegin', type: 'timezone', title: 'Zone Begin', nullable: true },
      { key: 'zoneFinish', type: 'timezone', title: 'Zone Finish', nullable: true },
      { key: 'calendarBegin', type: 'date', title: 'Calendar Begin', nullable: true },
      { key: 'calendarFinishExclusive', type: 'date', title: 'Calendar Finish Exclusive', nullable: true },
    ],
    defaults: {},
    query: {
      searchable: ['headline'],
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
    actions: [],
    capabilities: ['calendar'],
    capabilityBindings: {
      calendar: {
        allDayField: 'wholeDay',
        timedStartField: 'instantBegin',
        timedEndField: 'instantFinish',
        startTimezoneField: 'zoneBegin',
        endTimezoneField: 'zoneFinish',
        allDayStartField: 'calendarBegin',
        allDayEndExclusiveField: 'calendarFinishExclusive',
      },
    },
  },
};

function context(parameters, { rejectMutation = false } = {}) {
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
      async httpRequestWithAuthentication(_credentialName, options) {
        calls.push(options);
        if (options.url === `${BASE_URL}/me/_discovery/inventory`) return inventory;
        if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/synthetic_calendar`) return detail;
        if (options.url === `${BASE_URL}/spaces/spc_test/synthetic-calendars`) {
          if (rejectMutation) throw new Error('Core rejected contradictory Calendar semantics');
          return { data: { id: 'rec_created', version: 1, ...options.body } };
        }
        throw new Error(`Unexpected request ${options.method} ${options.url}`);
      },
    },
  };
}

const common = {
  resource: 'modelRecord',
  operation: 'create',
  spaceId: 'spc_test',
  recordType: CALENDAR_RECORD_TYPE,
  'singleRelations.relation': [],
  'multiRelations.relation': [],
};

test('all-day Calendar create normalizes configured date values without execution-time Discovery', async () => {
  const node = new LifeSpace();
  const ctx = context({
    ...common,
    'fields.value': { headline: 'All day', wholeDay: true },
    'dateFields.date': [
      { field: 'calendarBegin', value: '2026-09-08T09:15:00.000Z' },
      { field: 'calendarFinishExclusive', value: '2026-09-09T09:15:00.000Z' },
    ],
  });

  await node.execute.call(ctx);
  assert.deepEqual(ctx.calls.map((call) => [call.method, call.url]), [
    ['POST', `${BASE_URL}/spaces/spc_test/synthetic-calendars`],
  ]);
  const mutation = ctx.calls.at(-1);
  assert.deepEqual(mutation.body, {
    headline: 'All day',
    wholeDay: true,
    calendarBegin: '2026-09-08',
    calendarFinishExclusive: '2026-09-09',
  });
});

test('timed Calendar create executes directly without model-specific field names or Discovery', async () => {
  const node = new LifeSpace();
  const ctx = context({
    ...common,
    'fields.value': {
      headline: 'Timed',
      wholeDay: false,
      instantBegin: '2026-09-08T09:00:00.000Z',
      instantFinish: '2026-09-08T10:00:00.000Z',
      zoneBegin: 'Europe/Amsterdam',
      zoneFinish: 'Europe/Amsterdam',
    },
    'dateFields.date': [],
  });

  await node.execute.call(ctx);
  assert.deepEqual(ctx.calls.map((call) => [call.method, call.url]), [
    ['POST', `${BASE_URL}/spaces/spc_test/synthetic-calendars`],
  ]);
  const mutation = ctx.calls.at(-1);
  assert.equal(mutation.body.wholeDay, false);
  assert.equal(mutation.body.instantBegin, '2026-09-08T09:00:00.000Z');
});

test('Calendar semantic conflicts are left to authoritative Core validation instead of a Discovery preflight', async () => {
  const node = new LifeSpace();
  const ctx = context({
    ...common,
    'fields.value': {
      headline: 'Conflict',
      wholeDay: true,
      instantBegin: '2026-09-08T09:00:00.000Z',
    },
    'dateFields.date': [{ field: 'calendarBegin', value: '2026-09-08' }],
  }, { rejectMutation: true });

  await assert.rejects(
    () => node.execute.call(ctx),
    /Core rejected contradictory Calendar semantics/u,
  );
  assert.deepEqual(ctx.calls.map((call) => [call.method, call.url]), [
    ['POST', `${BASE_URL}/spaces/spc_test/synthetic-calendars`],
  ]);
});
