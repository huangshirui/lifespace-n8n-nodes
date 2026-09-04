from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8").replace("\r\n", "\n")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"{label}: anchor not found")
    return text.replace(old, new, 1)


# nodes/LifeSpace/LifeSpace.node.ts
path = "nodes/LifeSpace/LifeSpace.node.ts"
text = read(path)

text = replace_once(
    text,
    """type QueryFilter = {
  field?: string;
  operator?: 'exact' | 'from' | 'to';
  value?: string;
};

type QueryPage = {""",
    """type QueryFilter = {
  field?: string;
  operator?: 'exact' | 'from' | 'to';
  value?: string;
};

type QuerySort = {
  field?: string;
  direction?: 'asc' | 'desc';
};

type QueryPage = {""",
    "QuerySort",
)

text = replace_once(
    text,
    """  const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const sortField = String(options.sortField ?? '').trim();
  const sortDirection = String(options.sortDirection ?? 'desc').trim();
  const configuredCursor = String(options.cursor ?? '').trim();
  const cursor = cursorOverride ?? configuredCursor;
  const filters = context.getNodeParameter('filters.filter', itemIndex, []) as QueryFilter[];

  if (search) qs.q = search;
  if (sortField) qs.sort = `${sortField}:${sortDirection}`;
  qs.limit = limit;""",
    """  const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const configuredSorts = context.getNodeParameter('sorts.sort', itemIndex, []) as QuerySort[];
  const legacySortField = String(options.sortField ?? '').trim();
  const legacySortDirection = String(options.sortDirection ?? 'desc').trim();
  const configuredCursor = String(options.cursor ?? '').trim();
  const cursor = cursorOverride ?? configuredCursor;
  const filters = context.getNodeParameter('filters.filter', itemIndex, []) as QueryFilter[];

  if (search) qs.q = search;

  const orderedSorts: string[] = [];
  const usedSortFields = new Set<string>();
  for (const sort of configuredSorts) {
    const field = String(sort.field ?? '').trim();
    if (!field) continue;
    const direction = String(sort.direction ?? 'asc').trim();
    if (direction !== 'asc' && direction !== 'desc') {
      throw new NodeOperationError(context.getNode(), `Sort direction for ${field} must be asc or desc`, { itemIndex });
    }
    if (usedSortFields.has(field)) {
      throw new NodeOperationError(context.getNode(), `Sort field ${field} may be supplied only once`, { itemIndex });
    }
    usedSortFields.add(field);
    orderedSorts.push(`${field}:${direction}`);
  }

  if (orderedSorts.length === 1) qs.sort = orderedSorts[0];
  if (orderedSorts.length > 1) qs.sort = orderedSorts;
  if (orderedSorts.length === 0 && legacySortField) qs.sort = `${legacySortField}:${legacySortDirection}`;
  qs.limit = limit;""",
    "queryParameters",
)

text = replace_once(
    text,
    "    displayName: humanizeKey(field.key),",
    "    displayName: field.title?.trim() || humanizeKey(field.key),",
    "resource mapper title",
)

limit_at = text.index("        displayName: 'Limit',")
options_start = text.index("      {\n        displayName: 'Options',", limit_at)
concurrency_start = text.index("      {\n        displayName: 'Concurrency Options',", options_start)
sort_ui = """      {
        displayName: 'Sorts',
        name: 'sorts',
        type: 'fixedCollection',
        default: {},
        placeholder: 'Add Sort',
        typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        options: [
          {
            displayName: 'Sort',
            name: 'sort',
            values: [
              {
                displayName: 'Field Name or ID',
                name: 'field',
                type: 'options',
                typeOptions: { loadOptionsMethod: 'getSortableFields' },
                options: [],
                default: '',
                required: true,
                description: 'Choose from the sortable fields advertised by LifeSpace Runtime Discovery',
              },
              {
                displayName: 'Direction',
                name: 'direction',
                type: 'options',
                options: [
                  { name: 'Ascending', value: 'asc' },
                  { name: 'Descending', value: 'desc' },
                ],
                default: 'asc',
              },
            ],
          },
        ],
        description: 'Add sort criteria in priority order. If omitted, LifeSpace applies the server-declared default order.',
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        options: [
          {
            displayName: 'Cursor',
            name: 'cursor',
            type: 'string',
            default: '',
            description: 'Advanced manual pagination. Normally leave empty and use Return All or Limit.',
          },
        ],
      },
"""
text = text[:options_start] + sort_ui + text[concurrency_start:]

