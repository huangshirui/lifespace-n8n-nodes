import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceTool } = require('../dist/nodes/agent/LifeSpaceAgentToolBase.js');
const { encodeAgentToolSemanticSnapshot } = require('../dist/nodes/agent/lifeSpaceToolSnapshot.js');

const CORE_BASE = 'https://core.example.com/api/v1';
const IDENTITY_BASE = 'https://identity.example.com';
const PRINCIPAL = 'usr_test';
const AGENT = 'agt_test';
const DELEGATION = 'dlg_test';
const READ_DELEGATION = 'dlg_read_test';

function model(withRelation = false) {
  return {
    key: 'task',
    version: 1,
    schemaHash: 'sha256:authority-v3-test',
    display: { singular: 'Task', plural: 'Tasks' },
    description: 'Authority v3 test model',
    access: ['read', 'write'],
    fields: [
      { key: 'name', type: 'string', title: 'Name', required: true },
      ...(withRelation ? [{
        key: 'assigneePersonIds',
        type: 'person_list',
        title: 'Assignees',
        relation: {
          targetModel: 'person',
          cardinality: 'many',
          lookup: {
            supported: true,
            method: 'GET',
            pathTemplate: '/api/v1/spaces/{spaceId}/_relation-targets/{modelKey}/{fieldKey}',
            searchParameter: 'q',
            cursorParameter: 'cursor',
            limitParameter: 'limit',
          },
        },
      }] : []),
    ],
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

function snapshot(runtimeModel) {
  return encodeAgentToolSemanticSnapshot({
    format: 1,
    spaceId: 'spc_test',
    spaceName: 'Test Space',
    model: runtimeModel,
  });
}

function context(runtimeModel, business, overrides = {}) {
  const calls = [];
  const parameters = {
    authorityMode: 'delegatedAgent',
    principalUserId: PRINCIPAL,
    delegationId: DELEGATION,
    readDelegationId: READ_DELEGATION,
    spaceId: 'spc_test',
    recordType: snapshot(runtimeModel),
    operation: 'create',
    queryMode: 'canonical',
    capabilityQueryKey: '',
    actionKey: '',
    descriptionOverride: '',
    ...overrides,
  };
  return {
    calls,
    getCredentials: async (name) => {
      if (name === 'lifeSpaceAgentExecutionApi') {
        return {
          coreBaseUrl: CORE_BASE,
          identityBaseUrl: IDENTITY_BASE,
          applicationSecret: 'lsa_test',
          agentId: AGENT,
        };
      }
      throw new Error(`unexpected credential ${name}`);
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
        calls.push({ transport: 'credential', credentialName, options });
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        assert.equal(options.url, `${IDENTITY_BASE}/internal/v1/agent-execution-tokens`);
        assert.deepEqual(options.body, {
          principalType: 'user',
          principalId: PRINCIPAL,
          agentId: AGENT,
          scopes: ['resources:read', 'resources:write'],
        });
        return {
          data: {
            accessToken: 'agent.jwt.test',
            principalId: PRINCIPAL,
            principalType: 'user',
            actor: { type: 'agent', id: AGENT },
            applicationId: 'app_test',
            purpose: 'agent_execution',
          },
        };
      },
      async httpRequest(options) {
        calls.push({ transport: 'direct', options });
        return business(options);
      },
    },
  };
}

test('Authority v3 Agent token mint is lazy and reused inside one Tool runtime', async () => {
  const execution = context(
    model(),
    () => ({ data: { id: 'rec_lazy', version: 1 } }),
    { readDelegationId: '' },
  );
  const tool = (await new LifeSpaceTool().supplyData.call(execution, 0)).response;

  assert.equal(execution.calls.length, 0);
  await tool.invoke({ name: 'One' });
  await tool.invoke({ name: 'Two' });

  assert.equal(execution.calls.filter((call) => call.transport === 'credential').length, 1);
  assert.equal(execution.calls.filter((call) => call.transport === 'direct').length, 2);
});

test('delegated Agent business execution uses Authority v3 token plus explicit Delegation selector', async () => {
  let posted;
  const execution = context(model(), (options) => {
    posted = options;
    return { data: { id: 'rec_1', version: 1 } };
  });

  const tool = (await new LifeSpaceTool().supplyData.call(execution, 0)).response;
  assert.equal(Object.hasOwn(tool.schema.properties, 'principalUserId'), false);
  assert.equal(Object.hasOwn(tool.schema.properties, 'delegationId'), false);

  await tool.invoke({ name: 'Buy milk' });

  assert.equal(posted.method, 'POST');
  assert.equal(posted.url, `${CORE_BASE}/spaces/spc_test/models/task/records`);
  assert.equal(posted.headers.Authorization, 'Bearer agent.jwt.test');
  assert.equal(posted.headers['X-LifeSpace-Delegation-Id'], DELEGATION);
  assert.equal(execution.calls.some((call) => call.credentialName === 'lifeSpaceApi'), false);
});

test('delegated relation lookup uses Read Delegation while mutation uses business Delegation', async () => {
  const coreCalls = [];
  const execution = context(model(true), (options) => {
    coreCalls.push(options);
    if (options.url.includes('/_relation-targets/')) {
      return { data: { items: [{ id: 'per_alice', label: 'Alice' }], nextCursor: null } };
    }
    return { data: { id: 'rec_2', version: 1 } };
  });

  const tool = (await new LifeSpaceTool().supplyData.call(execution, 0)).response;
  await tool.invoke({
    name: 'Call Alice',
    assigneePersonIds: [{ name: 'Alice' }],
  });

  assert.equal(coreCalls.length, 2);
  assert.equal(coreCalls[0].headers['X-LifeSpace-Delegation-Id'], READ_DELEGATION);
  assert.equal(coreCalls[1].headers['X-LifeSpace-Delegation-Id'], DELEGATION);
});

test('delegated Update uses Read Delegation for version lookup and business Delegation for mutation', async () => {
  const coreCalls = [];
  const execution = context(model(), (options) => {
    coreCalls.push(options);
    if (options.method === 'GET') return { data: { id: 'rec_update', version: 7 } };
    return { data: { id: 'rec_update', version: 8 } };
  }, { operation: 'update' });

  const tool = (await new LifeSpaceTool().supplyData.call(execution, 0)).response;
  await tool.invoke({ recordId: 'rec_update', name: 'Updated' });

  assert.equal(coreCalls[0].method, 'GET');
  assert.equal(coreCalls[0].headers['X-LifeSpace-Delegation-Id'], READ_DELEGATION);
  assert.equal(coreCalls[1].method, 'PATCH');
  assert.equal(coreCalls[1].headers['X-LifeSpace-Delegation-Id'], DELEGATION);
  assert.equal(coreCalls[1].body.version, 7);
});

test('missing business Delegation remains a deterministic request_authorization result', async () => {
  const execution = context(
    model(),
    () => {
      throw new Error('Core must not be called when business Delegation is missing');
    },
    { delegationId: '', readDelegationId: '' },
  );
  const tool = (await new LifeSpaceTool().supplyData.call(execution, 0)).response;
  const result = JSON.parse(await tool.invoke({ name: 'Must not execute' }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DELEGATION_REQUIRED');
  assert.equal(result.error.retryable, false);
  assert.equal(result.error.nextAction, 'request_authorization');
  assert.equal(execution.calls.filter((call) => call.transport === 'direct').length, 0);
});

test('delegated Batch Create sends per-item Delegation selectors without a global selector', async () => {
  const coreCalls = [];
  const execution = context(model(), (options) => {
    coreCalls.push(options);
    return {
      data: {
        changeSetId: 'cgs_test',
        items: [
          { recordId: 'rec_1', version: 1 },
          { recordId: 'rec_2', version: 1 },
        ],
      },
    };
  }, {
    operation: 'batchCreate',
    delegationId: '',
    batchDelegationIds: JSON.stringify(['dlg_one', 'dlg_two']),
  });

  const tool = (await new LifeSpaceTool().supplyData.call(execution, 0)).response;
  const result = JSON.parse(await tool.invoke({
    items: [{ name: 'One' }, { name: 'Two' }],
  }));

  assert.equal(result.data.changeSetId, 'cgs_test');
  assert.equal(coreCalls.length, 1);
  assert.equal(coreCalls[0].headers['X-LifeSpace-Delegation-Id'], undefined);
  assert.deepEqual(coreCalls[0].body, {
    operations: [
      { operation: 'create', modelKey: 'task', data: { name: 'One' }, delegationId: 'dlg_one' },
      { operation: 'create', modelKey: 'task', data: { name: 'Two' }, delegationId: 'dlg_two' },
    ],
  });
});
