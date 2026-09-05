from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = ROOT / "nodes" / "LifeSpace" / "LifeSpace.node.ts"
TEST = ROOT / "test" / "contract.test.mjs"

node = NODE.read_text(encoding="utf-8")

def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new)

node = replace_once(
    node,
    "  loadExecutionRuntimeDiscovery,\n  loadRuntimeDiscovery,\n  normalizeBaseUrl,\n",
    "  loadExecutionRuntimeDiscovery,\n  loadRelationTargets,\n  loadRuntimeDiscovery,\n  normalizeBaseUrl,\n",
    "import loadRelationTargets",
)
node = replace_once(
    node,
    "  type DiscoveryModel,\n} from '../lifespaceDiscovery';\n",
    "  type DiscoveryModel,\n  type RelationTarget,\n} from '../lifespaceDiscovery';\n",
    "import RelationTarget",
)
node = replace_once(
    node,
    "function mapperField(field: DiscoveryField, required: boolean) {\n  return {\n    id: field.key,\n    displayName: field.title?.trim() || humanizeKey(field.key),\n    required,\n    defaultMatch: false,\n    canBeUsedToMatch: false,\n    display: true,\n    type: resourceMapperType(field),\n    options: field.type === 'enum'\n      ? (field.values ?? []).map((value) => ({ name: value, value }))\n      : undefined,\n  };\n}\n",
    "function mapperField(field: DiscoveryField, required: boolean, relationTargets?: RelationTarget[]) {\n"
    "  const relationOptions = relationTargets?.map((target) => ({ name: target.label, value: target.id }));\n"
    "  return {\n"
    "    id: field.key,\n"
    "    displayName: field.title?.trim() || humanizeKey(field.key),\n"
    "    required,\n"
    "    defaultMatch: false,\n"
    "    canBeUsedToMatch: false,\n"
    "    display: true,\n"
    "    type: relationTargets !== undefined && field.type === 'person' ? 'options' : resourceMapperType(field),\n"
    "    options: relationTargets !== undefined\n"
    "      ? relationOptions\n"
    "      : field.type === 'enum'\n"
    "        ? (field.values ?? []).map((value) => ({ name: value, value }))\n"
    "        : undefined,\n"
    "  };\n"
    "}\n",
    "mapperField",
)
node = replace_once(
    node,
    "        const fields = model.fields\n"
    "          .filter((field) => !field.readOnly && (operation !== 'update' || !field.immutable))\n"
    "          .map((field) => mapperField(\n"
    "            field,\n"
    "            operation === 'create' && field.required === true && !hasServerDefault(model, field.key),\n"
    "          ));\n\n"
    "        return { fields };\n",
    "        const writableFields = model.fields\n"
    "          .filter((field) => !field.readOnly && (operation !== 'update' || !field.immutable));\n"
    "        const fields = await Promise.all(writableFields.map(async (field) => {\n"
    "          const relationTargets = await loadRelationTargets(this, spaceId, model.key, field);\n"
    "          return mapperField(\n"
    "            field,\n"
    "            operation === 'create' && field.required === true && !hasServerDefault(model, field.key),\n"
    "            relationTargets ?? undefined,\n"
    "          );\n"
    "        }));\n\n"
    "        return { fields };\n",
    "getRecordFields mapping",
)
NODE.write_text(node, encoding="utf-8")

test = TEST.read_text(encoding="utf-8")
addition = r'''

test('LifeSpace 0.23 Person relations render canonical target labels instead of raw IDs', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture();
  const task = discovery.data.spaces[0].models[0];
  const lookup = {
    supported: true,
    method: 'GET',
    pathTemplate: '/api/v1/spaces/{spaceId}/_relation-targets/{modelKey}/{fieldKey}',
    searchParameter: 'q',
    cursorParameter: 'cursor',
    limitParameter: 'limit',
  };
  task.fields.push(
    {
      key: 'ownerPersonId',
      type: 'person',
      title: 'Owner',
      relation: { targetModel: 'person', cardinality: 'one', lookup },
    },
    {
      key: 'assigneePersonIds',
      type: 'person_list',
      title: 'Assignees',
      relation: { targetModel: 'person', cardinality: 'many', lookup },
    },
    {
      key: 'parentTaskId',
      type: 'record',
      title: 'Parent Task',
      targetModel: 'task',
      relation: {
        targetModel: 'task',
        cardinality: 'one',
        lookup: { supported: false, reason: 'reference-label-unavailable' },
      },
    },
  );

  const calls = [];
  const context = loadOptionsContext(discovery, {
    spaceId: 'spc_test',
    modelRoute: 'tasks',
    operation: 'create',
  });
  context.helpers = {
    async httpRequestWithAuthentication(_credentialName, options) {
      calls.push(options);
      if (options.url === `${BASE_URL}/me/_discovery`) return discovery;
      assert.equal(options.method, 'GET');
      assert.match(options.url, new RegExp(`${BASE_URL}/spaces/spc_test/_relation-targets/task/(ownerPersonId|assigneePersonIds)$`));
      assert.deepEqual(options.qs, { limit: 100 });
      return {
        data: {
          items: [
            { id: 'per_alpha', label: 'Alpha Person' },
            { id: 'per_beta', label: 'Beta Person' },
          ],
          nextCursor: null,
        },
      };
    },
  };

  const fields = await node.methods.resourceMapping.getRecordFields.call(context);
  const owner = fields.fields.find((field) => field.id === 'ownerPersonId');
  const assignees = fields.fields.find((field) => field.id === 'assigneePersonIds');
  const parent = fields.fields.find((field) => field.id === 'parentTaskId');

  assert.equal(owner.type, 'options');
  assert.deepEqual(owner.options, [
    { name: 'Alpha Person', value: 'per_alpha' },
    { name: 'Beta Person', value: 'per_beta' },
  ]);
  assert.equal(assignees.type, 'array');
  assert.deepEqual(assignees.options, owner.options);
  assert.equal(parent.type, 'string');
  assert.equal(parent.options, undefined);
  assert.equal(calls.filter((call) => call.url.includes('/_relation-targets/')).length, 2);
});

test('Person relation fields keep raw-ID fallback when Runtime Discovery has no lookup contract', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture();
  discovery.data.spaces[0].models[0].fields.push({
    key: 'assigneePersonIds',
    type: 'person_list',
    title: 'Assignees',
  });

  const fields = await node.methods.resourceMapping.getRecordFields.call(
    loadOptionsContext(discovery, { spaceId: 'spc_test', modelRoute: 'tasks', operation: 'create' }),
  );
  const assignees = fields.fields.find((field) => field.id === 'assigneePersonIds');
  assert.equal(assignees.type, 'array');
  assert.equal(assignees.options, undefined);
});

test('Create preserves selected LifeSpace Person IDs in the resource payload', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'create',
      spaceId: 'spc_test',
      modelRoute: 'tasks',
      'fields.value': {
        name: 'Shared task',
        assigneePersonIds: ['per_alpha', 'per_beta'],
      },
    },
    () => ({ data: { id: 'tsk_created', version: 1 } }),
  );

  await node.execute.call(context);
  assert.deepEqual(context.calls[0].options.body, {
    name: 'Shared task',
    assigneePersonIds: ['per_alpha', 'per_beta'],
  });
});
'''
if "LifeSpace 0.23 Person relations render canonical target labels" in test:
    raise RuntimeError("0.23 relation selector tests already present")
TEST.write_text(test.rstrip() + addition + "\n", encoding="utf-8")
