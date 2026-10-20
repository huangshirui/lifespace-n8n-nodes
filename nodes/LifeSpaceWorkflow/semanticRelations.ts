import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { normalizeBaseUrl } from '../lifespaceDiscovery';

type RelationPage = {
  items: IDataObject[];
  nextCursor: string | null;
};

const modelKeyPattern = /^[a-z][a-z0-9_]{1,62}$/u;
const recordIdPattern = /^rec_[A-Za-z0-9_-]+$/u;
const relationIdPattern = /^rel_[A-Za-z0-9_-]+$/u;

const operationShow = (...operations: string[]): INodeProperties['displayOptions'] => ({
  show: {
    resource: ['semanticRelation'],
    semanticRelationOperation: operations,
  },
});

function stringProperty(
  displayName: string,
  name: string,
  operations: string[],
  description: string,
  required = false,
): INodeProperties {
  return {
    displayName,
    name,
    type: 'string',
    default: '',
    required,
    displayOptions: operationShow(...operations),
    description,
  };
}

export function semanticRelationProperties(): INodeProperties[] {
  return [
    {
      displayName: 'Operation',
      name: 'semanticRelationOperation',
      type: 'options',
      noDataExpression: true,
      displayOptions: { show: { resource: ['semanticRelation'] } },
      options: [
        { name: 'Create', value: 'create', action: 'Create a semantic relation', description: 'Link two existing records with a registered predicate' },
        { name: 'Delete', value: 'delete', action: 'Delete a semantic relation', description: 'Remove an edge without deleting the endpoint records' },
        { name: 'Get', value: 'get', action: 'Get a semantic relation', description: 'Read one relation by ID' },
        { name: 'List', value: 'list', action: 'List semantic relations', description: 'Query directed edges using source, target and predicate filters' },
      ],
      default: 'create',
    },
    stringProperty('Source Model Key', 'relationSourceModelKey', ['create'],
      'Model key that declares the outgoing predicate, for example activity', true),
    stringProperty('Source Record ID', 'relationSourceRecordId', ['create'],
      'Existing source record ID (rec_*)', true),
    stringProperty('Predicate', 'relationPredicate', ['create'],
      'Registered LifeSpace relation predicate declared by the source model, for example relates_to', true),
    stringProperty('Target Model Key', 'relationTargetModelKey', ['create'],
      'Target model key, for example task', true),
    stringProperty('Target Record ID', 'relationTargetRecordId', ['create'],
      'Existing target record ID (rec_*)', true),
    stringProperty('Relation ID', 'relationId', ['get', 'delete'],
      'Semantic Relation ID (rel_*) returned by Create or List', true),
    stringProperty('Source Model Key', 'relationQuerySourceModelKey', ['list'],
      'Optional source-model filter; use together with Source Record ID'),
    stringProperty('Source Record ID', 'relationQuerySourceRecordId', ['list'],
      'Optional source record ID (rec_*); use together with Source Model Key'),
    stringProperty('Target Model Key', 'relationQueryTargetModelKey', ['list'],
      'Optional target-model filter; use together with Target Record ID'),
    stringProperty('Target Record ID', 'relationQueryTargetRecordId', ['list'],
      'Optional target record ID (rec_*); use together with Target Model Key'),
    stringProperty('Predicate', 'relationQueryPredicate', ['list'],
      'Optional registered predicate filter, for example relates_to'),
    {
      displayName: 'Hydrate',
      name: 'relationHydrate',
      type: 'options',
      displayOptions: operationShow('get', 'list'),
      options: [
        { name: 'None', value: 'none' },
        { name: 'Source', value: 'source' },
        { name: 'Target', value: 'target' },
        { name: 'Both', value: 'both' },
      ],
      default: 'none',
      description: 'Optionally include currently visible endpoint records and their reference labels',
    },
    {
      displayName: 'Return All',
      name: 'relationReturnAll',
      type: 'boolean',
      default: false,
      displayOptions: operationShow('list'),
      description: 'Whether to follow all available relation cursors. The node stops after at most 100 pages to bound requests',
    },
    {
      displayName: 'Limit',
      name: 'relationLimit',
      type: 'number',
      typeOptions: { minValue: 1, maxValue: 100, numberPrecision: 0 },
      default: 50,
      displayOptions: { show: { resource: ['semanticRelation'], semanticRelationOperation: ['list'], relationReturnAll: [false] } },
      description: 'Maximum relations in the current page (1 to 100). The response includes nextCursor',
    },
    stringProperty('Cursor', 'relationCursor', ['list'],
      'Opaque nextCursor returned from an earlier List call; ignored when Return All is enabled'),
  ];
}

