import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  writeFileSync(path, content);
}

function replaceOnce(content, from, to, label) {
  const index = content.indexOf(from);
  if (index < 0) throw new Error(`Missing patch target: ${label}`);
  return content.slice(0, index) + to + content.slice(index + from.length);
}

function replaceAll(content, from, to) {
  return content.split(from).join(to);
}

// Runtime Discovery: recordType is an adapter selector carrying stable modelKey + REST route.
{
  const path = 'nodes/lifespaceDiscovery.ts';
  let source = read(path);

  source = replaceOnce(
    source,
    `type DiscoverySelection = {\n  spaceId: string;\n  modelRoute: string;\n};`,
    `type DiscoverySelection = {\n  spaceId: string;\n  modelKey: string;\n};`,
    'DiscoverySelection.modelKey',
  );

  source = replaceOnce(
    source,
    `const RELATION_TARGET_LOOKUP_PATH = '/api/v1/spaces/{spaceId}/_relation-targets/{modelKey}/{fieldKey}';`,
    `const RELATION_TARGET_LOOKUP_PATH = '/api/v1/spaces/{spaceId}/_relation-targets/{modelKey}/{fieldKey}';\nconst RECORD_TYPE_SELECTOR_PREFIX = 'lsrt1.';\n\nexport type RecordTypeSelector = {\n  modelKey: string;\n  route: string;\n};\n\nexport function encodeRecordTypeSelector(modelKey: string, route: string): string {\n  if (!modelKey.trim() || !route.trim()) throw new Error('LifeSpace Record Type selector requires modelKey and route');\n  const payload = Buffer.from(JSON.stringify([modelKey, route]), 'utf8').toString('base64url');\n  return \`${RECORD_TYPE_SELECTOR_PREFIX}\${payload}\`;\n}\n\nexport function decodeRecordTypeSelector(value: unknown): RecordTypeSelector {\n  const raw = String(value ?? '').trim();\n  if (!raw.startsWith(RECORD_TYPE_SELECTOR_PREFIX)) {\n    throw new Error('LifeSpace Record Type selector is invalid. Choose a Record Type from Discovery or pass a Trigger recordType value.');\n  }\n  try {\n    const decoded = JSON.parse(Buffer.from(raw.slice(RECORD_TYPE_SELECTOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;\n    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'string' || typeof decoded[1] !== 'string'\n      || !decoded[0].trim() || !decoded[1].trim()) {\n      throw new Error('invalid selector payload');\n    }\n    return { modelKey: decoded[0], route: decoded[1] };\n  } catch {\n    throw new Error('LifeSpace Record Type selector is invalid. Choose a Record Type from Discovery or pass a Trigger recordType value.');\n  }\n}`,
    'record type selector codec',
  );

  source = replaceOnce(
    source,
    `  const selectedSpaceId = selection?.spaceId ?? '';\n  const selectedModelRoute = selection?.modelRoute ?? '';\n  let selectedDetail: SemanticDetail | null = null;\n  let selectedModelKey = '';\n\n  if (selectedSpaceId && selectedModelRoute) {\n    const selectedSpace = inventory.data.spaces.find((space) => space.spaceId === selectedSpaceId);\n    const selectedIdentity = [...identities.values()].find((model) => model.route === selectedModelRoute);`,
    `  const selectedSpaceId = selection?.spaceId ?? '';\n  const selectedModelKey = selection?.modelKey ?? '';\n  let selectedDetail: SemanticDetail | null = null;\n\n  if (selectedSpaceId && selectedModelKey) {\n    const selectedSpace = inventory.data.spaces.find((space) => space.spaceId === selectedSpaceId);\n    const selectedIdentity = identities.get(selectedModelKey);`,
    'progressive selection by modelKey',
  );

  source = replaceOnce(
    source,
    `    if (visible && selectedIdentity && needsDetail) {\n      selectedModelKey = selectedIdentity.key;\n      const path = replacePathTemplate(inventory.data.semanticDetailPathTemplate, {`,
    `    if (visible && selectedIdentity && needsDetail) {\n      const path = replacePathTemplate(inventory.data.semanticDetailPathTemplate, {`,
    'selected model key assignment removal',
  );

  source = replaceOnce(
    source,
    `  const selection = {\n    spaceId: loadOptionParameter(this, 'spaceId'),\n    modelRoute: loadOptionParameter(this, 'modelRoute'),\n  };`,
    `  const recordType = loadOptionParameter(this, 'recordType');\n  const selection = {\n    spaceId: loadOptionParameter(this, 'spaceId'),\n    modelKey: recordType ? decodeRecordTypeSelector(recordType).modelKey : '',\n  };`,
    'design-time recordType selection',
  );

  source = replaceOnce(
    source,
    `  spaceId?: string,\n  modelRoute?: string,\n): Promise<DiscoveryResponse> {\n  const selection = spaceId && modelRoute ? { spaceId, modelRoute } : undefined;`,
    `  spaceId?: string,\n  modelKey?: string,\n): Promise<DiscoveryResponse> {\n  const selection = spaceId && modelKey ? { spaceId, modelKey } : undefined;`,
    'execution discovery modelKey',
  );

  source = replaceOnce(
    source,
    `export function discoveryModel(\n  discovery: DiscoveryResponse,\n  spaceId: string,\n  modelRoute: string,\n): DiscoveryModel | undefined {\n  return discoverySpace(discovery, spaceId)?.models.find((model) => model.route === modelRoute);\n}`,
    `export function discoveryModel(\n  discovery: DiscoveryResponse,\n  spaceId: string,\n  modelKey: string,\n): DiscoveryModel | undefined {\n  return discoverySpace(discovery, spaceId)?.models.find((model) => model.key === modelKey);\n}`,
    'discoveryModel by modelKey',
  );

  write(path, source);
}

