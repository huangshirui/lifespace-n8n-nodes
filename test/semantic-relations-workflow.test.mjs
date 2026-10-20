import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');

const BASE_URL = 'https://example.invalid/api/v1';

function property(node, name) {
  return node.description.properties.find((entry) => entry.name === name);
}

function executionContext(parameters, responder, { continueOnFail = false } = {}) {
  const calls = [];
  return {
    calls,
    getInputData: () => [{ json: {} }],
    getCredentials: async () => ({ baseUrl: `${BASE_URL}/` }),
    getNodeParameter(name, _index, fallback) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : fallback;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    continueOnFail: () => continueOnFail,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ credentialName, options });
        return responder(options, calls.length - 1);
      },
    },
  };
}

const base = {
  resource: 'semanticRelation',
  spaceId: 'spc_home',
};

test('Semantic Relation appears as a first-class Service-authority workflow resource', () => {
  const node = new LifeSpaceWorkflow();
  assert.deepEqual(node.description.credentials, [{ name: 'lifeSpaceApi', required: true }]);
  assert.deepEqual(property(node, 'resource').options.map((option) => option.value), [
    'modelRecord', 'person', 'semanticRelation', 'apiRequest',
  ]);
  assert.deepEqual(property(node, 'semanticRelationOperation').options.map((option) => option.value), [
    'create', 'delete', 'get', 'list',
  ]);
  assert.ok(property(node, 'spaceId').displayOptions.show.resource.includes('semanticRelation'));
  assert.equal(property(node, 'relationPredicate').displayOptions.show.semanticRelationOperation[0], 'create');
  assert.ok(property(node, 'relationQuerySourceRecordId').displayOptions.show.semanticRelationOperation.includes('list'));
});

test('Create uses one governed Core POST with directed record endpoints', async () => {
  const node = new LifeSpaceWorkflow();
  const context = executionContext({
    ...base,
    semanticRelationOperation: 'create',
    relationSourceModelKey: 'activity',
    relationSourceRecordId: 'rec_activity',
    relationPredicate: 'relates_to',
    relationTargetModelKey: 'task',
    relationTargetRecordId: 'rec_task',
  }, (options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_home/semantic-relations`);
    assert.deepEqual(options.body, {
      source: { kind: 'record', modelKey: 'activity', recordId: 'rec_activity' },
      predicate: 'relates_to',
      target: { kind: 'record', modelKey: 'task', recordId: 'rec_task' },
    });
    return { data: { id: 'rel_123', predicate: 'relates_to' } };
  });
  const [result] = await node.execute.call(context);
  assert.deepEqual(result, [{ json: { id: 'rel_123', predicate: 'relates_to' }, pairedItem: { item: 0 } }]);
  assert.equal(context.calls[0].credentialName, 'lifeSpaceApi');
  assert.equal(context.calls.length, 1);
});

test('List exposes source-directed filters, target hydration and the opaque pagination cursor', async () => {
  const node = new LifeSpaceWorkflow();
  const context = executionContext({
    ...base,
    semanticRelationOperation: 'list',
    relationQuerySourceModelKey: 'activity',
    relationQuerySourceRecordId: 'rec_activity',
    relationQueryPredicate: 'relates_to',
    relationHydrate: 'target',
    relationReturnAll: false,
    relationLimit: 7,
    relationCursor: 'opaque_cursor',
  }, (options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_home/semantic-relations`);
    assert.deepEqual(options.qs, {
      sourceModelKey: 'activity', sourceRecordId: 'rec_activity',
      predicate: 'relates_to', hydrate: 'target', limit: 7, cursor: 'opaque_cursor',
    });
    return { data: { items: [{ id: 'rel_1', targetLabel: '预订酒店' }], nextCursor: 'opaque_next' } };
  });
  const [result] = await node.execute.call(context);
  assert.deepEqual(result[0].json, {
    items: [{ id: 'rel_1', targetLabel: '预订酒店' }],
    nextCursor: 'opaque_next',
  });
});

