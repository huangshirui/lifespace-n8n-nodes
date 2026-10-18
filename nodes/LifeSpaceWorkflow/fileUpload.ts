import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
  decodeRecordTypeSelector,
  discoveryModel,
  humanizeKey,
  loadOptionParameter,
  loadRuntimeDiscovery,
  normalizeBaseUrl,
  type DiscoveryField,
  type DiscoveryModel,
} from '../lifespaceDiscovery';

type UploadSessionData = {
  id: string;
  destination: 'native' | 'external';
  upload: {
    method: 'PUT';
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  };
};

function objectData(
  context: IExecuteFunctions,
  itemIndex: number,
  response: unknown,
  label: string,
): IDataObject {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new NodeOperationError(context.getNode(), `${label} returned an invalid response`, { itemIndex });
  }
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new NodeOperationError(context.getNode(), `${label} response is missing data`, { itemIndex });
  }
  return data as IDataObject;
}

function sessionData(
  context: IExecuteFunctions,
  itemIndex: number,
  response: unknown,
): UploadSessionData {
  const data = objectData(context, itemIndex, response, 'LifeSpace upload session');
  const upload = data.upload;
  if (
    typeof data.id !== 'string'
    || !/^upl_[a-f0-9]{32}$/u.test(data.id)
    || (data.destination !== 'native' && data.destination !== 'external')
    || !upload
    || typeof upload !== 'object'
    || Array.isArray(upload)
  ) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace upload session contract is invalid', { itemIndex });
  }
  const transport = upload as Record<string, unknown>;
  if (
    transport.method !== 'PUT'
    || typeof transport.url !== 'string'
    || !/^https:\/\//u.test(transport.url)
    || !transport.headers
    || typeof transport.headers !== 'object'
    || Array.isArray(transport.headers)
    || typeof transport.expiresAt !== 'string'
  ) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace upload transport contract is invalid', { itemIndex });
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(transport.headers as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new NodeOperationError(context.getNode(), 'LifeSpace upload transport headers are invalid', { itemIndex });
    }
    headers[key] = value;
  }
  return {
    id: data.id,
    destination: data.destination,
    upload: {
      method: 'PUT',
      url: transport.url,
      headers,
      expiresAt: transport.expiresAt,
    },
  };
}

export function uploadableFields(model: DiscoveryModel): DiscoveryField[] {
  return model.fields.filter((field) => (
    ((field.type === 'file' || field.type === 'file_list') && field.readOnly !== true)
    || (field.type === 'file_ref_list' && field.upload?.supported === true)
  ));
}

export async function getUploadFields(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  const spaceId = loadOptionParameter(this, 'spaceId');
  const selector = decodeRecordTypeSelector(loadOptionParameter(this, 'recordType'));
  if (!spaceId || !selector) return [];
  const discovery = await loadRuntimeDiscovery.call(this);
  const model = discoveryModel(discovery, spaceId, selector.modelKey);
  if (!model) return [];
  return uploadableFields(model).map((field) => ({
    name: field.title?.trim() || humanizeKey(field.key),
    value: field.key,
    description: field.upload?.supported
      ? `${field.type} · upload capability · max ${field.upload.maxBytes} bytes`
      : `${field.type} · LifeSpace File upload`,
  }));
}

export async function executeFileUploadWorkflow(
  context: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
  const input = context.getInputData();
  const output: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < input.length; itemIndex += 1) {
    try {
      const spaceId = String(context.getNodeParameter('spaceId', itemIndex, '') ?? '').trim();
      if (!/^spc_[A-Za-z0-9_-]+$/u.test(spaceId)) {
        throw new NodeOperationError(context.getNode(), 'Space must resolve to a valid spc_* identifier', { itemIndex });
      }
      const selector = decodeRecordTypeSelector(context.getNodeParameter('recordType', itemIndex, ''));
      if (!selector) {
        throw new NodeOperationError(context.getNode(), 'Record Type must be selected from LifeSpace Runtime Discovery', { itemIndex });
      }
      const fieldKey = String(context.getNodeParameter('uploadField', itemIndex, '') ?? '').trim();
      if (!fieldKey) {
        throw new NodeOperationError(context.getNode(), 'Upload Field is required', { itemIndex });
      }
      const binaryProperty = String(context.getNodeParameter('uploadBinaryProperty', itemIndex, 'data') ?? 'data').trim();
      if (!binaryProperty) {
        throw new NodeOperationError(context.getNode(), 'Input Binary Field is required', { itemIndex });
      }
      const binary = context.helpers.assertBinaryData(itemIndex, binaryProperty);
      const bytes = await context.helpers.getBinaryDataBuffer(itemIndex, binaryProperty);
      if (!bytes.length) {
        throw new NodeOperationError(context.getNode(), 'Input binary file is empty', { itemIndex });
      }
      const configuredName = String(context.getNodeParameter('uploadFileName', itemIndex, '') ?? '').trim();
      const name = configuredName || String(binary.fileName ?? '').trim() || `${binaryProperty}.bin`;
      const configuredContentType = String(context.getNodeParameter('uploadContentType', itemIndex, '') ?? '').trim();
      const contentType = configuredContentType || String(binary.mimeType ?? '').trim() || 'application/octet-stream';
      const recordId = String(context.getNodeParameter('uploadRecordId', itemIndex, '') ?? '').trim();

      const credentials = await context.getCredentials('lifeSpaceApi', itemIndex);
      const baseUrl = normalizeBaseUrl(credentials.baseUrl);
      const createResponse = await context.helpers.httpRequestWithAuthentication.call(
        context,
        'lifeSpaceApi',
        {
          method: 'POST',
          url: `${baseUrl}/spaces/${encodeURIComponent(spaceId)}/file-uploads`,
          body: {
            modelKey: selector.modelKey,
            fieldKey,
            ...(recordId ? { recordId } : {}),
            name,
            contentType,
            size: bytes.length,
          },
          json: true,
        },
      );
      const session = sessionData(context, itemIndex, createResponse);

      // The presigned R2 URL is the authorization for this one object. Never forward
      // the LifeSpace Service credential to R2.
      await context.helpers.httpRequest.call(context, {
        method: session.upload.method,
        url: session.upload.url,
        headers: session.upload.headers,
        body: bytes,
        json: false,
      });

      const completeResponse = await context.helpers.httpRequestWithAuthentication.call(
        context,
        'lifeSpaceApi',
        {
          method: 'POST',
          url: `${baseUrl}/spaces/${encodeURIComponent(spaceId)}/file-uploads/${encodeURIComponent(session.id)}/complete`,
          json: true,
        },
      );
      output.push({
        json: objectData(context, itemIndex, completeResponse, 'LifeSpace upload completion'),
        pairedItem: { item: itemIndex },
      });
    } catch (error) {
      if (!context.continueOnFail()) {
        throw new NodeOperationError(context.getNode(), error as Error, { itemIndex });
      }
      output.push({
        json: { error: error instanceof Error ? error.message : String(error) },
        pairedItem: { item: itemIndex },
      });
    }
  }

  return [output];
}