// Ordinary Record node: persist one adapter selector, decode locally to key + route.
{
  const path = 'nodes/LifeSpace/LifeSpace.node.ts';
  let source = read(path);

  source = replaceOnce(
    source,
    `  discoveryModel,\n  discoverySpace,`,
    `  decodeRecordTypeSelector,\n  discoveryModel,\n  discoverySpace,\n  encodeRecordTypeSelector,`,
    'selector imports',
  );

  source = replaceAll(source, `'modelRoute'`, `'recordType'`);

  source = replaceOnce(
    source,
    `async function executionModel(\n  context: IExecuteFunctions,\n  itemIndex: number,\n  baseUrl: string,\n  spaceId: string,\n  modelRoute: string,\n): Promise<DiscoveryModel> {\n  const discovery = await loadExecutionRuntimeDiscovery(context, baseUrl, spaceId, modelRoute);\n  const model = discoveryModel(discovery, spaceId, modelRoute);\n  if (!model) {\n    throw new NodeOperationError(context.getNode(), \`LifeSpace Record Type \${modelRoute} is not available\`, { itemIndex });\n  }\n  return model;\n}`,
    `async function executionModel(\n  context: IExecuteFunctions,\n  itemIndex: number,\n  baseUrl: string,\n  spaceId: string,\n  modelKey: string,\n): Promise<DiscoveryModel> {\n  const discovery = await loadExecutionRuntimeDiscovery(context, baseUrl, spaceId, modelKey);\n  const model = discoveryModel(discovery, spaceId, modelKey);\n  if (!model) {\n    throw new NodeOperationError(context.getNode(), \`LifeSpace Record Type \${modelKey} is not available\`, { itemIndex });\n  }\n  return model;\n}`,
    'executionModel key',
  );

  source = replaceOnce(
    source,
    `  modelRoute: string,\n  recordPath: string,\n  actionKey: string,\n  semanticInput: IDataObject,\n): Promise<IDataObject> {\n  const model = await executionModel(context, itemIndex, baseUrl, spaceId, modelRoute);`,
    `  modelKey: string,\n  recordPath: string,\n  actionKey: string,\n  semanticInput: IDataObject,\n): Promise<IDataObject> {\n  const model = await executionModel(context, itemIndex, baseUrl, spaceId, modelKey);`,
    'action model key',
  );

  source = replaceOnce(
    source,
    `async function optionModel(context: ILoadOptionsFunctions): Promise<{ model: DiscoveryModel; spaceId: string } | null> {\n  const spaceId = String(context.getNodeParameter('spaceId', '')).trim();\n  const modelRoute = String(context.getNodeParameter('recordType', '')).trim();\n  if (!spaceId || !modelRoute) return null;\n  const discovery = await loadRuntimeDiscovery.call(context);\n  const model = discoveryModel(discovery, spaceId, modelRoute);\n  return model ? { model, spaceId } : null;\n}`,
    `async function optionModel(context: ILoadOptionsFunctions): Promise<{ model: DiscoveryModel; spaceId: string } | null> {\n  const spaceId = String(context.getNodeParameter('spaceId', '')).trim();\n  const recordTypeValue = String(context.getNodeParameter('recordType', '')).trim();\n  if (!spaceId || !recordTypeValue) return null;\n  const recordType = decodeRecordTypeSelector(recordTypeValue);\n  const discovery = await loadRuntimeDiscovery.call(context);\n  const model = discoveryModel(discovery, spaceId, recordType.modelKey);\n  return model ? { model, spaceId } : null;\n}`,
    'optionModel selector',
  );

  source = replaceOnce(
    source,
    `        displayName: 'Record Type Name or ID', name: 'recordType', type: 'options',\n        typeOptions: { loadOptionsMethod: 'getRecordTypes', loadOptionsDependsOn: ['spaceId', 'operation'] },\n        options: [], default: '', required: true, displayOptions: { show: { resource: ['modelRecord'] } },\n        description: 'Choose from the list, or specify an ID using an <a href=\"https://docs.n8n.io/code/expressions/\">expression</a>',`,
    `        displayName: 'Record Type', name: 'recordType', type: 'options',\n        typeOptions: { loadOptionsMethod: 'getRecordTypes', loadOptionsDependsOn: ['spaceId', 'operation'] },\n        options: [], default: '', required: true, displayOptions: { show: { resource: ['modelRecord'] } },\n        description: 'Choose from Discovery, or pass the recordType selector emitted by a LifeSpace Trigger using an <a href=\"https://docs.n8n.io/code/expressions/\">expression</a>',`,
    'recordType property',
  );

  source = replaceOnce(
    source,
    `          .map((model) => ({ name: \`\${model.display.plural} (\${model.route})\`, value: model.route, description: model.description ?? undefined }));`,
    `          .map((model) => ({\n            name: \`\${model.display.plural} (\${model.key})\`,\n            value: encodeRecordTypeSelector(model.key, model.route),\n            description: model.description ?? undefined,\n          }));`,
    'record type options use selector',
  );

  source = replaceOnce(
    source,
    `          const operation = this.getNodeParameter('operation', itemIndex) as string;\n          const rawSpaceId = String(this.getNodeParameter('spaceId', itemIndex));\n          const rawModelRoute = String(this.getNodeParameter('recordType', itemIndex));\n          const spaceId = encodeURIComponent(rawSpaceId);\n          const modelRoute = encodeURIComponent(rawModelRoute);\n          const collectionPath = \`/spaces/\${spaceId}/\${modelRoute}\`;`,
    `          const operation = this.getNodeParameter('operation', itemIndex) as string;\n          const rawSpaceId = String(this.getNodeParameter('spaceId', itemIndex));\n          const recordType = decodeRecordTypeSelector(this.getNodeParameter('recordType', itemIndex));\n          const rawModelKey = recordType.modelKey;\n          const rawModelRoute = recordType.route;\n          const spaceId = encodeURIComponent(rawSpaceId);\n          const modelRoute = encodeURIComponent(rawModelRoute);\n          const collectionPath = \`/spaces/\${spaceId}/\${modelRoute}\`;`,
    'execution selector decode',
  );

  source = replaceAll(source, `baseUrl, rawSpaceId, rawModelRoute`, `baseUrl, rawSpaceId, rawModelKey`);

  if (source.includes(`getNodeParameter('modelRoute'`) || source.includes(`'modelRoute'`)) {
    throw new Error('modelRoute parameter references remain in LifeSpace node');
  }

  write(path, source);
}

