import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceAgentTool } = require('../dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js');
const { encodeAgentToolSemanticSnapshot } = require('../dist/nodes/agent/lifeSpaceToolSnapshot.js');

const BASE_URL = 'https://core.example.invalid/api/v1';

function runtimeModel() {
  return {
    key: 'task',
    version: 8,
    schemaHash: 'sha256:agent-person-bulk',
    display: { singular: 'Task', plural: 'Tasks' },
    description: 'Task test model',
    access: ['read', 'write'],
    fields: [
      { key: 'name', type: 'string', title: 'Name', required: true },
      { key: 'status', type: 'enum', title: 'Status', required: false, values: ['open', 'done'] },
    ],
    defaults: {},
    query: {
      canonical: {
        invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query' },
        pipeline: ['search', 'filter', 'sort', 'cursor-pagination'],
        search: { fields: ['name'], minLength: 1, maxLength: 100 },
        filter: { maxDepth: 8, maxNodes: 100, targets: [] },
        sort: {
          fields: ['createdAt'], directions: ['asc', 'desc'], maxCriteria: 8,
          default: [{ field: 'createdAt', direction: 'desc' }], nullPlacement: 'last', stableTieBreaker: 'record-id-asc',
        },
        pagination: {
          limit: { minimum: 1, maximum: 200, default: 100 },
          cursor: { opaque: true, binds: [], snapshotConsistency: false },
        },
      },
      searchable: ['name'], filterable: [], sortable: [], filters: [], comparisons: [], capabilityQueries: [],
      search: { parameter: 'q', minLength: 1, maxLength: 100 },
      sort: {
        parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8,
        default: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'], nullPlacement: 'last',
        genericValues: ['createdAt:desc'],
      },
      pagination: {
        limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
        cursor: { parameter: 'cursor', type: 'string' },
      },
    },
    actions: [], capabilities: [], capabilityBindings: {},
  };
}

function recordType() {
  return encodeAgentToolSemanticSnapshot({
    format: 1,
    spaceId: 'spc_test',
    spaceName: 'Test Space',
    model: runtimeModel(),
  });
}

function context(parameters, responder) {
  const calls = [];
  const effective = {
    toolResource: 'record',
    spaceId: 'spc_test',
    recordType: recordType(),
    operation: 'create',
    mutationMode: 'single',
    personOperation: 'list',
    actionKey: '',
    descriptionOverride: '',
    enableUserAuthorization: false,
    authorizationPrincipalUserId: '',
    ...parameters,
  };
  return {
    calls,
    getCredentials: async (name) => {
      assert.equal(name, 'lifeSpaceAgentExecutionApi');
      return { coreBaseUrl: BASE_URL, agentSecret: 'lsp_agt_test' };
    },
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.hasOwn(effective, name) ? effective[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace Agent Tool', typeVersion: 1 }),
    getTimezone: () => 'Asia/Shanghai',
    addInputData: () => ({ index: 0 }),
    addOutputData: () => undefined,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        calls.push(options);
        return responder(options, calls.length - 1);
      },
    },
  };
}

test('Agent Tool exposes Person as a first-class resource and performs bounded search', async () => {
  const node = new LifeSpaceAgentTool();
  const resource = node.description.properties.find((property) => property.name === 'toolResource');
  assert.deepEqual(resource.options.map((option) => option.value), ['record', 'person']);

  const execution = context({ toolResource: 'person', personOperation: 'list' }, (options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_test/people`);
    assert.deepEqual(options.qs, { q: '王', limit: 20 });
    return { data: { items: [{ id: 'per_1', displayName: '王老师', alternateNames: ['班主任'], version: 1 }], nextCursor: null } };
  });
  const tool = (await node.supplyData.call(execution, 0)).response;
  assert.equal(tool.metadata.lifeSpaceResource, 'person');
  assert.ok(tool.schema.properties.search);
  const result = JSON.parse(await tool.invoke({ search: '王', limit: 20 }));
  assert.equal(result.data.items[0].id, 'per_1');
  assert.equal(execution.calls.length, 1);
});

test('Person Update hides concurrency and reads the current version before mutation', async () => {
  const execution = context({ toolResource: 'person', personOperation: 'update' }, (options, index) => {
    if (index === 0) {
      assert.equal(options.method, 'GET');
      assert.equal(options.url, `${BASE_URL}/spaces/spc_test/people/per_teacher`);
      return { data: { id: 'per_teacher', version: 7 } };
    }
    assert.equal(options.method, 'PATCH');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_test/people/per_teacher`);
    assert.deepEqual(options.body, {
      alternateNames: { add: ['班主任'] },
      version: 7,
    });
    return { data: { id: 'per_teacher', version: 8 } };
  });
  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;
  assert.equal(Object.hasOwn(tool.schema.properties, 'version'), false);
  const result = JSON.parse(await tool.invoke({
    personId: 'per_teacher',
    alternateNames: { add: ['班主任'] },
  }));
  assert.equal(result.data.version, 8);
  assert.equal(execution.calls.length, 2);
});

