import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');

const BASE_URL = 'https://example.invalid/api/v1';

function executionContext(parameters, responder) {
  const calls = [];
  return {
    calls,
    getInputData: () => [{ json: {} }],
    getCredentials: async () => ({ baseUrl: `${BASE_URL}/` }),
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace Workflow' }),
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ credentialName, options });
        return responder(options, calls.length - 1);
      },
    },
  };
}

test('Person Create posts canonical and alternate names to the Kernel directory', async () => {
  const node = new LifeSpaceWorkflow();
  const context = executionContext({
    resource: 'person',
    personOperation: 'create',
    spaceId: 'spc_test',
    personDisplayName: '王老师',
    'personAlternateNames.name': [{ value: '班主任' }, { value: '王主任' }],
  }, (options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_test/people`);
    assert.deepEqual(options.body, {
      displayName: '王老师',
      alternateNames: ['班主任', '王主任'],
    });
    return {
      data: {
        id: 'per_teacher',
        displayName: '王老师',
        alternateNames: ['班主任', '王主任'],
        linkedUser: false,
        version: 1,
      },
    };
  });

  const [output] = await node.execute.call(context);
  assert.equal(context.calls.length, 1);
  assert.deepEqual(output[0].json, {
    id: 'per_teacher',
    displayName: '王老师',
    alternateNames: ['班主任', '王主任'],
    linkedUser: false,
    version: 1,
  });
});

test('Person Update sends one aggregate incremental alternate-name mutation', async () => {
  const node = new LifeSpaceWorkflow();
  const context = executionContext({
    resource: 'person',
    personOperation: 'update',
    spaceId: 'spc_test',
    personId: 'per_teacher',
    personVersion: 3,
    personDisplayName: '',
    personAlternateNameMode: 'incremental',
    'personAddAlternateNames.name': [{ value: '王老师傅' }],
    'personRemoveAlternateNames.name': [{ value: '王主任' }],
    'personRenameAlternateNames.rename': [{ from: '班主任', to: '班导' }],
  }, (options) => {
    assert.equal(options.method, 'PATCH');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_test/people/per_teacher`);
    assert.deepEqual(options.body, {
      version: 3,
      alternateNames: {
        add: ['王老师傅'],
        remove: ['王主任'],
        rename: [{ from: '班主任', to: '班导' }],
      },
    });
    return {
      data: {
        id: 'per_teacher',
        displayName: '王老师',
        alternateNames: ['班导', '王老师傅'],
        linkedUser: false,
        version: 4,
      },
    };
  });

  const [output] = await node.execute.call(context);
  assert.equal(context.calls.length, 1);
  assert.equal(output[0].json.version, 4);
});

test('Person List Return All follows opaque cursors and preserves search', async () => {
  const node = new LifeSpaceWorkflow();
  const context = executionContext({
    resource: 'person',
    personOperation: 'list',
    spaceId: 'spc_test',
    personSearch: '王',
    personReturnAll: true,
  }, (options, callIndex) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_test/people`);
    assert.equal(options.qs.q, '王');
    assert.equal(options.qs.limit, 100);
    if (callIndex === 0) {
      assert.equal(options.qs.cursor, undefined);
      return {
        data: {
          items: [{ id: 'per_1', displayName: '王老师', alternateNames: [], linkedUser: false, version: 1 }],
          nextCursor: 'cursor_2',
        },
      };
    }
    assert.equal(options.qs.cursor, 'cursor_2');
    return {
      data: {
        items: [{ id: 'per_2', displayName: '小王', alternateNames: [], linkedUser: false, version: 1 }],
        nextCursor: null,
      },
    };
  });

  const [output] = await node.execute.call(context);
  assert.equal(context.calls.length, 2);
  assert.deepEqual(output.map((item) => item.json.id), ['per_1', 'per_2']);
});

test('Person Delete sends the expected version and returns a workflow deletion result', async () => {
  const node = new LifeSpaceWorkflow();
  const context = executionContext({
    resource: 'person',
    personOperation: 'delete',
    spaceId: 'spc_test',
    personId: 'per_teacher',
    personVersion: 4,
  }, (options) => {
    assert.equal(options.method, 'DELETE');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_test/people/per_teacher`);
    assert.deepEqual(options.body, { version: 4 });
    return undefined;
  });

  const [output] = await node.execute.call(context);
  assert.equal(context.calls.length, 1);
  assert.deepEqual(output[0].json, { id: 'per_teacher', deleted: true });
});
