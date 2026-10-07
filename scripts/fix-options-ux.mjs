import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, from, to) {
  const source = await readFile(path, 'utf8');
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`${path}: missing replacement marker`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`${path}: replacement marker is not unique`);
  await writeFile(path, `${source.slice(0, first)}${to}${source.slice(first + from.length)}`);
}

async function transformNode() {
  const path = 'nodes/LifeSpace/LifeSpace.node.ts';
  let source = await readFile(path, 'utf8');

  const oldConfiguredVersion = `function configuredMutationVersion(\n  context: IExecuteFunctions,\n  itemIndex: number,\n): number | undefined {\n  const options = context.getNodeParameter('mutationOptions', itemIndex, {}) as IDataObject;\n  const configuredVersion = options.version;`;
  const newConfiguredVersion = `function configuredMutationVersion(\n  context: IExecuteFunctions,\n  itemIndex: number,\n): number | undefined {\n  const options = context.getNodeParameter('recordOptions', itemIndex, {}) as IDataObject;\n  const legacyOptions = context.getNodeParameter('mutationOptions', itemIndex, {}) as IDataObject;\n  const configuredVersion = options.version ?? legacyOptions.version;`;
  if (!source.includes(oldConfiguredVersion)) throw new Error('LifeSpace.node.ts: configuredMutationVersion marker missing');
  source = source.replace(oldConfiguredVersion, newConfiguredVersion);

  const oldRecordOptionsStart = `      {\n        displayName: 'Options',\n        name: 'recordOptions',`;
  const spaceMarker = `      {\n        displayName: 'Space Name or ID', name: 'spaceId', type: 'options',`;
  const recordStart = source.indexOf(oldRecordOptionsStart);
  const spaceStart = source.indexOf(spaceMarker, recordStart);
  if (recordStart < 0 || spaceStart < 0) throw new Error('LifeSpace.node.ts: early Record Options block markers missing');
  source = `${source.slice(0, recordStart)}${source.slice(spaceStart)}`;

  const concurrencyStartMarker = `      {\n        displayName: 'Concurrency Options', name: 'mutationOptions', type: 'collection', placeholder: 'Add Option', default: {},`;
  const actionMarker = `      {\n        displayName: 'Action Name or ID', name: 'actionKey', type: 'options', noDataExpression: true,`;
  const concurrencyStart = source.indexOf(concurrencyStartMarker);
  const actionStart = source.indexOf(actionMarker, concurrencyStart);
  if (concurrencyStart < 0 || actionStart < 0) throw new Error('LifeSpace.node.ts: Concurrency Options block markers missing');
  source = `${source.slice(0, concurrencyStart)}${source.slice(actionStart)}`;

  const apiOperationMarker = `      {\n        displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,\n        displayOptions: { show: { resource: ['apiRequest'] } },`;
  const apiOperationIndex = source.indexOf(apiOperationMarker);
  if (apiOperationIndex < 0) throw new Error('LifeSpace.node.ts: API Request operation marker missing');

  const unifiedOptions = `      {\n        displayName: 'Options',\n        name: 'recordOptions',\n        type: 'collection',\n        placeholder: 'Add Option',\n        default: {},\n        noDataExpression: true,\n        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update', 'delete'] } },\n        options: [\n          {\n            displayName: 'Batch Processing',\n            name: 'batchProcessing',\n            type: 'boolean',\n            default: true,\n            description: 'Whether to group incoming n8n items into one LifeSpace request. When enabled without Atomic Consistency, items succeed or fail independently and partial success is preserved.',\n          },\n          {\n            displayName: 'Atomic Consistency',\n            name: 'atomicConsistency',\n            type: 'boolean',\n            default: false,\n            description: 'Whether the grouped mutation must commit all items or roll back the whole request. Enable only when the business operation requires all-or-none semantics.',\n          },\n          {\n            displayName: 'Version',\n            name: 'version',\n            type: 'number',\n            typeOptions: { minValue: 1, numberPrecision: 0 },\n            default: 1,\n            displayOptions: { show: { '/operation': ['update', 'delete'] } },\n            description: 'Optional known record version. In single mode, omission makes the node read the current version immediately before mutation. In Batch Processing, omission is sent to Core for set-wise current-version resolution before commit.',\n          },\n        ],\n      },\n`;
  source = `${source.slice(0, apiOperationIndex)}${unifiedOptions}${source.slice(apiOperationIndex)}`;

  if (source.includes("displayName: 'Concurrency Options'")) throw new Error('LifeSpace.node.ts: Concurrency Options still present');
  if ((source.match(/name: 'recordOptions'/gu) ?? []).length !== 1) throw new Error('LifeSpace.node.ts: expected exactly one recordOptions property');
  await writeFile(path, source);
}

