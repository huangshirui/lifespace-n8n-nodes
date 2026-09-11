import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');

function property(node, name) {
  const value = node.description.properties.find((entry) => entry.name === name);
  assert.ok(value, `missing parameter ${name}`);
  return value;
}

function semanticDetail(modelKey, capabilityQueries = []) {
  return {
    data: {
      key: modelKey,
      version: 1,
      schemaHash: `sha256:${modelKey}`,
      display: { singular: modelKey, plural: `${modelKey}s` },
      description: null,
      declaredAccess: ['read', 'write'],
      fields: [], defaults: {},
      query: {
        searchable: [], filterable: [], sortable: [], search: null, filters: [],
        comparisons: [], capabilityQueries,
        sort: {
          parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true,
          maxCriteria: 8, genericDefault: ['createdAt:desc'],
          envelopeFields: ['createdAt', 'updatedAt'], nullPlacement: 'last',
          genericValues: ['createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc'],
        },
        pagination: {
          limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
          cursor: { parameter: 'cursor', type: 'string' },
        },
      },
      actions: [], capabilities: capabilityQueries.length ? ['calendar'] : [], capabilityBindings: {},
    },
  };
}

function optionContext(modelKey, capabilityQueries = []) {
  const inventory = {
    data: {
      semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
      models: [{
        key: modelKey, version: 1, schemaHash: `sha256:${modelKey}`,
        display: { singular: modelKey, plural: `${modelKey}s` },
        capabilities: capabilityQueries.length ? ['calendar'] : [], actions: [],
      }],
      spaces: [{ spaceId: 'spc_test', spaceName: 'Test Space', models: [{ modelKey, access: ['read', 'write'] }] }],
    },
  };
  const parameters = { spaceId: 'spc_test', recordType: modelKey, operation: 'list' };
  return {
    getCredentials: async () => ({ baseUrl: 'https://example.invalid/api/v1' }),
    getNode: () => ({ name: 'LifeSpace' }),
    getNodeParameter(name, fallback) { return Object.hasOwn(parameters, name) ? parameters[name] : fallback; },
    getCurrentNodeParameter(name) { return Object.hasOwn(parameters, name) ? parameters[name] : undefined; },
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        if (options.url.endsWith('/me/_discovery/inventory')) return inventory;
        if (options.url.endsWith(`/spaces/spc_test/_discovery/models/${modelKey}`)) return semanticDetail(modelKey, capabilityQueries);
        throw new Error(`Unexpected request ${options.method} ${options.url}`);
      },
    },
  };
}

test('normal LifeSpace node is the single Agent Tool surface and runtime selectors remain AI-fillable', async () => {
  const node = new LifeSpace();
  assert.equal(node.description.usableAsTool, true);
  assert.equal(property(node, 'resource').noDataExpression, true);
  assert.equal(property(node, 'operation').noDataExpression, true);
  assert.equal(property(node, 'spaceId').noDataExpression, undefined);
  assert.equal(property(node, 'recordType').noDataExpression, undefined);
  assert.equal(property(node, 'recordId').noDataExpression, undefined);

  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(packageJson.n8n.nodes, [
    'dist/nodes/LifeSpace/LifeSpace.node.js',
    'dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js',
  ]);
});

test('List Query no longer exposes dead top-level Time or Capability controls', () => {
  const node = new LifeSpace();
  const names = node.description.properties.map((entry) => entry.name);
  assert.equal(names.includes('localDateWindows'), false);

  const queryMode = property(node, 'queryMode');
  assert.equal(queryMode.noDataExpression, true);
  assert.equal(queryMode.default, 'standard');

  const filters = property(node, 'filters');
  assert.ok(filters.options.some((entry) => entry.name === 'localDateWindow'));
  assert.deepEqual(filters.displayOptions.show.queryMode, ['standard']);
  assert.deepEqual(property(node, 'search').displayOptions.show.queryMode, ['standard']);
  assert.deepEqual(property(node, 'sorts').displayOptions.show.queryMode, ['standard']);

  const capability = property(node, 'semanticQueryKey');
  assert.equal(capability.displayName, 'Capability Query Name or ID');
  assert.equal(capability.required, true);
  assert.equal(capability.noDataExpression, true);
  assert.deepEqual(capability.displayOptions.show.queryMode, ['capability']);
  assert.deepEqual(property(node, 'semanticQueryInput').displayOptions.show.queryMode, ['capability']);
  assert.deepEqual(property(node, 'semanticSort').displayOptions.show.queryMode, ['capability']);
});

test('Capability Query mode is advertised only by published Discovery metadata', async () => {
  const node = new LifeSpace();
  const ordinary = await node.methods.loadOptions.getQueryModes.call(optionContext('task'));
  assert.deepEqual(ordinary.map((entry) => entry.value), ['standard']);

  const calendarWindow = {
    key: 'calendar.window', capability: 'calendar', semantics: 'record-interval-overlap', recurrenceExpansion: false,
    parameters: [
      { parameter: 'windowStartDate', type: 'date', required: true, role: 'window-start-date' },
      { parameter: 'windowEndDateExclusive', type: 'date', required: true, role: 'window-end-date-exclusive' },
      { parameter: 'viewingTimezone', type: 'timezone', required: true, role: 'viewing-timezone' },
    ],
    ordering: { parameter: 'sort', values: ['calendarStart:asc'], default: 'calendarStart:asc' },
  };
  const calendar = await node.methods.loadOptions.getQueryModes.call(optionContext('event', [calendarWindow]));
  assert.deepEqual(calendar.map((entry) => entry.value), ['standard', 'capability']);
});
