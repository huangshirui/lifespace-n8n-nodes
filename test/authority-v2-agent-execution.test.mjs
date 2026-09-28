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
    schemaHash: 'sha256:authority-v2-test',
    display: { singular: 'Task', plural: 'Tasks' },
    description: 'Authority v2 test model',
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

function context(runtimeModel, business) {
  const calls = [];
  const parameters = {
    authorityMode: 'delegatedAgent',
    principalUserId: PRINCIPAL,
    delegationId: DELEGATION,
    readDelegationId: READ_DELEGATION,
    spaceId: 'spc_test',
    recordType: snapshot(runtimeModel),
    operation: 'create',
    queryMode: 'generic',
    capabilityQueryKey: '',
    actionKey: '',
    descriptionOverride: '',
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
    getNode: () => ({ name: 'LifeSpace Tool', typeVersion: 1 }),
    getTimezone: () => 'Asia/Shanghai',
    addInputData: () => ({ index: 0 }),
    addOutputData: () => undefined,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ transport: 'credential', credentialName, options });
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        assert.equal(options.url, `${IDENTITY_BASE}/internal/v1/agent-tokens`);
        assert.deepEqual(options.body, {
          subjectId: PRINCIPAL,
          agentId: AGENT,
          scopes: ['resources:read', 'resources:write'],
        });
        return {
          data: {
            accessToken: 'agent.jwt.test',
            principalId: PRINCIPAL,
            actor: { type: 'agent', id: AGENT },
            applicationId: 'app_test',
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

test('delegated Agent mode mints an Agent JWT and never uses the Service PAT for business execution', async () => {
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
  assert.equal(
    execution.calls.some((call) => call.credentialName === 'lifeSpaceApi'),
    false,
    'delegated execution must never require or fall back to Service PAT',
  );
});

test('delegated relation lookup uses the same Agent JWT and Delegation selector as the mutation', async () => {
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
  for (const request of coreCalls) {
    assert.equal(request.headers.Authorization, 'Bearer agent.jwt.test');
  }
  assert.equal(coreCalls[0].headers['X-LifeSpace-Delegation-Id'], READ_DELEGATION);
  assert.equal(coreCalls[1].headers['X-LifeSpace-Delegation-Id'], DELEGATION);
  assert.match(coreCalls[0].url, /_relation-targets\/task\/assigneePersonIds/u);
  assert.deepEqual(coreCalls[1].body, {
    name: 'Call Alice',
    assigneePersonIds: ['per_alice'],
  });
});

test('Authority v2 denials are returned as deterministic non-retryable Tool results', async () => {
  const execution = context(model(), () => {
    throw {
      response: {
        body: {
          error: {
            code: 'DELEGATION_INVALID',
            message: 'Delegation is revoked',
          },
        },
      },
    };
  });

  const tool = (await new LifeSpaceTool().supplyData.call(execution, 0)).response;
  const result = JSON.parse(await tool.invoke({ name: 'Must fail' }));
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'DELEGATION_INVALID',
      message: 'Delegation is revoked',
      retryable: false,
      nextAction: 'request_authorization',
      instruction: 'Do not retry the same Tool call. The Application must obtain or select a valid current Delegation from the User Principal before trying again.',
    },
  });
});
