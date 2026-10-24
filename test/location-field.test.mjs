import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { genericQuerySchema, compileGenericQuery } = require('../dist/nodes/agent/lifeSpaceGenericQueryTool.js');
const { queryPredicates } = require('../dist/nodes/shared/lifeSpaceQuerySemantics.js');
const { humanFilterOperatorSelector, projectHumanFilterBuilder } = require('../dist/nodes/LifeSpaceWorkflow/humanProjection.js');

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
  assert.deepEqual(result, { field: 'location', op: 'withinDistance', value: point });
});