function requiredValue(
  context: IExecuteFunctions,
  itemIndex: number,
  field: string,
  description: string,
  pattern?: RegExp,
): string {
  const value = String(context.getNodeParameter(field, itemIndex, '') ?? '').trim();
  if (!value || (pattern && !pattern.test(value))) {
    throw new NodeOperationError(context.getNode(), `${description} is invalid or missing`, { itemIndex });
  }
  return value;
}

function optionalValue(context: IExecuteFunctions, itemIndex: number, field: string): string {
  return String(context.getNodeParameter(field, itemIndex, '') ?? '').trim();
}

function relationData(
  response: unknown,
  context: IExecuteFunctions,
  itemIndex: number,
): IDataObject {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new NodeOperationError(context.getNode(), 'Semantic Relation response must be an object', { itemIndex });
  }
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new NodeOperationError(context.getNode(), 'Semantic Relation response is missing its data object', { itemIndex });
  }
  return data as IDataObject;
}

function listFilters(context: IExecuteFunctions, itemIndex: number): IDataObject {
  const qs: IDataObject = {};
  for (const [modelField, recordField, modelKey, recordKey, label] of [
    ['relationQuerySourceModelKey', 'relationQuerySourceRecordId', 'sourceModelKey', 'sourceRecordId', 'Source'],
    ['relationQueryTargetModelKey', 'relationQueryTargetRecordId', 'targetModelKey', 'targetRecordId', 'Target'],
  ]) {
    const model = optionalValue(context, itemIndex, modelField!);
    const record = optionalValue(context, itemIndex, recordField!);
    if (Boolean(model) !== Boolean(record)) {
      throw new NodeOperationError(context.getNode(), `${label} Model Key and Record ID must be supplied together`, { itemIndex });
    }
    if (model && !modelKeyPattern.test(model)) {
      throw new NodeOperationError(context.getNode(), `${label} Model Key is invalid`, { itemIndex });
    }
    if (record && !recordIdPattern.test(record)) {
      throw new NodeOperationError(context.getNode(), `${label} Record ID is invalid`, { itemIndex });
    }
    if (model) {
      qs[modelKey!] = model;
      qs[recordKey!] = record;
    }
  }
  const predicate = optionalValue(context, itemIndex, 'relationQueryPredicate');
  if (predicate) qs.predicate = predicate;
  return qs;
}

function pageData(
  response: unknown,
  context: IExecuteFunctions,
  itemIndex: number,
): RelationPage {
  const data = relationData(response, context, itemIndex);
  if (!Array.isArray(data.items) || data.items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new NodeOperationError(context.getNode(), 'Semantic Relation list response must contain an items array', { itemIndex });
  }
  if (data.nextCursor !== null && typeof data.nextCursor !== 'string') {
    throw new NodeOperationError(context.getNode(), 'Semantic Relation nextCursor is invalid', { itemIndex });
  }
  return { items: data.items as IDataObject[], nextCursor: data.nextCursor as string | null };
}

