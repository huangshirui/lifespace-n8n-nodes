import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceAgentTool } = require('../dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js');

test('Agent Tool exposes only the unified mutation surface', () => {
  const node = new LifeSpaceAgentTool();
  const operation = node.description.properties.find((property) => property.name === 'operation');
  assert.ok(operation);
  assert.equal(operation.options.some((option) => option.value === 'batchCreate'), false);
  assert.equal(node.description.properties.some((property) => property.name === 'batchDelegationIds'), false);

  const mutationMode = node.description.properties.find((property) => property.name === 'mutationMode');
  assert.ok(mutationMode);
  assert.deepEqual(mutationMode.options.map((option) => option.value), ['single', 'bulk', 'atomic']);
});

test('saved legacy batchCreate Agent Tool configuration is rejected instead of executed', async () => {
  const node = new LifeSpaceAgentTool();
  const parameters = {
    toolResource: 'record',
    operation: 'batchCreate',
    enableUserAuthorization: false,
    authorizationPrincipalUserId: '',
  };
  const context = {
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace Agent Tool', typeVersion: 1 }),
  };

  await assert.rejects(
    () => node.supplyData.call(context, 0),
    /batchCreate is no longer supported.*Create.*Bulk or Atomic Batch/u,
  );
});