test('Person authorization recovery requests a Space scope rather than a fake model scope', async () => {
  const execution = context({
    toolResource: 'person',
    personOperation: 'create',
    enableUserAuthorization: true,
    authorizationPrincipalUserId: 'usr_test',
  }, () => {
    throw { error: { code: 'DELEGATION_REQUIRED', message: 'User delegation required' } };
  });
  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;
  const result = JSON.parse(await tool.invoke({ displayName: '小天' }));
  assert.equal(result.ok, false);
  assert.equal(result.error.nextAction, 'request_authorization');
  assert.deepEqual(result.authorizationRequired, {
    spaceId: 'spc_test',
    scopes: [{ target: { type: 'space', id: 'spc_test' }, maxAccess: 'write' }],
  });
});

test('Record Bulk Create uses non-atomic /models/bulk and direct Agent Authority', async () => {
  const execution = context({ operation: 'create', mutationMode: 'bulk' }, (options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_test/models/bulk`);
    assert.equal(options.headers?.['X-LifeSpace-Delegation-Id'], undefined);
    assert.deepEqual(options.body, {
      operations: [
        { operation: 'create', modelKey: 'task', data: { name: 'One' } },
        { operation: 'create', modelKey: 'task', data: { name: 'Two', status: 'open' } },
      ],
    });
    return {
      data: {
        bulkId: 'blk_test',
        items: [
          { ok: true, recordId: 'rec_1', version: 1 },
          { ok: false, error: { code: 'VALIDATION_FAILED' } },
        ],
      },
    };
  });
  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;
  assert.equal(tool.metadata.lifeSpaceMutationMode, 'bulk');
  assert.equal(tool.schema.properties.items.maxItems, 20);
  const result = JSON.parse(await tool.invoke({ items: [{ name: 'One' }, { name: 'Two', status: 'open' }] }));
  assert.equal(result.data.bulkId, 'blk_test');
  assert.equal(result.data.items[1].ok, false);
});

test('Record Atomic Batch Update relies on Core set-wise version resolution', async () => {
  const execution = context({ operation: 'update', mutationMode: 'atomic' }, (options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_test/models/batch`);
    assert.deepEqual(options.body, {
      operations: [
        { operation: 'update', modelKey: 'task', recordId: 'rec_1', data: { status: 'done' } },
        { operation: 'update', modelKey: 'task', recordId: 'rec_2', data: { name: 'Renamed' } },
      ],
    });
    return {
      data: {
        changeSetId: 'cgs_test',
        items: [
          { recordId: 'rec_1', version: 3 },
          { recordId: 'rec_2', version: 6 },
        ],
      },
    };
  });
  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;
  const result = JSON.parse(await tool.invoke({
    items: [
      { recordId: 'rec_1', status: 'done' },
      { recordId: 'rec_2', name: 'Renamed' },
    ],
  }));
  assert.equal(result.data.changeSetId, 'cgs_test');
  assert.equal(execution.calls.length, 1);
});

test('represented Agent multi-mutation puts Delegation on each operation, not the request header', async () => {
  const execution = context({
    operation: 'delete',
    mutationMode: 'bulk',
    enableUserAuthorization: true,
    authorizationPrincipalUserId: 'usr_test',
  }, (options) => {
    assert.equal(options.headers?.['X-LifeSpace-Delegation-Id'], undefined);
    assert.deepEqual(options.body, {
      operations: [
        { operation: 'delete', modelKey: 'task', recordId: 'rec_1', delegationId: 'dlg_bulk' },
        { operation: 'delete', modelKey: 'task', recordId: 'rec_2', delegationId: 'dlg_bulk' },
      ],
    });
    return { data: { bulkId: 'blk_delete', items: [{ ok: true }, { ok: true }] } };
  });
  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;
  const result = JSON.parse(await tool.invoke({
    delegationId: 'dlg_bulk',
    items: [{ recordId: 'rec_1' }, { recordId: 'rec_2' }],
  }));
  assert.equal(result.data.bulkId, 'blk_delete');
});
