import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceAgentTool } = require('../dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js');
const { decodeAgentToolSemanticSnapshot } = require('../dist/nodes/agent/lifeSpaceToolSnapshot.js');

const CORE_BASE = 'https://core.example.com/api/v1';

function semanticDetail() {
  return {
    key: 'event',
    version: 6,
    schemaHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    display: { singular: 'Event', plural: 'Events' },
    description: 'Calendar event',
    declaredAccess: ['read', 'write'],
    fields: [{ key: 'title', type: 'string', title: 'Title', required: true }],
    defaults: {},
    query: {
      canonical: {
        invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query' },
        pipeline: ['search', 'filter', 'sort', 'cursor-pagination'],
        search: { fields: ['title'], minLength: 1, maxLength: 100 },
        filter: { maxDepth: 8, maxNodes: 100, targets: [] },
        sort: {
          fields: ['createdAt', 'title'],
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
      searchable: ['title'],
      filterable: [],
      sortable: ['title'],
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
        genericDefault: ['createdAt:desc'],
        envelopeFields: ['createdAt', 'updatedAt'],
        nullPlacement: 'last',
        genericValues: ['createdAt:desc', 'title:asc'],
        semantic: { standalone: true, values: [], defaults: {} },
      },
      pagination: {
        limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
        cursor: { parameter: 'cursor', type: 'string' },
      },
      capabilityParameters: [],
      capabilityQueries: [],
    },
    actions: [{
      key: 'reschedule',
      access: 'write',
      kind: 'workflow',
      input: { fields: [] },
      concurrency: { strategy: 'record-version', required: true, transport: { in: 'body', name: 'version' } },
      invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/event/records/{recordId}/actions/reschedule' },
    }],
    capabilities: ['calendar'],
    capabilityBindings: {},
  };
}

function responseFor(url) {
  if (url === `${CORE_BASE}/me/_discovery/models`) {
    return {
      data: {
        semanticDetailPathTemplate: '/api/v1/me/_discovery/models/{modelKey}',
        models: [{
          key: 'event',
          version: 6,
          schemaHash: semanticDetail().schemaHash,
          display: { singular: 'Event', plural: 'Events' },
          capabilities: ['calendar'],
          actions: [{ key: 'reschedule', access: 'write', kind: 'workflow' }],
          access: ['read', 'write'],
        }],
      },
    };
  }
  if (url === `${CORE_BASE}/me/_discovery/models/event`) {
    return { data: { access: ['read', 'write'], model: semanticDetail() } };
  }
  if (url === `${CORE_BASE}/me/_discovery/inventory`) {
    return { data: { semanticDetailPathTemplate: '', models: [], spaces: [] } };
  }
  throw new Error(`Unexpected URL ${url}`);
}

function editorContext(parameterOverrides = {}) {
  const calls = [];
  const parameters = {
    spaceId: 'spc_not_yet_granted',
    operation: 'update',
    recordType: '',
    ...parameterOverrides,
  };
  return {
    calls,
    getCurrentNodeParameter(name) { return parameters[name]; },
    getNodeParameter(name, defaultValue) { return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue; },
    getCredentials: async (name) => {
      assert.equal(name, 'lifeSpaceAgentExecutionApi');
      return { coreBaseUrl: CORE_BASE, agentSecret: 'lsp_agt_test' };
    },
    getNode: () => ({ name: 'LifeSpace Agent Tool', typeVersion: 1 }),
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        calls.push(options);
        return responseFor(options.url);
      },
    },
  };
}

function runtimeContext() {
  const calls = [];
  const parameters = {
    toolResource: 'record',
    enableUserAuthorization: false,
    authorizationPrincipalUserId: '',
    spaceId: 'spc_not_yet_granted',
    operation: 'query',
    recordType: 'event',
    queryMode: 'generic',
    capabilityQueryKey: '',
    actionKey: '',
    descriptionOverride: '',
  };
  return {
    calls,
    getCredentials: async (name) => {
      assert.equal(name, 'lifeSpaceAgentExecutionApi');
      return { coreBaseUrl: CORE_BASE, agentSecret: 'lsp_agt_test' };
    },
    getNodeParameter(name, _itemIndex, defaultValue) { return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue; },
    getNode: () => ({ name: 'LifeSpace Agent Tool', typeVersion: 1, parameters }),
    getTimezone: () => 'Asia/Shanghai',
    addInputData: () => ({ index: 0 }),
    addOutputData: () => undefined,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        calls.push(options);
        return responseFor(options.url);
      },
    },
  };
}

test('Agent Tool Space and Record Type accept stable IDs even when discovery has no current Space edge', () => {
  const node = new LifeSpaceAgentTool();
  const space = node.description.properties.find((property) => property.name === 'spaceId');
  const recordType = node.description.properties.find((property) => property.name === 'recordType');
  assert.equal(space.allowArbitraryValues, true);
  assert.equal(recordType.allowArbitraryValues, true);
});

test('Record Type options use configuration model discovery and do not require a Space Data Grant', async () => {
  const node = new LifeSpaceAgentTool();
  const context = editorContext();
  const options = await node.methods.loadOptions.getRecordTypes.call(context);
  assert.equal(options.length, 1);
  assert.equal(options[0].name, 'Event');
  const snapshot = decodeAgentToolSemanticSnapshot(options[0].value);
  assert.equal(snapshot.spaceId, 'spc_not_yet_granted');
  assert.equal(snapshot.model.key, 'event');
  assert.deepEqual(snapshot.model.access, ['read', 'write']);
  assert.deepEqual(context.calls.map((call) => call.url), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]);
});

test('Actions can be discovered from a directly entered model key without Space Authority', async () => {
  const node = new LifeSpaceAgentTool();
  const context = editorContext({ operation: 'action', recordType: 'event' });
  const options = await node.methods.loadOptions.getActions.call(context);
  assert.deepEqual(options, [{
    name: 'reschedule',
    value: 'reschedule',
    description: 'workflow Action · requires write access',
  }]);
  assert.deepEqual(context.calls.map((call) => call.url), [`${CORE_BASE}/me/_discovery/models/event`]);
});

test('A directly entered model key resolves static semantics when the Tool is supplied', async () => {
  const node = new LifeSpaceAgentTool();
  const context = runtimeContext();
  const supplied = await node.supplyData.call(context, 0);
  assert.ok(supplied.response);
  assert.equal(supplied.response.metadata.lifeSpaceModelVersion, 6);
  assert.deepEqual(context.calls.map((call) => call.url), [`${CORE_BASE}/me/_discovery/models/event`]);
});
