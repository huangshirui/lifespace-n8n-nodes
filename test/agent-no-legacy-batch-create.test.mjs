import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceAgentTool } = require('../dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js');

test('Agent Tool exposes mutation controls under the final Options collection', () => {
  const node = new LifeSpaceAgentTool();
  const operation = node.description.properties.find((property) => property.name === 'operation');
  assert.ok(operation);
  assert.equal(operation.options.some((option) => option.value === 'batchCreate'), false);
  assert.equal(node.description.properties.some((property) => property.name === 'batchDelegationIds'), false);
  assert.equal(node.description.properties.some((property) => property.name === 'mutationMode'), false);

  const recordOptions = node.description.properties.find((property) => property.name === 'recordOptions');
  assert.ok(recordOptions);
  assert.equal(node.description.properties.at(-1)?.name, 'recordOptions');
  assert.deepEqual(recordOptions.default, { batchProcessing: true });
  const batchProcessing = recordOptions.options.find((option) => option.name === 'batchProcessing');
  const atomicConsistency = recordOptions.options.find((option) => option.name === 'atomicConsistency');
  assert.ok(batchProcessing);
  assert.ok(atomicConsistency);
  assert.equal(batchProcessing.default, true);
  assert.equal(batchProcessing.noDataExpression, true);
  assert.equal(atomicConsistency.default, false);
  assert.notEqual(atomicConsistency.noDataExpression, true);
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
    getNode: () => ({ name: 'LifeSpace Agent Tool', typeVersion: 1, parameters }),
  };

  await assert.rejects(
    () => node.supplyData.call(context, 0),
    /batchCreate is no longer supported.*Create.*Batch Processing.*Atomic Consistency/u,
  );
});
