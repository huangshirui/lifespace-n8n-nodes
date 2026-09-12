import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');

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

test('workflow node is a human-only projection with Discovery-driven Create fields', async () => {
  const node = new LifeSpaceWorkflow();
  assert.equal(node.description.usableAsTool, undefined);
  assert.equal(property(node, 'fields').type, 'resourceMapper');
  assert.equal(property(node, 'fields').typeOptions.resourceMapper.resourceMapperMethod, 'getHumanRecordFields');
  assert.equal(node.description.properties.some((entry) => entry.name === 'dateFields'), false);
  assert.equal(node.description.properties.some((entry) => entry.name === 'singleRelations'), false);
  assert.ok(node.description.properties.some((entry) => entry.name === 'multiRelations'));

  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(packageJson.n8n.nodes, [
    'dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js',
    'dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js',
    'dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js',
  ]);
});

test('List Query exposes semantic filter mapper instead of field-type buckets', () => {
  const node = new LifeSpaceWorkflow();
  assert.equal(node.description.properties.some((entry) => entry.name === 'filters'), false);

  const queryFilters = property(node, 'queryFilters');
  assert.equal(queryFilters.type, 'resourceMapper');
  assert.equal(queryFilters.typeOptions.resourceMapper.resourceMapperMethod, 'getHumanQueryFilterFields');
  assert.deepEqual(queryFilters.displayOptions.show.queryMode, ['standard']);

  const localWindows = property(node, 'localDateWindows');
  assert.equal(localWindows.displayName, 'Advanced Local Date Windows');
  assert.deepEqual(localWindows.displayOptions.show.queryMode, ['standard']);

  const queryMode = property(node, 'queryMode');
  assert.equal(queryMode.displayName, 'Query Type');
  assert.equal(queryMode.default, 'standard');

  const capability = property(node, 'semanticQueryKey');
  assert.equal(capability.displayName, 'Capability Query');
  assert.deepEqual(capability.displayOptions.show.queryMode, ['capability']);
});

test('Capability Query mode is advertised only by published Discovery metadata', async () => {
  const node = new LifeSpaceWorkflow();
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
