import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');
const { decodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');

const BASE_URL = 'https://example.invalid/api/v1';
const externalCapabilities = {
  get: true,
  query: true,
  create: false,
  update: false,
  delete: false,
  batchWrite: false,
  atomicBatch: false,
  transaction: false,
  versionedWrite: false,
  actions: false,
  relationTargetResolution: false,
};
const inventory = {
  data: {
    semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
    models: [
      {
        key: 'task', version: 7, schemaHash: 'sha256:task-v7',
        display: { singular: 'Task', plural: 'Tasks' }, capabilities: [], actions: [],
      },
      {
        key: 'health_document', origin: 'external', spaceId: 'spc_test', schemaHash: 'sha256:notion-a',
        display: { singular: 'Health Document', plural: 'Health Documents' },
        runtimeCapabilities: externalCapabilities, contract: { kind: 'dynamic', revision: null },
      },
      {
        key: 'health_document', origin: 'external', spaceId: 'spc_other', schemaHash: 'sha256:notion-b',
        display: { singular: 'Health Document', plural: 'Health Documents' },
        runtimeCapabilities: { ...externalCapabilities, create: true, update: true, batchWrite: true },
        contract: { kind: 'dynamic', revision: null },
      },
    ],
    spaces: [
      { spaceId: 'spc_test', spaceName: 'Test Space', models: [
        { modelKey: 'task', access: ['read', 'write'] },
        { modelKey: 'health_document', access: ['read'] },
      ] },
      { spaceId: 'spc_other', spaceName: 'Other Space', models: [
        { modelKey: 'health_document', access: ['read', 'write'] },
      ] },
    ],
  },
};

function externalDetail(spaceId = 'spc_test') {
  const other = spaceId === 'spc_other';
  const runtimeCapabilities = other
    ? { ...externalCapabilities, create: true, update: true, batchWrite: true }
    : externalCapabilities;
  return {
    data: {
      key: 'health_document', modelKey: 'health_document', origin: 'external', spaceId,
      schemaHash: other ? 'sha256:notion-b' : 'sha256:notion-a',
      display: { singular: 'Health Document', plural: 'Health Documents' },
      description: 'Provider-neutral dynamic document.',
      access: other ? ['read', 'write'] : ['read'],
      fields: [
        { key: 'title', title: 'Title', type: 'string', nullable: false, readable: true, writable: other, operators: ['eq', 'contains'], sortable: true },
        { key: 'created', title: 'Created', type: 'instant', nullable: false, readable: true, writable: false, operators: ['eq', 'gte'], sortable: true },
        { key: 'subject', title: 'Subject', type: 'entity_ref', valueSchema: { type: 'object', properties: { kind: { const: 'person' }, personId: { type: 'string' } }, required: ['kind', 'personId'], additionalProperties: false }, nullable: true, readable: true, writable: other, operators: [], sortable: false },
        { key: 'tags', title: 'Tags', type: 'enum_list', values: ['Alpha', 'Beta'], nullable: false, readable: true, writable: other, operators: ['contains'], sortable: false },
        { key: 'files', title: 'Files', type: 'file_ref_list', nullable: true, readable: true, writable: false, operators: [], sortable: false },
      ],
      actions: [], capabilities: [], capabilityBindings: {}, runtimeCapabilities,
      contract: { kind: 'dynamic', revision: null },
      query: { canonical: {
        invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query' },
        composition: { selectionFacets: ['search', 'filter'], selectionCombine: 'intersection', ordering: 'sort', pagination: 'cursor-pagination' },
        search: null,
        filter: { maxDepth: 2, maxNodes: 100, targets: [
          { field: 'title', kind: 'field', valueType: 'string', operators: ['eq', 'contains'], nullable: false },
          { field: 'created', kind: 'field', valueType: 'instant', operators: ['eq', 'gte'], nullable: false },
          { field: 'tags', kind: 'field', valueType: 'enum_list', operators: ['contains'], nullable: false },
        ] },
        sort: { fields: ['title', 'created'], directions: ['asc', 'desc'], maxCriteria: 8, default: [], nullPlacement: 'provider-defined', stableTieBreaker: 'provider-defined', temporalRange: null },
        pagination: { limit: { minimum: 1, maximum: 100, default: 100 }, cursor: { opaque: true, binds: ['space', 'model', 'schema'], snapshotConsistency: false } },
      } },
    },
  };
}

function context(parameters = {}) {
  const calls = [];
  return {
    calls,
    getCredentials: async () => ({ baseUrl: BASE_URL }),
    getCurrentNodeParameter(name) { return Object.hasOwn(parameters, name) ? parameters[name] : undefined; },
    getNodeParameter(name, fallback) { return Object.hasOwn(parameters, name) ? parameters[name] : fallback; },
    getNode: () => ({ name: 'LifeSpace' }),
    helpers: { async httpRequestWithAuthentication(_credentialName, options) {
      calls.push(options);
      if (options.url === `${BASE_URL}/me/_discovery/inventory`) return structuredClone(inventory);
      const match = /\/spaces\/(spc_test|spc_other)\/_discovery\/models\/health_document$/u.exec(options.url);
      if (match) return externalDetail(match[1]);
      throw new Error(`Unexpected request ${options.method} ${options.url}`);
    } },
  };
}

test('Space selector keeps External models and does not collapse same modelKey across Spaces', async () => {
  const node = new LifeSpaceWorkflow();
  const current = context();
  const spaces = await node.methods.loadOptions.getSpaces.call(current);
  assert.deepEqual(spaces.map((item) => [item.value, item.description]), [
    ['spc_test', 'spc_test · 2 available Record Types'],
    ['spc_other', 'spc_other · 1 available Record Type'],
  ]);
});

test('Record Type selector projects current External runtime capabilities instead of filtering by origin', async () => {
  const node = new LifeSpaceWorkflow();
  const readContext = context({ spaceId: 'spc_test', operation: 'list' });
  const readTypes = await node.methods.loadOptions.getRecordTypes.call(readContext);
  const external = readTypes.find((item) => item.name.includes('Health Documents'));
  assert.ok(external);
  const selector = decodeRecordTypeSelector(external.value);
  assert.equal(selector.origin, 'external');
  assert.equal(selector.spaceId, 'spc_test');
  assert.equal(selector.schemaHash, 'sha256:notion-a');
  assert.equal(selector.runtimeCapabilities.query, true);

  const createContext = context({ spaceId: 'spc_test', operation: 'create' });
  const createTypes = await node.methods.loadOptions.getRecordTypes.call(createContext);
  assert.equal(createTypes.some((item) => item.name.includes('Health Documents')), false);

  const writableContext = context({ spaceId: 'spc_other', operation: 'create' });
  const writableTypes = await node.methods.loadOptions.getRecordTypes.call(writableContext);
  assert.equal(writableTypes.some((item) => item.name.includes('Health Documents')), true);
});

test('selected External Record Type loads Space-local dynamic fields without fabricating Native version', async () => {
  const node = new LifeSpaceWorkflow();
  const optionContext = context({ spaceId: 'spc_other', operation: 'create' });
  const options = await node.methods.loadOptions.getRecordTypes.call(optionContext);
  const external = options.find((item) => item.name.includes('Health Documents'));
  assert.ok(external);

  const fieldContext = context({ spaceId: 'spc_other', operation: 'create', recordType: external.value });
  const fields = await node.methods.resourceMapping.getHumanRecordFields.call(fieldContext);
  assert.deepEqual(fields.fields.map((field) => field.id), ['lsf:string:title', 'lsf:entity_ref:subject', 'lsf:enum_list:tags']);
  assert.equal(fields.fields.find((field) => field.id === 'lsf:entity_ref:subject')?.type, 'object');
  assert.equal(fields.fields.find((field) => field.id === 'lsf:enum_list:tags')?.type, 'array');
  assert.equal(fields.fields.some((field) => field.id.includes('files')), false, 'read-only file_ref_list must not appear in mutation mapper');
  const selector = decodeRecordTypeSelector(external.value);
  assert.equal(selector.schemaHash, 'sha256:notion-b');
  assert.equal(fieldContext.calls.some((call) => call.url.endsWith('/spaces/spc_other/_discovery/models/health_document')), true);
});
