import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceAgentTool } = require('../dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js');
const { encodeAgentToolSemanticSnapshot } = require('../dist/nodes/agent/lifeSpaceToolSnapshot.js');

const CORE_BASE = 'https://core.example.com/api/v1';
const IDENTITY_BASE = 'https://identity.example.com';
const USER = 'usr_test';
const AGENT = 'agt_test';

function model() {
  return {
    key: 'task',
    version: 1,
    schemaHash: 'sha256:agent-user-authorization-0.2',
    display: { singular: 'Task', plural: 'Tasks' },
    description: 'Agent authorization test model',
    access: ['read', 'write'],
    fields: [{ key: 'name', type: 'string', title: 'Name', required: true }],
    defaults: {},
    query: {
      canonical: {
        invocation: {
          method: 'POST',
          pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query',
        },
        pipeline: ['search', 'filter', 'sort', 'cursor-pagination'],
        search: { fields: ['name'], minLength: 1, maxLength: 100 },
        filter: { maxDepth: 8, maxNodes: 100, targets: [] },
        sort: {
          fields: ['createdAt', 'name'],
          directions: ['asc', 'desc'],
          maxCriteria: 8,
          default: [{ field: 'createdAt', direction: 'desc' }],
          nullPlacement: 'last',
          stableTieBreaker: 'record-id-asc',
        },
        pagination: {
          limit: { minimum: 1, maximum: 200, default: 100 },
          cursor: { opaque: true, binds: [], snapshotConsistency: false },
        },
      },
      searchable: ['name'],
      filterable: [],
      sortable: ['name'],
      search: { parameter: 'q', minLength: 1, maxLength: 100 },
      filters: [],
      comparisons: [],
      capabilityQueries: [],
      sort: {
        parameter: 'sort',
        syntax: 'field:direction',
        repeatable: true,
        ordered: true,
        maxCriteria: 8,
        default: ['createdAt:desc'],
        envelopeFields: ['createdAt', 'updatedAt'],
        nullPlacement: 'last',
        genericValues: ['createdAt:desc', 'name:asc'],
      },
      pagination: {
        limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
        cursor: { parameter: 'cursor', type: 'string' },
      },
    },
    actions: [],
    capabilities: [],
    capabilityBindings: {},
  };
}

function snapshot() {
  return encodeAgentToolSemanticSnapshot({
    format: 1,
    spaceId: 'spc_test',
    spaceName: 'Test Space',
    model: model(),
  });
}

function context({
  enableUserAuthorization = false,
  coreError = null,
  parameterOverrides = {},
} = {}) {
  const calls = [];
  const parameters = {
    authorityMode: 'delegatedAgent',
    principalUserId: '',
    delegationId: '',
    readDelegationId: '',
    batchDelegationIds: '[]',
    enableUserAuthorization,
    authorizationPrincipalUserId: USER,
    spaceId: 'spc_test',
    recordType: snapshot(),
    operation: 'create',
    queryMode: 'generic',
    capabilityQueryKey: '',
    actionKey: '',
    descriptionOverride: '',
    ...parameterOverrides,
  };

  return {
    calls,
    getCredentials: async (name) => {
      assert.equal(name, 'lifeSpaceAgentExecutionApi');
      return {
        coreBaseUrl: CORE_BASE,
        agentSecret: 'lsp_agt_test',
      };
    },
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace Agent Tool', typeVersion: 1 }),
    getTimezone: () => 'Asia/Shanghai',
    addInputData: () => ({ index: 0 }),
    addOutputData: () => undefined,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        calls.push({ transport: 'credential', credentialName, options });
        if (coreError) throw coreError;
        return { data: { id: `rec_${calls.length}`, version: 1 } };
      },
      async httpRequest(options) {
        calls.push({ transport: 'direct', options });
        if (coreError) throw coreError;
        return { data: { id: `rec_${calls.length}`, version: 1 } };
      },
    },
  };
}

