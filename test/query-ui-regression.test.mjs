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

test('List Query exposes one canonical Search, grouped Filter, Sort, and Pagination surface', () => {
  const node = new LifeSpaceWorkflow();
  assert.equal(node.description.properties.some((entry) => entry.name === 'filters'), false);

  const match = property(node, 'queryFilterMatch');
  assert.equal(match.type, 'options');
  assert.deepEqual(match.options.map((entry) => entry.value), ['all', 'any']);

  const conditions = property(node, 'queryFilterConditions');
  assert.equal(conditions.type, 'fixedCollection');
  assert.equal(conditions.typeOptions.fixedCollection.layout, 'inline');
  assert.equal(conditions.typeOptions.multipleValueButtonText, 'Add Condition');
  const conditionValues = conditions.options[0].values;
  const field = conditionValues.find((entry) => entry.name === 'field');
  const operator = conditionValues.find((entry) => entry.name === 'operator');
  assert.equal(field?.displayName, 'Field');
  assert.equal(field?.type, 'options');
  assert.equal(field?.typeOptions.loadOptionsMethod, 'getCanonicalFilterFields');
  assert.equal(operator?.displayName, 'Operator');
  assert.equal(operator?.type, 'options');
  assert.equal(operator?.typeOptions.loadOptionsMethod, 'getCanonicalFilterOperators');
  assert.ok(operator?.typeOptions.loadOptionsDependsOn.includes('&field'));
  assert.equal(conditionValues.find((entry) => entry.name === 'value')?.type, 'string');

  const groups = property(node, 'queryFilterGroups');
  assert.equal(groups.type, 'fixedCollection');
  const groupValues = groups.options[0].values;
  assert.equal(groupValues.find((entry) => entry.name === 'match')?.type, 'options');
  const nestedConditions = groupValues.find((entry) => entry.name === 'conditions');
  assert.equal(nestedConditions?.type, 'fixedCollection');
  assert.equal(nestedConditions?.typeOptions.fixedCollection.layout, 'inline');
  assert.equal(nestedConditions?.typeOptions.multipleValueButtonText, 'Add Condition');

  assert.equal(node.description.parameterPane, 'wide');
  assert.equal(node.description.properties.some((entry) => entry.name === 'queryFilters'), false);
  assert.equal(node.description.properties.some((entry) => entry.name === 'queryTimeWindows'), false);

  const sorts = property(node, 'sorts');
  assert.equal(Object.hasOwn(sorts.displayOptions.show, 'queryMode'), false);

  for (const removed of ['queryMode', 'semanticQueryKey', 'semanticQueryInput', 'semanticSort', 'localDateWindows']) {
    assert.equal(node.description.properties.some((entry) => entry.name === removed), false, `unexpected legacy field ${removed}`);
  }
});