// Trigger: configure the same selectors, filter by modelKey, and emit recordType for direct composition.
{
  const path = 'nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.ts';
  let source = read(path);

  source = replaceOnce(
    source,
    `import {\n  discoverySpace,\n  loadRuntimeDiscovery,\n} from '../lifespaceDiscovery';`,
    `import {\n  decodeRecordTypeSelector,\n  discoverySpace,\n  encodeRecordTypeSelector,\n  loadRuntimeDiscovery,\n} from '../lifespaceDiscovery';`,
    'trigger selector imports',
  );

  source = replaceAll(source, `'recordTypeKeys'`, `'recordTypes'`);

  source = replaceOnce(
    source,
    `          .map((model) => ({\n            name: \`\${model.display.plural} (\${model.key})\`,\n            value: model.key,\n            description: model.description ?? undefined,\n          }));`,
    `          .map((model) => ({\n            name: \`\${model.display.plural} (\${model.key})\`,\n            value: encodeRecordTypeSelector(model.key, model.route),\n            description: model.description ?? undefined,\n          }));`,
    'trigger options use selector',
  );

  source = replaceOnce(
    source,
    `    const selectedEventTypes = this.getNodeParameter('eventTypes') as string[];\n    const selectedSpaceId = String(this.getNodeParameter('spaceId', '')).trim();\n    const selectedRecordTypeKeys = this.getNodeParameter('recordTypes', []) as string[];\n\n    if (!selectedEventTypes.includes(eventType)) {`,
    `    const selectedEventTypes = this.getNodeParameter('eventTypes') as string[];\n    const selectedSpaceId = String(this.getNodeParameter('spaceId', '')).trim();\n    const selectedRecordTypes = this.getNodeParameter('recordTypes', []) as string[];\n    const matchedRecordType = selectedRecordTypes.find((value) =>\n      decodeRecordTypeSelector(value).modelKey === String(bodyData.modelKey ?? ''),\n    );\n\n    if (!selectedEventTypes.includes(eventType)) {`,
    'trigger selected selectors',
  );

  source = replaceOnce(
    source,
    `      String(bodyData.spaceId ?? '') !== selectedSpaceId ||\n      !selectedRecordTypeKeys.includes(String(bodyData.modelKey ?? ''))\n    ) {`,
    `      String(bodyData.spaceId ?? '') !== selectedSpaceId ||\n      !matchedRecordType\n    ) {`,
    'trigger modelKey filter',
  );

  source = replaceOnce(
    source,
    `    return {\n      workflowData: [this.helpers.returnJsonArray(bodyData)],\n    };\n  }\n}`,
    `    return {\n      workflowData: [this.helpers.returnJsonArray({ ...bodyData, recordType: matchedRecordType })],\n    };\n  }\n}`,
    'trigger recordType output',
  );

  write(path, source);
}

