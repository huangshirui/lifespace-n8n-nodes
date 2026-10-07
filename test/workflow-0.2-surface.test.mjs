import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');

function property(node, name) {
  return node.description.properties.find((entry) => entry.name === name);
}

test('0.2.0 ordinary Workflow exposes Record, Person, and API Request with Service credential', () => {
  const node = new LifeSpaceWorkflow();

  assert.deepEqual(node.description.credentials, [{ name: 'lifeSpaceApi', required: true }]);

  const resource = property(node, 'resource');
  assert.ok(resource);
  assert.deepEqual(resource.options.map((option) => option.value), ['modelRecord', 'person', 'apiRequest']);

  const personOperation = property(node, 'personOperation');
  assert.ok(personOperation);
  assert.deepEqual(personOperation.options.map((option) => option.value), ['create', 'delete', 'get', 'list', 'update']);

  const space = property(node, 'spaceId');
  assert.ok(space.displayOptions.show.resource.includes('person'));

  assert.equal(property(node, 'batchAuthorityMode'), undefined);
  assert.equal(property(node, 'batchPrincipalUserId'), undefined);
  assert.equal(property(node, 'batchOperations'), undefined);
});

test('0.2.0 Query and mutation concurrency UX keep the accepted independent options', () => {
  const node = new LifeSpaceWorkflow();

  const queryOptions = property(node, 'options');
  assert.ok(queryOptions.options.some((option) => option.name === 'cursor'));
  assert.ok(queryOptions.options.some((option) => option.name === 'viewingTimezone'));

  const mutationOptions = property(node, 'mutationOptions');
  const version = mutationOptions.options.find((option) => option.name === 'version');
  assert.ok(version);
  assert.match(version.description, /Optional known record version/u);

  const action = property(node, 'actionKey');
  assert.ok(action);
  assert.deepEqual(action.displayOptions.show.operation, ['executeAction']);
});