async function transformWorkflowSurfaceTest() {
  const path = 'test/workflow-0.2-surface.test.mjs';
  let source = await readFile(path, 'utf8');
  const from = `test('0.2.0 Query and mutation concurrency UX keep the accepted independent options', () => {\n  const node = new LifeSpaceWorkflow();\n\n  const queryOptions = property(node, 'options');\n  assert.ok(queryOptions.options.some((option) => option.name === 'cursor'));\n  assert.ok(queryOptions.options.some((option) => option.name === 'viewingTimezone'));\n\n  const mutationOptions = property(node, 'mutationOptions');\n  const version = mutationOptions.options.find((option) => option.name === 'version');\n  assert.ok(version);\n  assert.match(version.description, /Optional known record version/u);\n\n  const action = property(node, 'actionKey');\n  assert.ok(action);\n  assert.deepEqual(action.displayOptions.show.operation, ['executeAction']);\n});`;
  const to = `test('0.2.0 Record mutations use one bottom Options collection', () => {\n  const node = new LifeSpaceWorkflow();\n\n  const queryOptions = property(node, 'options');\n  assert.ok(queryOptions.options.some((option) => option.name === 'cursor'));\n  assert.ok(queryOptions.options.some((option) => option.name === 'viewingTimezone'));\n\n  const recordOptions = property(node, 'recordOptions');\n  assert.ok(recordOptions.options.some((option) => option.name === 'batchProcessing'));\n  assert.ok(recordOptions.options.some((option) => option.name === 'atomicConsistency'));\n  const version = recordOptions.options.find((option) => option.name === 'version');\n  assert.ok(version);\n  assert.match(version.description, /Optional known record version/u);\n  assert.deepEqual(version.displayOptions.show['/operation'], ['update', 'delete']);\n  assert.equal(property(node, 'mutationOptions'), undefined);\n\n  const properties = node.description.properties;\n  assert.ok(properties.findIndex((entry) => entry.name === 'recordOptions') > properties.findIndex((entry) => entry.name === 'actionInput'));\n\n  const action = property(node, 'actionKey');\n  assert.ok(action);\n  assert.deepEqual(action.displayOptions.show.operation, ['executeAction']);\n});`;
  if (!source.includes(from)) throw new Error(`${path}: old UX test block missing`);
  source = source.replace(from, to);
  await writeFile(path, source);
}

async function transformSourceContractTest() {
  const path = 'test/source-contract.test.mjs';
  let source = await readFile(path, 'utf8');
  const marker = `  assert.match(node, /name: 'recordOptions'[\\s\\S]{0,1200}displayName: 'Atomic Consistency'/u);`;
  const replacement = `${marker}\n  assert.match(node, /name: 'recordOptions'[\\s\\S]{0,1800}displayName: 'Version'/u);\n  assert.doesNotMatch(node, /displayName: 'Concurrency Options'/u);`;
  if (!source.includes(marker)) throw new Error(`${path}: recordOptions assertion marker missing`);
  source = source.replace(marker, replacement);
  await writeFile(path, source);
}

async function transformExecutionTests() {
  const path = 'test/execution-request-counts.test.mjs';
  let source = await readFile(path, 'utf8');
  source = source.replace(`    mutationOptions: { version: 5 },\n    'fields.value': { name: 'Update' },`, `    recordOptions: { version: 5 },\n    'fields.value': { name: 'Update' },`);
  source = source.replace(`    mutationOptions: { version: 5 },\n  });\n  assert.deepEqual(requestShape(calls), [\n    ['DELETE',`, `    recordOptions: { version: 5 },\n  });\n  assert.deepEqual(requestShape(calls), [\n    ['DELETE',`);
  if (!source.includes(`recordOptions: { version: 5 }`)) throw new Error(`${path}: new recordOptions version coverage missing`);
  await writeFile(path, source);
}

async function transformReadme() {
  await replaceOnce('README.md', '**Concurrency Options → Version**', '**Options → Version**');
}

await transformNode();
await transformWorkflowSurfaceTest();
await transformSourceContractTest();
await transformExecutionTests();
await transformReadme();