// Progressive tests: selector round-trip, multiple model pairs, and zero-extra-Discovery Get.
{
  const path = 'test/progressive-discovery.test.mjs';
  let source = read(path);

  source = replaceOnce(
    source,
    `const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');\n\nconst BASE_URL`,
    `const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');\nconst { decodeRecordTypeSelector, encodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');\n\nconst TASK_RECORD_TYPE = encodeRecordTypeSelector('task', 'tasks');\nconst NOTE_RECORD_TYPE = encodeRecordTypeSelector('note', 'notes');\n\nconst BASE_URL`,
    'progressive selector helpers',
  );

  source = replaceAll(source, `modelRoute: 'tasks'`, `recordType: TASK_RECORD_TYPE`);
  source = replaceAll(source, `modelRoute: 'notes'`, `recordType: NOTE_RECORD_TYPE`);
  source = replaceOnce(
    source,
    `  assert.deepEqual(models.map((item) => item.value), ['tasks', 'notes']);`,
    `  assert.deepEqual(models.map((item) => decodeRecordTypeSelector(item.value)), [\n    { modelKey: 'task', route: 'tasks' },\n    { modelKey: 'note', route: 'notes' },\n  ]);`,
    'progressive selector options',
  );

  source = replaceOnce(
    source,
    `        if (options.url === \`\${BASE_URL}/spaces/spc_test/tasks\` && options.method === 'POST') {\n          return { data: { id: 'tsk_created', version: 1, ...options.body } };\n        }`,
    `        if (options.url === \`\${BASE_URL}/spaces/spc_test/tasks\` && options.method === 'POST') {\n          return { data: { id: 'tsk_created', version: 1, ...options.body } };\n        }\n        if (options.url === \`\${BASE_URL}/spaces/spc_test/tasks/rec_test\` && options.method === 'GET') {\n          return { data: { id: 'rec_test', version: 1, name: 'Direct selector Get' } };\n        }`,
    'progressive Get fixture',
  );

  source += `\n\ntest('Record Type selectors preserve model identity and REST route for multiple models', () => {\n  assert.deepEqual(decodeRecordTypeSelector(TASK_RECORD_TYPE), { modelKey: 'task', route: 'tasks' });\n  assert.deepEqual(decodeRecordTypeSelector(NOTE_RECORD_TYPE), { modelKey: 'note', route: 'notes' });\n});\n\ntest('Get decodes Record Type locally without a Discovery request', async () => {\n  const node = new LifeSpace();\n  const context = progressiveExecuteContext({\n    resource: 'modelRecord',\n    operation: 'get',\n    spaceId: 'spc_test',\n    recordType: TASK_RECORD_TYPE,\n    recordId: 'rec_test',\n  });\n\n  const result = await node.execute.call(context);\n  assert.equal(result[0][0].json.data.id, 'rec_test');\n  assert.deepEqual(context.calls.map((call) => [call.method, call.url]), [\n    ['GET', \`\${BASE_URL}/spaces/spc_test/tasks/rec_test\`],\n  ]);\n});\n`;

  write(path, source);
}