test('List can filter by target for reverse traversal of directed edges', async () => {
  const node = new LifeSpaceWorkflow();
  const context = executionContext({
    ...base, semanticRelationOperation: 'list',
    relationQueryTargetModelKey: 'task', relationQueryTargetRecordId: 'rec_task',
  }, (options) => {
    assert.deepEqual(options.qs, { targetModelKey: 'task', targetRecordId: 'rec_task', limit: 50 });
    return { data: { items: [], nextCursor: null } };
  });
  const [output] = await node.execute.call(context);
  assert.deepEqual(output[0].json, { items: [], nextCursor: null });
});

test('Return All follows bounded pages and outputs each relation with paired item metadata', async () => {
  const node = new LifeSpaceWorkflow();
  const context = executionContext({
    ...base, semanticRelationOperation: 'list', relationReturnAll: true,
    relationQuerySourceModelKey: 'activity', relationQuerySourceRecordId: 'rec_a',
    relationCursor: 'should_be_ignored',
  }, (options, index) => {
    assert.equal(options.qs.limit, 100);
    if (index === 0) {
      assert.equal(options.qs.cursor, undefined);
      return { data: { items: [{ id: 'rel_a' }], nextCursor: 'next_page' } };
    }
    assert.equal(options.qs.cursor, 'next_page');
    return { data: { items: [{ id: 'rel_b' }], nextCursor: null } };
  });
  const [output] = await node.execute.call(context);
  assert.equal(context.calls.length, 2);
  assert.deepEqual(output, [
    { json: { id: 'rel_a' }, pairedItem: { item: 0 } },
    { json: { id: 'rel_b' }, pairedItem: { item: 0 } },
  ]);
});

test('Get hydrates visible endpoints; Delete returns success despite 204 empty body', async () => {
  const node = new LifeSpaceWorkflow();
  const get = executionContext({
    ...base, semanticRelationOperation: 'get', relationId: 'rel_test', relationHydrate: 'both',
  }, (options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_home/semantic-relations/rel_test`);
    assert.deepEqual(options.qs, { hydrate: 'both' });
    return { data: { id: 'rel_test', sourceLabel: 'Activity', targetLabel: 'Task' } };
  });
  const [read] = await node.execute.call(get);
  assert.deepEqual(read[0].json, { id: 'rel_test', sourceLabel: 'Activity', targetLabel: 'Task' });

  const del = executionContext({
    ...base, semanticRelationOperation: 'delete', relationId: 'rel_test',
  }, (options) => {
    assert.equal(options.method, 'DELETE');
    assert.equal(options.url, `${BASE_URL}/spaces/spc_home/semantic-relations/rel_test`);
    return undefined;
  });
  const [deleted] = await node.execute.call(del);
  assert.deepEqual(deleted[0].json, { id: 'rel_test', deleted: true });
});

test('Invalid or incomplete endpoint selectors fail locally without issuing an HTTP call', async () => {
  const node = new LifeSpaceWorkflow();
  const context = executionContext({
    ...base,
    semanticRelationOperation: 'list',
    relationQuerySourceModelKey: 'activity',
  }, () => { throw new Error('Unexpected API call'); });
  await assert.rejects(() => node.execute.call(context), /Source Model Key and Record ID must be supplied together/u);
  assert.equal(context.calls.length, 0);
});

test('Continue On Fail preserves paired item after a Core denial', async () => {
  const node = new LifeSpaceWorkflow();
  const context = executionContext({
    ...base, semanticRelationOperation: 'get', relationId: 'rel_denied',
  }, () => { throw new Error('Core denied access'); }, { continueOnFail: true });
  const [output] = await node.execute.call(context);
  assert.deepEqual(output, [{ json: { error: 'Core denied access' }, pairedItem: { item: 0 } }]);
});