export async function executeSemanticRelationWorkflow(context: IExecuteFunctions): Promise<INodeExecutionData[][]> {
  const items = context.getInputData();
  const output: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    try {
      const spaceId = requiredValue(context, itemIndex, 'spaceId', 'Space ID', /^spc_[A-Za-z0-9_-]+$/u);
      const operation = requiredValue(context, itemIndex, 'semanticRelationOperation', 'Semantic Relation operation');
      const baseUrl = normalizeBaseUrl((await context.getCredentials('lifeSpaceApi', itemIndex)).baseUrl);
      const collectionPath = `/spaces/${encodeURIComponent(spaceId)}/semantic-relations`;

      const request = async (
        method: 'GET' | 'POST' | 'DELETE',
        path: string,
        options: { body?: IDataObject; qs?: IDataObject } = {},
      ): Promise<unknown> => context.helpers.httpRequestWithAuthentication.call(
        context,
        'lifeSpaceApi',
        {
          method,
          url: `${baseUrl}${path}`,
          ...(options.body ? { body: options.body } : {}),
          ...(options.qs ? { qs: options.qs } : {}),
          json: true,
        },
      );

      if (operation === 'create') {
        const source = {
          kind: 'record',
          modelKey: requiredValue(context, itemIndex, 'relationSourceModelKey', 'Source Model Key', modelKeyPattern),
          recordId: requiredValue(context, itemIndex, 'relationSourceRecordId', 'Source Record ID', recordIdPattern),
        };
        const target = {
          kind: 'record',
          modelKey: requiredValue(context, itemIndex, 'relationTargetModelKey', 'Target Model Key', modelKeyPattern),
          recordId: requiredValue(context, itemIndex, 'relationTargetRecordId', 'Target Record ID', recordIdPattern),
        };
        const predicate = requiredValue(context, itemIndex, 'relationPredicate', 'Predicate');
        const response = await request('POST', collectionPath, { body: { source, predicate, target } });
        output.push({ json: relationData(response, context, itemIndex), pairedItem: { item: itemIndex } });
        continue;
      }

      if (operation === 'list') {
        const baseQs = listFilters(context, itemIndex);
        const hydrate = optionalValue(context, itemIndex, 'relationHydrate');
        if (hydrate && hydrate !== 'none') baseQs.hydrate = hydrate;
        const returnAll = Boolean(context.getNodeParameter('relationReturnAll', itemIndex, false));
        const limit = returnAll ? 100 : Number(context.getNodeParameter('relationLimit', itemIndex, 50));
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new NodeOperationError(context.getNode(), 'Limit must be an integer from 1 to 100', { itemIndex });
        }

        if (!returnAll) {
          const cursor = optionalValue(context, itemIndex, 'relationCursor');
          const response = await request('GET', collectionPath, { qs: { ...baseQs, limit, ...(cursor ? { cursor } : {}) } });
          const page = pageData(response, context, itemIndex);
          output.push({ json: { items: page.items, nextCursor: page.nextCursor }, pairedItem: { item: itemIndex } });
          continue;
        }

        let cursor = '';
        const seenCursors = new Set<string>();
        const allItems: IDataObject[] = [];
        for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
          const response = await request('GET', collectionPath, {
            qs: { ...baseQs, limit: 100, ...(cursor ? { cursor } : {}) },
          });
          const page = pageData(response, context, itemIndex);
          allItems.push(...page.items);
          if (!page.nextCursor) {
            cursor = '';
            break;
          }
          if (seenCursors.has(page.nextCursor)) {
            throw new NodeOperationError(context.getNode(), 'Semantic Relation List returned a repeated cursor', { itemIndex });
          }
          seenCursors.add(page.nextCursor);
          cursor = page.nextCursor;
        }
        if (cursor) {
          throw new NodeOperationError(context.getNode(), 'Semantic Relation Return All exceeded 100 pages; narrow the query', { itemIndex });
        }
        for (const relation of allItems) output.push({ json: relation, pairedItem: { item: itemIndex } });
        continue;
      }

      if (operation === 'get' || operation === 'delete') {
        const relationId = requiredValue(context, itemIndex, 'relationId', 'Relation ID', relationIdPattern);
        const relationPath = `${collectionPath}/${encodeURIComponent(relationId)}`;
        if (operation === 'delete') {
          await request('DELETE', relationPath);
          output.push({ json: { id: relationId, deleted: true }, pairedItem: { item: itemIndex } });
        } else {
          const hydrate = optionalValue(context, itemIndex, 'relationHydrate');
          const response = await request('GET', relationPath, {
            ...(hydrate && hydrate !== 'none' ? { qs: { hydrate } } : {}),
          });
          output.push({ json: relationData(response, context, itemIndex), pairedItem: { item: itemIndex } });
        }
        continue;
      }

      throw new NodeOperationError(context.getNode(), `Unsupported Semantic Relation operation ${operation}`, { itemIndex });
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