// Calendar tests use the same selector; Calendar Discovery behavior remains unchanged.
{
  const path = 'test/calendar-capability.test.mjs';
  let source = read(path);
  source = replaceOnce(
    source,
    `const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');\n\nconst BASE_URL`,
    `const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');\nconst { encodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');\n\nconst CALENDAR_RECORD_TYPE = encodeRecordTypeSelector('synthetic_calendar', 'synthetic-calendars');\n\nconst BASE_URL`,
    'calendar selector helper',
  );
  source = replaceAll(source, `modelRoute: 'synthetic-calendars'`, `recordType: CALENDAR_RECORD_TYPE`);
  write(path, source);
}

// Contract tests use selectors and prove Trigger -> Record composition without mapping or Discovery.
{
  const path = 'test/contract.test.mjs';
  let source = read(path);

  source = replaceOnce(
    source,
    `const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');\nconst { LifeSpaceTrigger } = require('../dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js');\n\nconst BASE_URL`,
    `const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');\nconst { LifeSpaceTrigger } = require('../dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js');\nconst { decodeRecordTypeSelector, encodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');\n\nconst TASK_RECORD_TYPE = encodeRecordTypeSelector('task', 'tasks');\nconst NOTE_RECORD_TYPE = encodeRecordTypeSelector('note', 'notes');\n\nconst BASE_URL`,
    'contract selector helpers',
  );

  source = replaceAll(source, `modelRoute: 'tasks'`, `recordType: TASK_RECORD_TYPE`);
  source = replaceAll(source, `modelRoute: 'notes'`, `recordType: NOTE_RECORD_TYPE`);
  source = replaceAll(source, `recordTypeKeys: ['task']`, `recordTypes: [TASK_RECORD_TYPE]`);
  source = replaceAll(source, `recordTypeKeys: ['note']`, `recordTypes: [NOTE_RECORD_TYPE]`);

  source = replaceOnce(
    source,
    `  assert.deepEqual(createRecordTypes.map((item) => item.value), ['tasks']);`,
    `  assert.deepEqual(createRecordTypes.map((item) => decodeRecordTypeSelector(item.value)), [\n    { modelKey: 'task', route: 'tasks' },\n  ]);`,
    'contract create record types',
  );
  source = replaceOnce(
    source,
    `  assert.deepEqual(listRecordTypes.map((item) => item.value), ['tasks', 'notes']);`,
    `  assert.deepEqual(listRecordTypes.map((item) => decodeRecordTypeSelector(item.value)), [\n    { modelKey: 'task', route: 'tasks' },\n    { modelKey: 'note', route: 'notes' },\n  ]);`,
    'contract list record types',
  );

  source = replaceOnce(
    source,
    `  assert.equal(state.statusCode, null);\n  assert.deepEqual(result.workflowData, [[{ json: body }]]);`,
    `  assert.equal(state.statusCode, null);\n  assert.deepEqual(result.workflowData, [[{ json: { ...body, recordType: TASK_RECORD_TYPE } }]]);`,
    'signed trigger output selector',
  );

  source += `\n\ntest('Trigger recordType output feeds Get directly without a model mapping or Discovery request', async () => {\n  const recordNode = new LifeSpace();\n  const context = executeContext(\n    {\n      resource: 'modelRecord',\n      operation: 'get',\n      spaceId: 'spc_test',\n      recordType: TASK_RECORD_TYPE,\n      recordId: 'rec_from_trigger',\n    },\n    (options) => {\n      assert.equal(options.url, \`\${BASE_URL}/spaces/spc_test/tasks/rec_from_trigger\`);\n      return { data: { id: 'rec_from_trigger', version: 1 } };\n    },\n  );\n\n  const result = await recordNode.execute.call(context);\n  assert.equal(result[0][0].json.data.id, 'rec_from_trigger');\n  assert.equal(context.calls.length, 1);\n});\n`;

  write(path, source);
}

