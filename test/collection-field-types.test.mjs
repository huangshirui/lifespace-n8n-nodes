import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildAgentToolDefinition } = require('../dist/nodes/agent/lifeSpaceToolFactory.js');
const { genericQuerySchema } = require('../dist/nodes/agent/lifeSpaceGenericQueryTool.js');

const runtimeCapabilities = {
  get: true,
  query: true,
  create: true,
  update: true,
  delete: true,
  batchWrite: true,
  atomicBatch: false,
  transaction: false,
  versionedWrite: false,
  actions: false,
  relationTargetResolution: false,
};

function model() {
  return {
    key: 'external_docs',
    origin: 'external',
    spaceId: 'spc_test',
    schemaHash: 'sha256:collection-types',
    display: { singular: 'External document', plural: 'External documents' },
    description: 'Synthetic External model for collection field contract coverage.',
    access: ['read', 'write'],
    fields: [
      { key: 'title', title: 'Title', type: 'string', nullable: false, readOnly: false },
      { key: 'tags', title: 'Tags', type: 'enum_list', values: ['Alpha', 'Beta'], nullable: false, readOnly: false },
      { key: 'files', title: 'Files', type: 'file_ref_list', nullable: true, readOnly: false },
    ],
    defaults: {},
    query: {
      searchable: [], filterable: [], sortable: [], search: null, filters: [], comparisons: [], capabilityQueries: [],
      sort: { parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8, default: [], envelopeFields: [], nullPlacement: 'provider-defined', genericValues: [] },
      pagination: { limit: { parameter: 'limit', minimum: 1, maximum: 100, default: 100 }, cursor: { parameter: 'cursor', type: 'string' } },
      canonical: {
        invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query' },
        search: null,
        filter: { maxDepth: 2, maxNodes: 100, targets: [
          { field: 'tags', kind: 'field', valueType: 'enum_list', operators: ['contains'], nullable: false },
        ] },
        sort: { fields: [], directions: ['asc', 'desc'], maxCriteria: 8, default: [], nullPlacement: 'provider-defined', stableTieBreaker: 'provider-defined', temporalRange: null },
        pagination: { limit: { minimum: 1, maximum: 100, default: 100 }, cursor: { opaque: true, binds: ['space', 'model', 'schema'], snapshotConsistency: false } },
      },
    },
    actions: [], capabilities: [], capabilityBindings: {}, runtimeCapabilities,
    contract: { kind: 'dynamic', revision: null },
  };
}

test('Agent Tool projects enum_list and file_ref_list with canonical JSON shapes', () => {
  const definition = buildAgentToolDefinition(model(), {
    spaceId: 'spc_test',
    spaceName: 'Test Space',
    operation: 'create',
  });

  const tags = definition.schema.properties.tags;
  assert.equal(tags.type, 'array');
  assert.equal(tags.uniqueItems, true);
  assert.deepEqual(tags.items?.enum, ['Alpha', 'Beta']);

  const files = definition.schema.properties.files;
  assert.ok(Array.isArray(files.oneOf), 'nullable file_ref_list should use oneOf');
  const fileArray = files.oneOf.find((branch) => branch.type === 'array');
  assert.equal(fileArray.maxItems, 100);
  assert.deepEqual(fileArray.items.required, ['name', 'url']);
  assert.equal(fileArray.items.additionalProperties, false);
  assert.equal(fileArray.items.properties.name.maxLength, 512);
  assert.equal(fileArray.items.properties.url.format, 'uri');
  assert.equal(fileArray.items.properties.url.maxLength, 8192);
  assert.equal(fileArray.items.properties.expiresAt.format, 'date-time');
});

test('Canonical enum_list contains query takes one declared enum value, not an array', () => {
  const schema = genericQuerySchema(model());
  const filters = schema.properties.filters;
  const branches = filters.items.oneOf;
  const tagsBranch = branches.find((branch) => branch.properties?.field?.enum?.includes('tags'));
  assert.deepEqual(tagsBranch.properties.operator.enum, ['contains']);
  assert.equal(tagsBranch.properties.value.type, 'string');
  assert.deepEqual(tagsBranch.properties.value.enum, ['Alpha', 'Beta']);
});
