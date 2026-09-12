import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  normalizeLifeSpaceError,
  projectLifeSpaceHttpError,
  restoreLifeSpaceContinueOnFailErrors,
} = require('../dist/nodes/LifeSpaceWorkflow/lifeSpaceErrorProjection.js');

function apiError() {
  const error = new Error('Bad request - please check your parameters');
  error.httpCode = '400';
  error.context = {
    data: {
      error: {
        code: 'INVALID_RESOURCE',
        message: 'startTimezone must be a valid IANA timezone',
        requestId: 'req_test',
      },
    },
  };
  return error;
}

test('LifeSpace error projection extracts the Core error envelope', () => {
  assert.deepEqual(normalizeLifeSpaceError(apiError()), {
    code: 'INVALID_RESOURCE',
    message: 'startTimezone must be a valid IANA timezone',
    status: 400,
    requestId: 'req_test',
  });
});

test('Continue On Fail restores structured LifeSpace error details', () => {
  const context = {
    continueOnFail: () => true,
    getNode: () => ({ name: 'LifeSpace' }),
  };
  const projected = projectLifeSpaceHttpError(context, apiError());
  const executions = restoreLifeSpaceContinueOnFailErrors([[
    { json: { error: projected.message }, pairedItem: { item: 0 } },
  ]]);
  assert.deepEqual(executions[0][0].json.error, {
    code: 'INVALID_RESOURCE',
    message: 'startTimezone must be a valid IANA timezone',
    status: 400,
    requestId: 'req_test',
  });
});

test('Stop Workflow surfaces the LifeSpace message instead of generic HTTP 400 text', () => {
  const context = {
    continueOnFail: () => false,
    getNode: () => ({ name: 'LifeSpace' }),
  };
  const projected = projectLifeSpaceHttpError(context, apiError());
  assert.equal(projected.message, 'startTimezone must be a valid IANA timezone');
  assert.match(projected.description, /INVALID_RESOURCE/u);
  assert.match(projected.description, /req_test/u);
});