// Source-level guardrails follow the new workflow-facing parameter names.
{
  const path = 'test/source-contract.test.mjs';
  let source = read(path);
  source = replaceAll(source, `'modelRoute'`, `'recordType'`);
  source = replaceAll(source, `'recordTypeKeys'`, `'recordTypes'`);
  source = replaceOnce(
    source,
    `  assert.match(discovery, /export async function loadRelationTargets/u);`,
    `  assert.match(discovery, /export async function loadRelationTargets/u);\n  assert.match(discovery, /export function encodeRecordTypeSelector/u);\n  assert.match(discovery, /export function decodeRecordTypeSelector/u);`,
    'source selector helpers',
  );
  source = replaceOnce(
    source,
    `  assert.match(trigger, /eventType === 'endpoint\\.test'/u);`,
    `  assert.match(trigger, /eventType === 'endpoint\\.test'/u);\n  assert.match(trigger, /recordType: matchedRecordType/u);`,
    'source trigger selector output',
  );
  write(path, source);
}

// Public docs: explain the adapter projection and zero-extra-request execution behavior.
{
  const path = 'README.md';
  let source = read(path);

  source = replaceOnce(
    source,
    `The node displays the authorized human-readable \`spaceName\` when present while continuing to submit the stable \`spc_*\` ID.`,
    `The node displays the authorized human-readable \`spaceName\` when present while continuing to submit the stable \`spc_*\` ID.\n\nRecord Type identity and REST routing remain distinct. LifeSpace \`modelKey\` is the stable semantic identity, while the Discovery \`route\` is a REST transport detail. The n8n adapter persists an adapter-local \`recordType\` selector containing both values when the workflow is configured. At execution time the selector is decoded locally, so Get/List/Delete do not add a Discovery request merely to translate \`modelKey\` to a REST route.`,
    'README record type projection',
  );

  source = replaceOnce(
    source,
    `{{$json.recordId}}\n{{$vars.lifeSpaceRecordType}}`,
    `{{$json.recordId}}\n{{$json.recordType}}\n{{$vars.lifeSpaceRecordType}}`,
    'README recordType expression example',
  );

  source = replaceOnce(
    source,
    `Discovery-backed selectors such as **Space**, **Record Type**, **Filter Field**, **Sort Field** and **Action** support the normal n8n pattern: choose a value from the list, or switch the parameter to an expression and provide the corresponding stable ID/key.`,
    `Discovery-backed selectors such as **Space**, **Filter Field**, **Sort Field** and **Action** support the normal n8n pattern: choose a value from the list, or switch the parameter to an expression and provide the corresponding stable ID/key. **Record Type** uses the adapter-local \`recordType\` selector so a LifeSpace Trigger can feed a Record node directly without a mapping step or an extra Discovery request.`,
    'README expression semantics',
  );

  source = replaceOnce(
    source,
    `The Trigger verifies \`X-LifeSpace-Timestamp\` and \`X-LifeSpace-Signature\` with the LifeSpace HMAC-SHA256 contract before emitting workflow data. \`endpoint.test\` payloads are always accepted after signature verification.`,
    `The Trigger verifies \`X-LifeSpace-Timestamp\` and \`X-LifeSpace-Signature\` with the LifeSpace HMAC-SHA256 contract before emitting workflow data. \`endpoint.test\` payloads are always accepted after signature verification.\n\nFor ordinary record events, the Trigger preserves the LifeSpace \`modelKey\` exactly as delivered and additionally emits the n8n adapter-local \`recordType\` selector for the matching configured Record Type. Pass \`{{$json.recordType}}\` and \`{{$json.recordId}}\` directly to a downstream LifeSpace Record node. The downstream node derives the REST route locally from that selector.`,
    'README Trigger composition',
  );

  write(path, source);
}

// Temporary patch machinery must not survive the implementation commit.
unlinkSync('scripts/apply-record-type-selector.mjs');
unlinkSync('.github/workflows/record-type-selector-bootstrap.yml');
