import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { genericQuerySchema, compileGenericQuery } = require('../dist/nodes/agent/lifeSpaceGenericQueryTool.js');
const { queryPredicates } = require('../dist/nodes/shared/lifeSpaceQuerySemantics.js');
const { humanFilterOperatorSelector, projectHumanFilterBuilder } = require('../dist/nodes/LifeSpaceWorkflow/humanProjection.js');
const { buildAgentToolDefinition } = require('../dist/nodes/agent/lifeSpaceToolFactory.js');
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');

const model = {
  key: 'event',
  fields: [
    { key: 'summary', type: 'string', required: true },
    { key: 'location', type: 'location', title: 'Location', nullable: true,
      valueSchema: { type: 'object', required: ['name'], additionalProperties: false,
        properties: { name: { type: 'string' }, coordinates: { type: 'object' } } } },
  ],
  query: {
    canonical: {
      search: null,
      filter: { maxNodes: 100, targets: [
        { field: 'location', kind: 'field', valueType: 'location',
          operators: ['withinDistance', 'isNull', 'isNotNull'], nullable: true },
      ] },
      sort: { fields: ['createdAt'], directions: ['asc', 'desc'], maxCriteria: 8 },
      pagination: { limit: { minimum: 1, maximum: 200 }, cursor: {} },
    },
  },
};

const point = { point: { latitude: 31, longitude: 121 }, meters: 500 };

test('Location is offered as spatial filter from the authoritative Discovery', () => {
  const predicates = queryPredicates(model);
  assert.deepEqual(predicates.map((entry) => entry.operator), ['withinDistance', 'isNull', 'isNotNull']);
  const schema = genericQuerySchema(model);
  const branches = schema.properties.filters.items.oneOf;
  const distance = branches.find((branch) => branch.properties.operator.enum.includes('withinDistance'));
  assert.deepEqual(distance.properties.value.required, ['point', 'meters']);
  assert.equal(distance.properties.value.properties.point.properties.latitude.minimum, -90);
});

test('n8n Agent query lowers Location coordinates without geocoding', () => {
  const result = compileGenericQuery(model, { filters: [{ field: 'location', operator: 'withinDistance', value: point }], limit: 25 });
  assert.deepEqual(result.filter, { field: 'location', op: 'withinDistance', value: point });
  assert.deepEqual(result.page, { limit: 25 });
});

test('n8n rejects incomplete coordinates and invalid distances before calling LifeSpace', () => {
  for (const value of [
    { point: { latitude: 31 }, meters: 500 },
    { point: { latitude: 99, longitude: 121 }, meters: 500 },
    { point: { latitude: 31, longitude: 121 }, meters: 0 },
    { point: { latitude: 31, longitude: 121 }, meters: 5000001 },
  ]) {
    assert.throws(() => compileGenericQuery(model, {
      filters: [{ field: 'location', operator: 'withinDistance', value }],
    }));
  }
});

test('n8n human query JSON input preserves typed withinDistance value', () => {
  const predicate = queryPredicates(model)[0];
  const result = projectHumanFilterBuilder(
    { getNode: () => ({ name: 'LifeSpace' }) },
    'all',
    [{ field: 'location', operator: humanFilterOperatorSelector(predicate),
      value: JSON.stringify(point) }],
    [],
  );
  assert.deepEqual(result, [{ field: 'location', op: 'withinDistance', value: point }]);
});

test('Agent Create exposes the Discovery-provided Location object schema (not a string)', () => {
  const definition = buildAgentToolDefinition({
    ...model,
    schemaHash: 'sha256:location-model',
    display: { singular: 'Event', plural: 'Events' },
    description: null,
    access: ['read', 'write'],
    defaults: {},
    actions: [],
  }, { spaceId: 'spc_test', operation: 'create' });
  const location = definition.schema.properties.location;
  const objectSchema = location.oneOf.find((branch) => branch.type === 'object');
  assert.deepEqual(objectSchema.required, ['name']);
  assert.equal(objectSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(objectSchema.properties), ['name', 'coordinates']);
});

test('Human Workflow Resource Mapper presents Location as a structured object', async () => {
  const inventory = {
    data: {
      semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
      models: [{ key: 'event', version: 7, schemaHash: 'sha256:location-model',
        display: { singular: 'Event', plural: 'Events' }, capabilities: [], actions: [] }],
      spaces: [{ spaceId: 'spc_test', spaceName: 'Test Space',
        models: [{ modelKey: 'event', access: ['read', 'write'] }] }],
    },
  };
  const detail = {
    data: {
      ...model,
      version: 7,
      schemaHash: 'sha256:location-model',
      display: { singular: 'Event', plural: 'Events' },
      declaredAccess: ['read', 'write'],
      defaults: {},
      actions: [],
      query: {
        ...model.query,
        searchable: [], filterable: [], sortable: [], search: null, filters: [],
        comparisons: [], capabilityQueries: [],
        sort: { parameter: 'sort', syntax: 'field:direction', repeatable: true,
          ordered: true, maxCriteria: 8, genericDefault: [], envelopeFields: [],
          nullPlacement: 'last', genericValues: [] },
        pagination: { limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
          cursor: { parameter: 'cursor', type: 'string' } },
      },
    },
  };
  const parameters = { spaceId: 'spc_test', recordType: 'event', operation: 'create' };
  const context = {
    getNode: () => ({ name: 'LifeSpace' }),
    getCredentials: async () => ({ baseUrl: 'https://example.invalid/api/v1' }),
    getNodeParameter: (key, fallback) => parameters[key] ?? fallback,
    getCurrentNodeParameter: (key) => parameters[key],
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        if (options.url.endsWith('/me/_discovery/inventory')) return inventory;
        if (options.url.endsWith('/spaces/spc_test/_discovery/models/event')) return detail;
        throw new Error('Unexpected Discovery request');
      },
    },
  };
  const node = new LifeSpaceWorkflow();
  const mapped = await node.methods.resourceMapping.getHumanRecordFields.call(context);
  const location = mapped.fields.find((field) => field.id === 'location');
  assert.ok(location, 'Location should be available in the Resource Mapper');
  assert.equal(location.type, 'object');
});