function property(node, name) {
  return node.description.properties.find((entry) => entry.name === name);
}

test('0.2.0 Agent Tool uses only Agent credential and exposes User Authorization as an option', () => {
  const node = new LifeSpaceAgentTool();
  assert.deepEqual(node.description.credentials, [{ name: 'lifeSpaceAgentExecutionApi', required: true }]);
  assert.equal(property(node, 'enableUserAuthorization').default, false);
  assert.equal(property(node, 'authorizationPrincipalUserId').displayOptions.show.enableUserAuthorization[0], true);
  assert.deepEqual(property(node, 'authorityMode').displayOptions.show, { __lifeSpaceInternalOnly: ['true'] });
  assert.deepEqual(property(node, 'delegationId').displayOptions.show, { __lifeSpaceInternalOnly: ['true'] });
});

test('User Authorization OFF executes as Principal=Agent / Actor=Agent without a Delegation header', async () => {
  const execution = context();
  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;

  assert.equal(Object.hasOwn(tool.schema.properties, 'delegationId'), false);
  await tool.invoke({ name: 'Direct Agent task' });

  const core = execution.calls.find((call) => call.transport === 'credential');
  assert.ok(core);
  assert.equal(core.options.headers?.['X-LifeSpace-Delegation-Id'], undefined);
});

test('User Authorization ON exposes only runtime delegationId while User identity stays trusted workflow context', async () => {
  const execution = context({ enableUserAuthorization: true });
  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;

  assert.equal(Object.hasOwn(tool.schema.properties, 'delegationId'), true);
  assert.equal(Object.hasOwn(tool.schema.properties, 'authorizationPrincipalUserId'), false);
  assert.equal(Object.hasOwn(tool.schema.properties, 'principalUserId'), false);

  await tool.invoke({ name: 'Delegated task', delegationId: 'dlg_test' });

  const core = execution.calls.find((call) => call.transport === 'credential');
  assert.ok(core);
  assert.equal(core.options.headers['X-LifeSpace-Delegation-Id'], 'dlg_test');
  assert.deepEqual(core.options.body, { name: 'Delegated task' });
});

test('one Tool may use direct Agent Authority and a later User Delegation without reusing the wrong Principal token', async () => {
  const execution = context({ enableUserAuthorization: true });
  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;

  await tool.invoke({ name: 'Direct first' });
  await tool.invoke({ name: 'Represented second', delegationId: 'dlg_second' });

  const coreCalls = execution.calls.filter((call) => call.transport === 'credential');
  assert.equal(coreCalls.length, 2);
  assert.equal(coreCalls[0].options.headers?.['X-LifeSpace-Delegation-Id'], undefined);
  assert.equal(coreCalls[1].options.headers['X-LifeSpace-Delegation-Id'], 'dlg_second');
});

test('invalid runtime delegationId is rejected before Identity/Core calls', async () => {
  const execution = context({ enableUserAuthorization: true });
  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;
  const result = JSON.parse(await tool.invoke({ name: 'Invalid', delegationId: 'bad' }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_DELEGATION_ID');
  assert.equal(execution.calls.length, 0);
});

test('insufficient direct Agent Authority returns the exact authorizationRequired Scope for Request Authorization', async () => {
  const execution = context({
    enableUserAuthorization: true,
    coreError: {
      error: {
        code: 'PRINCIPAL_AUTHORITY_INSUFFICIENT',
        message: 'Agent Principal has no write Authority for task',
      },
    },
  });
  const tool = (await new LifeSpaceAgentTool().supplyData.call(execution, 0)).response;
  const result = JSON.parse(await tool.invoke({ name: 'Needs user authority' }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PRINCIPAL_AUTHORITY_INSUFFICIENT');
  assert.equal(result.error.nextAction, 'request_authorization');
  assert.deepEqual(result.authorizationRequired, {
    spaceId: 'spc_test',
    scopes: [
      {
        target: { type: 'model', id: 'task' },
        maxAccess: 'write',
      },
    ],
  });
});
