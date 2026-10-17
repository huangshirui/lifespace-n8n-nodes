from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one patch anchor, found {count}")
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    "nodes/lifespaceDiscovery.ts",
    "  type: 'string' | 'text' | 'integer' | 'number' | 'boolean' | 'date' | 'instant' | 'datetime' | 'timezone' | 'enum' | 'person' | 'person_list' | 'record' | 'record_list' | 'range<date>' | 'range<instant>' | 'temporal_range' | 'recurrence_rule' | 'entity_ref';",
    "  type: 'string' | 'text' | 'integer' | 'number' | 'boolean' | 'date' | 'instant' | 'datetime' | 'timezone' | 'enum' | 'enum_list' | 'file_ref_list' | 'person' | 'person_list' | 'record' | 'record_list' | 'range<date>' | 'range<instant>' | 'temporal_range' | 'recurrence_rule' | 'entity_ref';",
)

replace_once(
    "nodes/agent/lifeSpaceToolFactory.ts",
    "  maxItems?: number;\n  minLength?: number;",
    "  maxItems?: number;\n  uniqueItems?: boolean;\n  minLength?: number;",
)

replace_once(
    "nodes/agent/lifeSpaceToolFactory.ts",
    "function withNullable(field: DiscoveryField, schema: JsonSchema): JsonSchema {",
    """function fileRefListSchema(): JsonSchema {
  return {
    type: 'array',
    maxItems: 100,
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 512 },
        url: { type: 'string', format: 'uri', maxLength: 8192 },
        expiresAt: { type: 'string', format: 'date-time' },
      },
      required: ['name', 'url'],
      additionalProperties: false,
    },
  };
}

function withNullable(field: DiscoveryField, schema: JsonSchema): JsonSchema {""",
)

replace_once(
    "nodes/agent/lifeSpaceToolFactory.ts",
    """    case 'enum':
      if (!field.values?.length) throw new Error(`LifeSpace enum field ${field.key} has no published values`);
      schema = { type: 'string', enum: [...field.values] };
      break;
    case 'person':""",
    """    case 'enum':
      if (!field.values?.length) throw new Error(`LifeSpace enum field ${field.key} has no published values`);
      schema = { type: 'string', enum: [...field.values] };
      break;
    case 'enum_list':
      if (!field.values?.length) throw new Error(`LifeSpace enum_list field ${field.key} has no published values`);
      schema = {
        type: 'array',
        uniqueItems: true,
        items: { type: 'string', enum: [...field.values] },
      };
      break;
    case 'file_ref_list':
      schema = fileRefListSchema();
      break;
    case 'person':""",
)

replace_once(
    "nodes/LifeSpaceWorkflow/humanProjection.ts",
    "  if (type === 'person_list' || type === 'record_list') return 'array';",
    "  if (['person_list', 'record_list', 'enum_list', 'file_ref_list'].includes(type)) return 'array';",
)

replace_once(
    "test/external-discovery-compat.test.mjs",
    """      fields: [
        { key: 'f_title', title: 'Title', type: 'string', nullable: false, readable: true, writable: other, operators: ['eq', 'contains'], sortable: true },
        { key: 'f_created', title: 'Created', type: 'instant', nullable: false, readable: true, writable: false, operators: ['eq', 'gte'], sortable: true },
        { key: 'f_subject', title: 'Subject', type: 'entity_ref', valueSchema: { type: 'object', properties: { kind: { const: 'person' }, personId: { type: 'string' } }, required: ['kind', 'personId'], additionalProperties: false }, nullable: true, readable: true, writable: other, operators: [], sortable: false },
      ],""",
    """      fields: [
        { key: 'title', title: 'Title', type: 'string', nullable: false, readable: true, writable: other, operators: ['eq', 'contains'], sortable: true },
        { key: 'created', title: 'Created', type: 'instant', nullable: false, readable: true, writable: false, operators: ['eq', 'gte'], sortable: true },
        { key: 'subject', title: 'Subject', type: 'entity_ref', valueSchema: { type: 'object', properties: { kind: { const: 'person' }, personId: { type: 'string' } }, required: ['kind', 'personId'], additionalProperties: false }, nullable: true, readable: true, writable: other, operators: [], sortable: false },
        { key: 'tags', title: 'Tags', type: 'enum_list', values: ['Alpha', 'Beta'], nullable: false, readable: true, writable: other, operators: ['contains'], sortable: false },
        { key: 'files', title: 'Files', type: 'file_ref_list', nullable: true, readable: true, writable: false, operators: [], sortable: false },
      ],""",
)

replace_once(
    "test/external-discovery-compat.test.mjs",
    """        filter: { maxDepth: 2, maxNodes: 100, targets: [
          { field: 'f_title', kind: 'field', valueType: 'string', operators: ['eq', 'contains'], nullable: false },
          { field: 'f_created', kind: 'field', valueType: 'instant', operators: ['eq', 'gte'], nullable: false },
        ] },
        sort: { fields: ['f_title', 'f_created'], directions: ['asc', 'desc'], maxCriteria: 8, default: [], nullPlacement: 'provider-defined', stableTieBreaker: 'provider-defined', temporalRange: null },""",
    """        filter: { maxDepth: 2, maxNodes: 100, targets: [
          { field: 'title', kind: 'field', valueType: 'string', operators: ['eq', 'contains'], nullable: false },
          { field: 'created', kind: 'field', valueType: 'instant', operators: ['eq', 'gte'], nullable: false },
          { field: 'tags', kind: 'field', valueType: 'enum_list', operators: ['contains'], nullable: false },
        ] },
        sort: { fields: ['title', 'created'], directions: ['asc', 'desc'], maxCriteria: 8, default: [], nullPlacement: 'provider-defined', stableTieBreaker: 'provider-defined', temporalRange: null },""",
)

replace_once(
    "test/external-discovery-compat.test.mjs",
    """  assert.deepEqual(fields.fields.map((field) => field.id), ['lsf:string:f_title', 'lsf:entity_ref:f_subject']);
  assert.equal(fields.fields.find((field) => field.id === 'lsf:entity_ref:f_subject')?.type, 'object');""",
    """  assert.deepEqual(fields.fields.map((field) => field.id), ['lsf:string:title', 'lsf:entity_ref:subject', 'lsf:enum_list:tags']);
  assert.equal(fields.fields.find((field) => field.id === 'lsf:entity_ref:subject')?.type, 'object');
  assert.equal(fields.fields.find((field) => field.id === 'lsf:enum_list:tags')?.type, 'array');
  assert.equal(fields.fields.some((field) => field.id.includes('files')), false, 'read-only file_ref_list must not appear in mutation mapper');""",
)

Path("test/collection-field-types.test.mjs").write_text("""import assert from 'node:assert/strict';
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
""")
