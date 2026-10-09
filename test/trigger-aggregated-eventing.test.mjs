import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceTrigger } = require('../dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js');
const { encodeRecordTypeSelector } = require('../dist/nodes/lifespaceDiscovery.js');

const TASK_RECORD_TYPE = encodeRecordTypeSelector('task');
const NOTE_RECORD_TYPE = encodeRecordTypeSelector('note');
const SIGNING_SECRET = 'a'.repeat(64);

function responseRecorder() {
  const state = { statusCode: null, body: null, ended: false };
  const response = {
    status(code) {
      state.statusCode = code;
      return response;
    },
    send(body) {
      state.body = body;
      return response;
    },
    end() {
      state.ended = true;
      return response;
    },
  };
  return { state, response };
}

async function deliver(body, parameters) {
  const node = new LifeSpaceTrigger();
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', SIGNING_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const { state, response } = responseRecorder();

  const result = await node.webhook.call({
    getRequestObject: () => ({ rawBody }),
    getHeaderData: () => ({
      'x-lifespace-timestamp': timestamp,
      'x-lifespace-signature': `v1=${signature}`,
    }),
    getResponseObject: () => response,
    getCredentials: async () => ({ signingSecret: SIGNING_SECRET }),
    getBodyData: () => body,
    getNodeParameter(name, defaultValue) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    helpers: {
      returnJsonArray: (value) => [{ json: value }],
    },
  });

  return { result, state };
}

test('LifeSpace Trigger unwraps bulk.completed into configured record events', async () => {
  const body = {
    id: 'blk_test',
    type: 'bulk.completed',
    bulkId: 'blk_test',
    spaceId: 'spc_test',
    occurredAt: '2026-10-10T00:00:00.000Z',
    events: [
      {
        id: 'evt_created_task',
        type: 'record.created',
        spaceId: 'spc_test',
        modelKey: 'task',
        recordId: 'rec_task',
        recordVersion: 1,
        changeId: 'chg_task',
        occurredAt: '2026-10-10T00:00:00.000Z',
      },
      {
        id: 'evt_updated_task',
        type: 'record.updated',
        spaceId: 'spc_test',
        modelKey: 'task',
        recordId: 'rec_task_old',
        recordVersion: 2,
        changeId: 'chg_task_old',
        occurredAt: '2026-10-10T00:00:00.000Z',
      },
      {
        id: 'evt_created_note',
        type: 'record.created',
        spaceId: 'spc_test',
        modelKey: 'note',
        recordId: 'rec_note',
        recordVersion: 1,
        changeId: 'chg_note',
        occurredAt: '2026-10-10T00:00:00.000Z',
      },
    ],
  };

  const { result, state } = await deliver(body, {
    eventTypes: ['record.created'],
    spaceId: 'spc_test',
    recordTypes: [TASK_RECORD_TYPE],
  });

  assert.equal(state.statusCode, null);
  assert.deepEqual(result.workflowData, [[{
    json: {
      ...body.events[0],
      bulkId: 'blk_test',
      recordType: TASK_RECORD_TYPE,
    },
  }]]);
});

test('LifeSpace Trigger unwraps change_set.committed and preserves changeSetId correlation', async () => {
  const body = {
    id: 'cgs_test',
    type: 'change_set.committed',
    changeSetId: 'cgs_test',
    spaceId: 'spc_test',
    occurredAt: '2026-10-10T00:00:00.000Z',
    events: [
      {
        id: 'evt_note_updated',
        type: 'record.updated',
        spaceId: 'spc_test',
        modelKey: 'note',
        recordId: 'rec_note',
        recordVersion: 3,
        changeId: 'chg_note',
        occurredAt: '2026-10-10T00:00:00.000Z',
      },
    ],
  };

  const { result, state } = await deliver(body, {
    eventTypes: ['record.updated'],
    spaceId: 'spc_test',
    recordTypes: [NOTE_RECORD_TYPE],
  });

  assert.equal(state.statusCode, null);
  assert.deepEqual(result.workflowData, [[{
    json: {
      ...body.events[0],
      changeSetId: 'cgs_test',
      recordType: NOTE_RECORD_TYPE,
    },
  }]]);
});

test('LifeSpace Trigger acknowledges an aggregate callback with no configured matching record events', async () => {
  const body = {
    id: 'blk_unmatched',
    type: 'bulk.completed',
    bulkId: 'blk_unmatched',
    spaceId: 'spc_test',
    occurredAt: '2026-10-10T00:00:00.000Z',
    events: [
      {
        id: 'evt_note_created',
        type: 'record.created',
        spaceId: 'spc_test',
        modelKey: 'note',
        recordId: 'rec_note',
        recordVersion: 1,
        changeId: 'chg_note',
        occurredAt: '2026-10-10T00:00:00.000Z',
      },
    ],
  };

  const { result, state } = await deliver(body, {
    eventTypes: ['record.created'],
    spaceId: 'spc_test',
    recordTypes: [TASK_RECORD_TYPE],
  });

  assert.deepEqual(result, { noWebhookResponse: true });
  assert.equal(state.statusCode, 204);
  assert.equal(state.ended, true);
});