text = replace_once(
    text,
    "            name: humanizeKey(fieldKey),",
    "            name: field?.title?.trim() || humanizeKey(fieldKey),",
    "filter title",
)

text = replace_once(
    text,
    """        return [
          { name: 'Created At', value: 'createdAt' },
          { name: 'Updated At', value: 'updatedAt' },
          ...model.query.sortable.map((fieldKey) => ({ name: humanizeKey(fieldKey), value: fieldKey })),
        ];""",
    """        return [
          ...model.query.sort.envelopeFields.map((fieldKey) => ({
            name: humanizeKey(fieldKey),
            value: fieldKey,
          })),
          ...model.query.sortable.map((fieldKey) => {
            const field = model.fields.find((entry) => entry.key === fieldKey);
            return { name: field?.title?.trim() || humanizeKey(fieldKey), value: fieldKey };
          }),
        ];""",
    "sortable discovery metadata",
)

text = replace_once(
    text,
    """              const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
              response = await this.helpers.httpRequestWithAuthentication.call(
                this,
                'lifeSpaceApi',
                {
                  method: 'GET',
                  url: `${baseUrl}${collectionPath}`,
                  qs: queryParameters(this, itemIndex, limit),
                  json: true,
                },
              );""",
    """              const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
              const qs = queryParameters(this, itemIndex, limit);
              const requestOptions: IHttpRequestOptions = {
                method: 'GET',
                url: `${baseUrl}${collectionPath}`,
                qs,
                json: true,
              };
              if (Array.isArray(qs.sort)) requestOptions.arrayFormat = 'repeat';
              response = await this.helpers.httpRequestWithAuthentication.call(
                this,
                'lifeSpaceApi',
                requestOptions,
              );""",
    "single-page query request",
)

text = replace_once(
    text,
    """              do {
                const pageResponse = await this.helpers.httpRequestWithAuthentication.call(
                  this,
                  'lifeSpaceApi',
                  {
                    method: 'GET',
                    url: `${baseUrl}${collectionPath}`,
                    qs: queryParameters(this, itemIndex, 200, cursor),
                    json: true,
                  },
                );""",
    """              do {
                const qs = queryParameters(this, itemIndex, 200, cursor);
                const requestOptions: IHttpRequestOptions = {
                  method: 'GET',
                  url: `${baseUrl}${collectionPath}`,
                  qs,
                  json: true,
                };
                if (Array.isArray(qs.sort)) requestOptions.arrayFormat = 'repeat';
                const pageResponse = await this.helpers.httpRequestWithAuthentication.call(
                  this,
                  'lifeSpaceApi',
                  requestOptions,
                );""",
    "return-all query request",
)
write(path, text)

# test/contract.test.mjs — append focused 0.22 coverage while preserving all 0.21 regression fixtures.
path = "test/contract.test.mjs"
text = read(path)
anchor = "test('Update fetches current version by default and sends it with the mutation', async () => {"
if anchor not in text:
    raise RuntimeError("contract test insertion anchor not found")
