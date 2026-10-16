import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function replaceOnce(path, oldText, newText, label) {
  const text = readFileSync(path, 'utf8');
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  writeFileSync(path, text.replace(oldText, newText));
}

run('git', ['fetch', 'origin', 'main', '--depth=1']);
run('git', ['checkout', 'origin/main', '--',
  'nodes/lifespaceDiscovery.ts',
  'nodes/LifeSpace/LifeSpace.node.ts',
  'nodes/LifeSpaceWorkflow/humanProjection.ts',
  'nodes/agent/lifeSpaceToolFactory.ts',
  'test/external-discovery-compat.test.mjs',
  'test/agent-tool.test.mjs',
]);

replaceOnce(
  'nodes/lifespaceDiscovery.ts',
  "  type: 'string' | 'text' | 'integer' | 'number' | 'boolean' | 'date' | 'instant' | 'datetime' | 'timezone' | 'enum' | 'person' | 'person_list' | 'record' | 'record_list' | 'range<date>' | 'range<instant>' | 'temporal_range';\n",
  "  type: 'string' | 'text' | 'integer' | 'number' | 'boolean' | 'date' | 'instant' | 'datetime' | 'timezone' | 'enum' | 'person' | 'person_list' | 'record' | 'record_list' | 'range<date>' | 'range<instant>' | 'temporal_range' | 'recurrence_rule' | 'entity_ref';\n  valueSchema?: Record<string, unknown>;\n",
  'DiscoveryField canonical type union',
);
replaceOnce(
  'nodes/lifespaceDiscovery.ts',
  "  type: DiscoveryField['type'];\n  nullable: boolean;\n",
  "  type: DiscoveryField['type'];\n  valueSchema?: Record<string, unknown>;\n  nullable: boolean;\n",
  'ExternalSemanticField valueSchema',
);
replaceOnce(
  'nodes/lifespaceDiscovery.ts',
  "      type: field.type,\n      nullable: field.nullable,\n",
  "      type: field.type,\n      valueSchema: field.valueSchema,\n      nullable: field.nullable,\n",
  'External detail valueSchema preservation',
);

replaceOnce(
  'nodes/LifeSpace/LifeSpace.node.ts',
  "    case 'date':\n    case 'datetime':\n      return 'dateTime';\n",
  "    case 'date':\n    case 'instant':\n    case 'datetime':\n      return 'dateTime';\n",
  'Resource Mapper instant mapping',
);
replaceOnce(
  'nodes/LifeSpace/LifeSpace.node.ts',
  "    case 'person_list':\n    case 'record_list':\n      return 'array';\n",
  "    case 'range<date>':\n    case 'range<instant>':\n    case 'temporal_range':\n    case 'recurrence_rule':\n    case 'entity_ref':\n      return 'object';\n    case 'person_list':\n    case 'record_list':\n      return 'array';\n",
  'Resource Mapper structured canonical mapping',
);

replaceOnce(
  'nodes/LifeSpaceWorkflow/humanProjection.ts',
  "    'temporal-range',\n  ].includes(type)) return 'object';\n",
  "    'temporal-range',\n    'recurrence_rule',\n    'entity_ref',\n  ].includes(type)) return 'object';\n",
  'Workflow structured canonical mapping',
);

replaceOnce(
  'nodes/agent/lifeSpaceToolFactory.ts',
  "    case 'temporal_range':\n      schema = temporalRangeSchema();\n      break;\n    case 'timezone':\n",
  "    case 'temporal_range':\n      schema = temporalRangeSchema();\n      break;\n    case 'recurrence_rule':\n    case 'entity_ref':\n      if (!field.valueSchema) throw new Error(`LifeSpace structured field ${field.key} is missing canonical valueSchema`);\n      schema = structuredClone(field.valueSchema) as JsonSchema;\n      break;\n    case 'timezone':\n",
  'Agent Tool structured canonical schema projection',
);

replaceOnce(
  'test/external-discovery-compat.test.mjs',
  "        { key: 'f_created', title: 'Created', type: 'instant', nullable: false, readable: true, writable: false, operators: ['eq', 'gte'], sortable: true },\n",
  "        { key: 'f_created', title: 'Created', type: 'instant', nullable: false, readable: true, writable: false, operators: ['eq', 'gte'], sortable: true },\n        { key: 'f_subject', title: 'Subject', type: 'entity_ref', valueSchema: { type: 'object', properties: { kind: { const: 'person' }, personId: { type: 'string' } }, required: ['kind', 'personId'], additionalProperties: false }, nullable: true, readable: true, writable: other, operators: [], sortable: false },\n",
  'External dynamic structured field fixture',
);
replaceOnce(
  'test/external-discovery-compat.test.mjs',
  "  assert.deepEqual(fields.fields.map((field) => field.id), ['lsf:string:f_title']);\n",
  "  assert.deepEqual(fields.fields.map((field) => field.id), ['lsf:string:f_title', 'lsf:entity_ref:f_subject']);\n  assert.equal(fields.fields.find((field) => field.id === 'lsf:entity_ref:f_subject')?.type, 'object');\n",
  'External Resource Mapper structured field assertion',
);

replaceOnce(
  'test/agent-tool.test.mjs',
  "    fields: [{ key: 'f_title', title: 'Title', type: 'string', readOnly: false }], defaults: {},\n",
  "    fields: [\n      { key: 'f_title', title: 'Title', type: 'string', readOnly: false },\n      { key: 'f_subject', title: 'Subject', type: 'entity_ref', readOnly: false, valueSchema: { type: 'object', properties: { kind: { const: 'person' }, personId: { type: 'string', pattern: '^per_' } }, required: ['kind', 'personId'], additionalProperties: false } },\n    ], defaults: {},\n",
  'External Agent Tool structured field fixture',
);
replaceOnce(
  'test/agent-tool.test.mjs',
  "  const update = buildAgentToolRequest(model, { spaceId: 'spc_test', operation: 'update' }, { recordId: 'rec_external_1', f_title: 'Changed' });\n",
  "  const definition = buildAgentToolDefinition(model, { spaceId: 'spc_test', operation: 'create' });\n  assert.equal(definition.schema.properties.f_subject.type, 'object');\n  assert.equal(definition.schema.properties.f_subject.properties.kind.const, 'person');\n  const update = buildAgentToolRequest(model, { spaceId: 'spc_test', operation: 'update' }, { recordId: 'rec_external_1', f_title: 'Changed' });\n",
  'External Agent Tool structured schema assertion',
);

rmSync('.github/workflows/tmp-canonical-field-refactor.yml', { force: true });
rmSync('tmp-canonical-field-refactor.mjs', { force: true });
