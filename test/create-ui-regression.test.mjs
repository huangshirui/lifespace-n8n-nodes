import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');

function property(node, name) {
  const value = node.description.properties.find((entry) => entry.name === name);
  assert.ok(value, `missing parameter ${name}`);
  return value;
}

function semanticDetail() {
  return {
    data: {
      key: 'task',
      version: 1,
      schemaHash: 'sha256:task',
      display: { singular: 'Task', plural: 'Tasks' },
      description: null,
      declaredAccess: ['read', 'write'],
      fields: [
        { key: 'note', type: 'text', title: 'Note' },
        { key: 'name', type: 'string', title: 'Name', required: true },
        { key: 'status', type: 'enum', title: 'Status', required: true, values: ['todo', 'done'] },
        { key: 'enabled', type: 'boolean', title: 'Enabled' },
      ],
      defaults: { status: 'todo', enabled: false },
      query: {
        searchable: [], filterable: [], sortable: [], search: null, filters: [], comparisons: [], capabilityQueries: [],
        sort: {
          parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true,
          maxCriteria: 8, genericDefault: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'],
          nullPlacement: 'last', genericValues: ['createdAt:desc'],
        },
        pagination: {
          limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
          cursor: { parameter: 'cursor', type: 'string' },
        },
      },
      actions: [], capabilities: [], capabilityBindings: {},
    },
  };
}

function optionContext() {
  const inventory = {
    data: {
      semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
      models: [{
        key: 'task', version: 1, schemaHash: 'sha256:task',
        display: { singular: 'Task', plural: 'Tasks' }, capabilities: [], actions: [],
      }],
      spaces: [{
        spaceId: 'spc_test', spaceName: 'Test Space',
        models: [{ modelKey: 'task', access: ['read', 'write'] }],
      }],
    },
  };
  const parameters = { spaceId: 'spc_test', recordType: 'task', operation: 'create' };
  return {
    getCredentials: async () => ({ baseUrl: 'https://example.invalid/api/v1' }),
    getNode: () => ({ name: 'LifeSpace' }),
    getNodeParameter(name, fallback) { return Object.hasOwn(parameters, name) ? parameters[name] : fallback; },
    getCurrentNodeParameter(name) { return Object.hasOwn(parameters, name) ? parameters[name] : undefined; },
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        if (options.url.endsWith('/me/_discovery/inventory')) return inventory;
        if (options.url.endsWith('/spaces/spc_test/_discovery/models/task')) return semanticDetail();
        throw new Error(`Unexpected request ${options.method} ${options.url}`);
      },
    },
  };
}

test('Create UI starts with required user-input fields and advertises server defaults', async () => {
  const node = new LifeSpaceWorkflow();
  const fieldsProperty = property(node, 'fields');
  assert.equal(fieldsProperty.typeOptions.resourceMapper.addAllFields, false);

  const relations = property(node, 'multiRelations');
  assert.equal(relations.displayName, 'Related People & Records');
  assert.equal(relations.placeholder, 'Add Related Field');

  const mapped = await node.methods.resourceMapping.getHumanRecordFields.call(optionContext());
  assert.deepEqual(mapped.fields.map((field) => field.displayName), [
    'Name',
    'Note',
    'Status (default: todo)',
    'Enabled (default: false)',
  ]);
  assert.deepEqual(mapped.fields.map((field) => field.required), [true, false, false, false]);
});