new_tests = r"""test('LifeSpace 0.22 field titles and sortable envelope metadata drive generated labels', async () => {
  const node = new LifeSpace();
  const discovery = discoveryFixture();
  const task = discovery.data.spaces[0].models[0];
  task.fields.find((field) => field.key === 'name').title = 'Task Name';
  task.fields.find((field) => field.key === 'dueDate').title = 'Due Date';
  task.query.sortable = ['dueDate', 'name'];
  task.query.sort = {
    parameter: 'sort',
    syntax: 'field:direction',
    repeatable: true,
    ordered: true,
    maxCriteria: 8,
    default: ['createdAt:desc'],
    envelopeFields: ['createdAt', 'updatedAt'],
  };

  const fields = await node.methods.resourceMapping.getRecordFields.call(
    loadOptionsContext(discovery, { spaceId: 'spc_test', modelRoute: 'tasks', operation: 'create' }),
  );
  assert.equal(fields.fields.find((field) => field.id === 'name').displayName, 'Task Name');

  const sorts = await node.methods.loadOptions.getSortableFields.call(
    loadOptionsContext(discovery, { spaceId: 'spc_test', modelRoute: 'tasks' }),
  );
  assert.deepEqual(sorts.map((item) => [item.name, item.value]), [
    ['Created At', 'createdAt'],
    ['Updated At', 'updatedAt'],
    ['Due Date', 'dueDate'],
    ['Task Name', 'name'],
  ]);
});

test('List sends ordered LifeSpace 0.22 multi-sort as repeated query parameters', async () => {
  const node = new LifeSpace();
  const context = executeContext(
    {
      resource: 'modelRecord',
      operation: 'list',
      spaceId: 'spc_test',
      modelRoute: 'tasks',
      search: '',
      returnAll: false,
      limit: 25,
      sorts: { sort: [
        { field: 'dueDate', direction: 'asc' },
        { field: 'name', direction: 'desc' },
      ] },
      options: {},
      'filters.filter': [],
    },
    () => ({ data: { items: [], nextCursor: null } }),
  );

  await node.execute.call(context);
  assert.deepEqual(context.calls[0].options.qs.sort, ['dueDate:asc', 'name:desc']);
  assert.equal(context.calls[0].options.arrayFormat, 'repeat');
});

"""
text = text.replace(anchor, new_tests + anchor, 1)
write(path, text)

# test/source-contract.test.mjs
path = "test/source-contract.test.mjs"
text = read(path)
text = replace_once(
    text,
    "  assert.match(discovery, /defaults: Record<string, unknown>/u);",
    "  assert.match(discovery, /defaults: Record<string, unknown>/u);\n  assert.match(discovery, /title\\?: string/u);\n  assert.match(discovery, /repeatable: true/u);\n  assert.match(discovery, /envelopeFields: string\\[\\]/u);",
    "source discovery 0.22",
)
text = replace_once(
    text,
    "  assert.match(node, /displayName: 'Return All'/u);",
    "  assert.match(node, /displayName: 'Return All'/u);\n  assert.match(node, /name: 'sorts'/u);\n  assert.match(node, /field\\.title\\?\\.trim\\(\\) \\|\\| humanizeKey/u);",
    "source node 0.22",
)
write(path, text)

# README.md
path = "README.md"
text = read(path)
text = replace_once(
    text,
    "This package follows the current LifeSpace Core Kernel `0.21.0` contract family.",
    "This package follows the current LifeSpace Core Kernel `0.22.0` contract family.",
    "README baseline",
)
text = replace_once(
    text,
    "- `0.21.0`: current Kernel baseline consumed during this convergence pass.",
    "- `0.21.0`: invitation-token transport hardening retained by the current baseline;\n- `0.22.0`: authoritative field `title` metadata plus ordered repeatable Generic Query sort metadata.",
    "README versions",
)
text = replace_once(
    text,
    """Advanced **Options** contain:

- optional **Sort Field** and **Sort Direction**;
- manual **Cursor** as an escape hatch.

If Sort is omitted, the adapter omits the query parameter and LifeSpace supplies its deterministic default order. Ordered multi-field sort is not emulated in the adapter; it will be exposed only when the LifeSpace Generic Query contract supports it.""",
    """Use **Sorts → Add Sort** to add zero or more sort criteria in priority order. Sortable model fields use authoritative `title` metadata from Runtime Discovery, while envelope fields such as `createdAt` / `updatedAt` are offered only when Discovery advertises them. Multiple criteria are sent as ordered repeated `sort=field:direction` query parameters.

Advanced **Options** contain manual **Cursor** as an escape hatch.

If Sorts is omitted, the adapter omits the query parameter and LifeSpace supplies its deterministic default order. Existing workflow exports that still contain the former single `options.sortField` / `options.sortDirection` parameters remain executable for compatibility.""",
    "README list query",
)
text = replace_once(
    text,
    """- ordered multi-field sort after LifeSpace Generic Query supports it;
- canonical field labels after LifeSpace exposes them in Model semantics / Runtime Discovery;
- richer relation selectors when LifeSpace exposes an authorized generic lookup surface appropriate for generated clients.""",
    "- richer relation selectors when LifeSpace exposes an authorized generic lookup surface appropriate for generated clients.",
    "README remaining upstream",
)
write(path, text)
