import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceWorkflow } = require('../dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js');
const { uploadableFields } = require('../dist/nodes/LifeSpaceWorkflow/fileUpload.js');
const { buildAgentToolDefinition } = require('../dist/nodes/agent/lifeSpaceToolFactory.js');

function property(node, name) {
  return node.description.properties.find((entry) => entry.name === name);
}

function model(fields) {
  return {
    key: 'document',
    version: 1,
    schemaHash: 'sha_test',
    display: { singular: 'Document', plural: 'Documents' },
    description: null,
    access: ['read', 'write'],
    fields,
    defaults: {},
    query: {
      searchable: [], filterable: [], sortable: [], search: null, filters: [], comparisons: [], capabilityQueries: [],
      sort: { parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8, default: [], envelopeFields: [], nullPlacement: 'last', genericValues: [] },
      pagination: { limit: { parameter: 'limit', minimum: 1, maximum: 100, default: 100 }, cursor: { parameter: 'cursor', type: 'string' } },
    },
    actions: [],
    capabilities: [],
    capabilityBindings: {},
  };
}

test('Workflow exposes one unified Upload File operation', () => {
  const node = new LifeSpaceWorkflow();
  const operation = property(node, 'operation');
  assert.ok(operation.options.some((option) => option.value === 'uploadFile'));
  assert.deepEqual(property(node, 'uploadField').displayOptions.show.operation, ['uploadFile']);
  assert.equal(property(node, 'uploadBinaryProperty').default, 'data');
});

test('upload field selection is contract-driven for Native and External fields', () => {
  const selected = uploadableFields(model([
    { key: 'cover', type: 'file', nullable: false, readOnly: false },
    { key: 'attachments', type: 'file_list', nullable: false, readOnly: false },
    { key: 'systemFile', type: 'file', nullable: false, readOnly: true },
    { key: 'providerFiles', type: 'file_ref_list', nullable: true, readOnly: true, upload: { supported: true, maxBytes: 20 } },
    { key: 'readOnlyProviderFiles', type: 'file_ref_list', nullable: true, readOnly: true },
  ]));
  assert.deepEqual(selected.map((field) => field.key), ['cover', 'attachments', 'providerFiles']);
});

test('Agent Tool accepts stable Native File references but not binary payloads', () => {
  const definition = buildAgentToolDefinition(model([
    { key: 'cover', title: 'Cover', type: 'file', nullable: false, readOnly: false },
    { key: 'attachments', title: 'Attachments', type: 'file_list', nullable: false, readOnly: false },
  ]), { spaceId: 'spc_test', operation: 'create' });
  assert.equal(definition.schema.properties.cover.pattern, '^fil_[a-f0-9]{32}$');
  assert.equal(definition.schema.properties.attachments.type, 'array');
  assert.equal(definition.schema.properties.attachments.items.pattern, '^fil_[a-f0-9]{32}$');
});

test('Workflow upload uses authenticated Core calls but never forwards Authorization to presigned R2', async () => {
  const node = new LifeSpaceWorkflow();
  const coreCalls = [];
  const rawCalls = [];
  const parameters = {
    resource: 'modelRecord',
    operation: 'uploadFile',
    spaceId: 'spc_test',
    recordType: 'document',
    uploadField: 'attachments',
    uploadRecordId: 'rec_test',
    uploadBinaryProperty: 'data',
    uploadFileName: '',
    uploadContentType: '',
  };
  const context = {
    getInputData: () => [{ json: {}, binary: { data: { data: 'opaque', mimeType: 'text/plain', fileName: 'note.txt' } } }],
    getNodeParameter: (name, _itemIndex, fallback) => Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : fallback,
    getCredentials: async () => ({ baseUrl: 'https://core.example.test/api/v1', token: 'secret' }),
    getNode: () => ({ name: 'LifeSpace' }),
    continueOnFail: () => false,
    helpers: {
      assertBinaryData: () => ({ data: 'opaque', mimeType: 'text/plain', fileName: 'note.txt' }),
      getBinaryDataBuffer: async () => Buffer.from('hello'),
      httpRequestWithAuthentication: async (_credential, options) => {
        coreCalls.push(options);
        if (options.url.endsWith('/file-uploads')) {
          return {
            data: {
              id: 'upl_' + 'a'.repeat(32),
              destination: 'native',
              upload: {
                method: 'PUT',
                url: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/bucket/object?X-Amz-Signature=test',
                headers: { 'content-type': 'text/plain' },
                expiresAt: '2026-10-17T16:15:00Z',
              },
            },
          };
        }
        return { data: { id: 'fil_' + 'b'.repeat(32), name: 'note.txt', contentType: 'text/plain', size: 5 } };
      },
      httpRequest: async (options) => {
        rawCalls.push(options);
        return '';
      },
    },
  };

  const output = await node.execute.call(context);
  assert.equal(coreCalls.length, 2);
  assert.equal(rawCalls.length, 1);
  assert.equal(coreCalls[0].body.size, 5);
  assert.equal(coreCalls[0].body.name, 'note.txt');
  assert.equal(coreCalls[0].body.recordId, 'rec_test');
  assert.equal(rawCalls[0].method, 'PUT');
  assert.deepEqual(rawCalls[0].headers, { 'content-type': 'text/plain' });
  assert.equal(rawCalls[0].headers.Authorization, undefined);
  assert.ok(Buffer.isBuffer(rawCalls[0].body));
  assert.equal(output[0][0].json.id, 'fil_' + 'b'.repeat(32));
});
