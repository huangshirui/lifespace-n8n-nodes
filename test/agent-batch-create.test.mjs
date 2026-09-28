import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceTool } = require('../dist/nodes/agent/LifeSpaceAgentToolBase.js');
const { encodeAgentToolSemanticSnapshot } = require('../dist/nodes/agent/lifeSpaceToolSnapshot.js');

const CORE = 'https://core.example.com/api/v1';
const IDENTITY = 'https://identity.example.com';

function model() {
  return {
    key: 'event',
    version: 1,
    schemaHash: 'sha256:batch-create-test',
    display: { singular: 'Event', plural: 'Events' },
    description: 'Batch-create test model',
    access: ['read', 'write'],
    fields: [
      { key: 'summary', type: 'string', title: 'Summary', required: true },
    ],
    defaults: {},
    query: {
      searchable: ['summary'],
      filterable: [],
      sortable: [],
      search: { parameter: 'q', minLength: 1, maxLength: 100 },
      filters: [],
      comparisons: [],
      capabilityQueries: [],
      sort: {
        parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true,
        maxCriteria: 8, default: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'],
        nullPlacement: 'last', genericValues: ['createdAt:desc'],
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

function context() {
  const coreCalls = [];
  const credentialCalls = [];
  const parameters = {
    authorityMode: 'delegatedAgent',
    principalUserId: 'usr_batch',
    delegationId: '',
    batchDelegationIds: ['dlg_one', 'dlg_two'],
    spaceId: 'spc_batch',
    recordType: encodeAgentToolSemanticSnapshot({
      format: 1,
      spaceId: 'spc_batch',
      spaceName: 'Batch Space',
      model: model(),
    }),
    operation: 'batchCreate',
    queryMode: 'generic',
    capabilityQueryKey: '',
    actionKey: '',
    descriptionOverride: '',
  };
  return {
    coreCalls,
    credentialCalls,
    getCredentials: async (name) => name === 'lifeSpaceApi'
      ? { baseUrl: CORE, token: 'lsp_pat_not_for_business' }
      : { identityBaseUrl: IDENTITY, applicationCredential: 'lsa_test', agentId: 'agt_batch' },
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace Batch Tool', typeVersion: 1 }),
    getTimezone: () => 'Asia/Shanghai',
    addInputData: () => ({ index: 0 }),
    addOutputData: () => undefined,
    helpers: {
      async httpRequestWithAuthentication(name, options) {
        credentialCalls.push({ name, options });
        assert.equal(name, 'lifeSpaceAgentExecution');
        return {
          data: {
            accessToken: 'agent.batch.jwt',
            principalId: 'usr_batch',
            actor: { type: 'agent', id: 'agt_batch' },
            applicationId: 'app_batch',
          },
        };
      },
      async httpRequest(options) {
        coreCalls.push(options);
        return {
          data: {
            changeSetId: 'cgs_test',
            items: [
              { index: 0, operation: 'create', modelKey: 'event', recordId: 'rec_1', version: 1 },
              { index: 1, operation: 'create', modelKey: 'event', recordId: 'rec_2', version: 1 },
            ],
          },
        };
      },
    },
  };
}

test('Agent Batch Create emits one Core mutation and keeps Delegations outside the LLM schema', async () => {
  const execution = context();
  const tool = (await new LifeSpaceTool().supplyData.call(execution, 0)).response;

  assert.deepEqual(tool.schema.required, ['items']);
  assert.equal(tool.schema.properties.items.minItems, 1);
  assert.equal(tool.schema.properties.items.maxItems, 20);
  assert.equal(Object.hasOwn(tool.schema.properties, 'delegationId'), false);
  assert.equal(Object.hasOwn(tool.schema.properties, 'batchDelegationIds'), false);
  assert.equal(Object.hasOwn(tool.schema.properties, 'principalUserId'), false);

  const result = JSON.parse(await tool.invoke({
    items: [
      { summary: 'One' },
      { summary: 'Two' },
    ],
  }));

  assert.equal(execution.credentialCalls.length, 1, 'Agent JWT is minted once for the Tool runtime');
  assert.equal(execution.coreCalls.length, 1, 'Batch Create uses exactly one Core mutation request');
  const request = execution.coreCalls[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, `${CORE}/spaces/spc_batch/models/batch`);
  assert.equal(request.headers.Authorization, 'Bearer agent.batch.jwt');
  assert.equal(request.headers['X-LifeSpace-Delegation-Id'], undefined);
  assert.deepEqual(request.body, {
    operations: [
      { operation: 'create', modelKey: 'event', data: { summary: 'One' }, delegationId: 'dlg_one' },
      { operation: 'create', modelKey: 'event', data: { summary: 'Two' }, delegationId: 'dlg_two' },
    ],
  });
  assert.equal(result.data.changeSetId, 'cgs_test');
});
