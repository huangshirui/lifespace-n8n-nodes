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
        }, {
          key: 'health_document',
          version: 1,
          schemaHash: 'published-external-definition',
          display: { singular: 'Health Document', plural: 'Health Documents' },
          capabilities: [],
          actions: [],
          access: ['read', 'write'],
          origin: 'external',
          fieldsDynamic: true,
        }],
      },
    };
  }
  if (url === `${CORE_BASE}/me/_discovery/models/event`) {
    return { data: { access: ['read', 'write'], model: semanticDetail() } };
  }
  if (url === `${CORE_BASE}/me/_discovery/inventory`) {
    return { data: {
      semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
      models: [{
        key: 'health_document', origin: 'external', spaceId: 'spc_external', schemaHash: 'external-space-schema',
        display: { singular: 'Health Document', plural: 'Health Documents' },
        runtimeCapabilities: {
          get: true, query: true, create: false, update: false, delete: false,
          batchWrite: false, atomicBatch: false, transaction: false,
          versionedWrite: false, actions: false, relationTargetResolution: false,
        },
        contract: { kind: 'dynamic', revision: null },
      }],
      spaces: [{
        spaceId: 'spc_external', spaceName: 'External Space',
        models: [{ modelKey: 'health_document', access: ['read'] }],
      }],
    } };
  }
  if (url === `${CORE_BASE}/spaces/spc_external/_discovery/models/health_document`) {
    return { data: {
      key: 'health_document', modelKey: 'health_document', origin: 'external', spaceId: 'spc_external',
      schemaHash: 'external-space-schema',
      display: { singular: 'Health Document', plural: 'Health Documents' },
      description: 'Space-local provider schema', access: ['read'],
      fields: [{ key: 'f_title', title: 'Title', type: 'string', nullable: false, readable: true, writable: false, operators: ['eq', 'contains'], sortable: true }],
      actions: [], capabilities: [], capabilityBindings: {},
      runtimeCapabilities: {
        get: true, query: true, create: false, update: false, delete: false,
        batchWrite: false, atomicBatch: false, transaction: false,
        versionedWrite: false, actions: false, relationTargetResolution: false,
      },
      contract: { kind: 'dynamic', revision: null },
      query: { canonical: {
        invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query' },
        composition: { selectionFacets: ['filter'], selectionCombine: 'intersection', ordering: 'sort', pagination: 'cursor-pagination' },
        search: null,
        filter: { maxDepth: 2, maxNodes: 100, targets: [{ field: 'f_title', kind: 'field', valueType: 'string', operators: ['eq', 'contains'], nullable: false }] },
        sort: { fields: ['f_title'], directions: ['asc', 'desc'], maxCriteria: 8, default: [], nullPlacement: 'provider-defined', stableTieBreaker: 'provider-defined', temporalRange: null },
        pagination: { limit: { minimum: 1, maximum: 100, default: 100 }, cursor: { opaque: true, binds: ['space', 'model', 'schema'], snapshotConsistency: false } },
      } },
    } };
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
    `${CORE_BASE}/me/_discovery/inventory`,
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
  assert.deepEqual(context.calls.map((call) => call.url), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]);
});

test('External Record Type options pin the selected Space dynamic contract instead of the global definition', async () => {
  const node = new LifeSpaceAgentTool();
  const context = editorContext({ spaceId: 'spc_external', operation: 'query' });
  const options = await node.methods.loadOptions.getRecordTypes.call(context);
  const external = options.find((option) => option.name === 'Health Document');
  assert.ok(external);
  const snapshot = decodeAgentToolSemanticSnapshot(external.value);
  assert.equal(snapshot.spaceId, 'spc_external');
  assert.equal(snapshot.model.origin, 'external');
  assert.equal(snapshot.model.version, undefined);
  assert.equal(snapshot.model.schemaHash, 'external-space-schema');
  assert.equal(snapshot.model.fields[0].key, 'f_title');
  assert.equal(snapshot.model.runtimeCapabilities.query, true);
  const urls = context.calls.map((call) => call.url);
  assert.deepEqual(urls.slice(0, 2), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/inventory`,
  ]);
  assert.deepEqual(new Set(urls.slice(2)), new Set([
    `${CORE_BASE}/spaces/spc_external/_discovery/models/health_document`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]));
});

test('External Record Type is not advertised for operations absent from its current Space runtime capabilities', async () => {
  const node = new LifeSpaceAgentTool();
  const context = editorContext({ spaceId: 'spc_external', operation: 'update' });
  const options = await node.methods.loadOptions.getRecordTypes.call(context);
  assert.equal(options.some((option) => option.name === 'Health Document'), false);
});

test('A directly entered model key resolves static semantics when the Tool is supplied', async () => {
  const node = new LifeSpaceAgentTool();
  const context = runtimeContext();
  const supplied = await node.supplyData.call(context, 0);
  assert.ok(supplied.response);
  assert.equal(supplied.response.metadata.lifeSpaceModelVersion, 6);
  assert.deepEqual(context.calls.map((call) => call.url), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]);
});
