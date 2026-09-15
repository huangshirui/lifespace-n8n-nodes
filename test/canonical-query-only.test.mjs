import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');
const { encodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');

const BASE_URL = 'https://example.invalid/api/v1';

function context(parameters) {
  const calls = [];
  return {
    calls,
    getInputData: () => [{ json: {} }],
    getCredentials: async () => ({ baseUrl: BASE_URL }),
    getNodeParameter(name, _itemIndex, fallback) {
      return Object.hasOwn(parameters, name) ? parameters[name] : fallback;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        calls.push(options);
        return { data: { items: [], nextCursor: null } };
      },
    },
  };
}

test('published Workflow ignores stored legacy capability mode and always uses Canonical Query POST', async () => {
  const node = new LifeSpaceWorkflow();
  const execution = context({
    resource: 'modelRecord',
    operation: 'list',
    spaceId: 'spc_test',
    recordType: encodeRecordTypeSelector('task'),
    queryMode: 'capability',
    semanticQueryKey: 'calendar.window',
    semanticQueryInput: { value: { windowStartDate: '2026-09-15' } },
    semanticSort: 'calendarStart:asc',
    returnAll: false,
    limit: 10,
    search: '',
    options: {},
    'queryFilters.value': {},
    'queryTimeWindows.window': [],
    'sorts.sort': [],
  });

  await node.execute.call(execution);
  assert.equal(execution.calls.length, 1);
  assert.equal(execution.calls[0].method, 'POST');
  assert.equal(execution.calls[0].url, `${BASE_URL}/spaces/spc_test/models/task/records/query`);
  assert.deepEqual(execution.calls[0].body, { page: { limit: 10 } });
  assert.equal(execution.calls[0].qs, undefined);
});

test('published Agent Tool source no longer falls back to Capability Query for stored legacy mode', async () => {
  const source = await readFile(new URL('../nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /storedQueryMode/u);
  assert.doesNotMatch(source, /storedQueryMode === 'capability'/u);
  assert.match(source, /if \(operation !== 'query'\)/u);
  assert.match(source, /compileGenericQuery\(model, input\)/u);
});
