import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { LifeSpace } from '../LifeSpace/LifeSpace.node';
import { normalizeBaseUrl } from '../lifespaceDiscovery';
import { restoreLifeSpaceContinueOnFailErrors } from './lifeSpaceErrorProjection';
import {
  getCanonicalFilterFields,
  getCanonicalFilterOperators,
  getCanonicalFilterOptions,
  getCanonicalTimeWindowFields,
  getHumanActionInputFields,
  getHumanQueryFilterFields,
  getHumanRecordFields,
  getHumanSortableFields,
  getHumanTemporalRangeMutationFields,
  humanExecutionContext,
} from './humanProjection';

type PersonPage = {
  items?: unknown;
  nextCursor?: unknown;
};

type PersonAlternateNamePatch = {
  set?: string[];
  add?: string[];
  remove?: string[];
  rename?: Array<{ from: string; to: string }>;
};

function temporalRangeFieldsProperty(): INodeProperties {
  return {
    displayName: 'Temporal Range Fields',
    name: 'temporalFields',
    type: 'resourceMapper',
    default: { mappingMode: 'defineBelow', value: null },
    noDataExpression: true,
    typeOptions: {
      loadOptionsDependsOn: ['spaceId', 'recordType', 'operation'],
      resourceMapper: {
        resourceMapperMethod: 'getHumanTemporalRangeMutationFields',
        mode: 'add',
        fieldWords: { singular: 'temporal value', plural: 'temporal values' },
        addAllFields: true,
        supportAutoMap: false,
        noFieldsError: 'The selected LifeSpace Record Type has no writable TemporalRange fields.',
      },
    },
    displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },
    description: 'Each writable TemporalRange is shown directly as Type, Start, and End controls. The adapter combines those controls into one canonical LifeSpace field.',
  };
}

function filterConditionValues(): INodeProperties[] {
  return [
    {
      // eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options
      displayName: 'Field',
      name: 'field',
      type: 'options',
      typeOptions: {
        loadOptionsMethod: 'getCanonicalFilterFields',
        loadOptionsDependsOn: ['spaceId', 'recordType'],
      },
      options: [],
      default: '',
      required: true,
      // eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-options
      description: 'Choose from the list, or specify using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
    },
    {
      // eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options
      displayName: 'Operator',
      name: 'operator',
      type: 'options',
      typeOptions: {
        loadOptionsMethod: 'getCanonicalFilterOperators',
        loadOptionsDependsOn: ['&field', 'spaceId', 'recordType'],
      },
      options: [],
      default: '',
      required: true,
      description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
    },
    {
      displayName: 'Value',
      name: 'value',
      type: 'string',
      default: '',
      displayOptions: {
        hide: {
          operator: [{ _cnd: { regex: '^lsqh1:(?:isNull|isNotNull)\\.' } }],
        },
      },
      description: 'Enter a string or n8n expression. Number and boolean values are parsed by the adapter. Temporal range Overlaps uses paired Overlaps Start and Overlaps End conditions; Before and After accept a date or absolute date-time string.',
    },
  ];
}

function filterGroupsProperty(): INodeProperties {
  return {
    displayName: 'Filters',
    name: 'queryFilterGroups',
    type: 'fixedCollection',
    default: {},
    placeholder: 'Add Filter Group',
    typeOptions: { multipleValues: true },
    displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
    options: [{
      displayName: 'Filter Group',
      name: 'group',
      values: [
        {
          displayName: 'Match',
          name: 'match',
          type: 'options',
          options: [
            { name: 'All Conditions', value: 'all' },
            { name: 'Any Condition', value: 'any' },
          ],
          default: 'all',
        },
        {
          displayName: 'Conditions',
          name: 'conditions',
          type: 'fixedCollection',
          default: {},
          placeholder: 'Add Condition',
          typeOptions: {
            multipleValues: true,
            multipleValueButtonText: 'Add Condition',
          },
          options: [{
            displayName: 'Condition',
            name: 'condition',
            values: filterConditionValues(),
          }],
        },
      ],
    }],
    description: 'Add Filter Groups. Conditions inside a group use All or Any; multiple Filter Groups are combined with AND.',
  };
}

function queryViewingTimezoneOption(): INodeProperties {
  return {
    displayName: 'Viewing Timezone',
    name: 'viewingTimezone',
    type: 'string',
    default: '',
    placeholder: 'Asia/Shanghai',
    description: 'Optional IANA timezone override for temporal range date interpretation and sorting. If omitted, the current n8n workflow timezone is used.',
  };
}

function personNameCollection(
  displayName: string,
  name: string,
  displayOptions: INodeProperties['displayOptions'],
  description: string,
): INodeProperties {
  return {
    displayName,
    name,
    type: 'fixedCollection',
    default: {},
    placeholder: 'Add Name',
    typeOptions: {
      multipleValues: true,
      multipleValueButtonText: 'Add Name',
    },
    displayOptions,
    options: [{
      displayName: 'Name',
      name: 'name',
      values: [{
        displayName: 'Name',
        name: 'value',
        type: 'string',
        default: '',
        required: true,
      }],
    }],
    description,
  };
}

function personProperties(): INodeProperties[] {
  const createShow = { show: { resource: ['person'], personOperation: ['create'] } } as INodeProperties['displayOptions'];
  const updateShow = { show: { resource: ['person'], personOperation: ['update'] } } as INodeProperties['displayOptions'];
  const listShow = { show: { resource: ['person'], personOperation: ['list'] } } as INodeProperties['displayOptions'];

  return [
    {
      displayName: 'Operation',
      name: 'personOperation',
      type: 'options',
      noDataExpression: true,
      displayOptions: { show: { resource: ['person'] } },
      options: [
        { name: 'Create', value: 'create', action: 'Create a person', description: 'Create an unlinked Space Person in the Kernel Person Directory' },
        { name: 'Delete', value: 'delete', action: 'Delete a person', description: 'Soft-delete an unlinked Person using optimistic concurrency' },
        { name: 'Get', value: 'get', action: 'Get a person', description: 'Get one Person by per_* ID' },
        { name: 'List / Search', value: 'list', action: 'List or search people', description: 'List active Space People or search canonical and alternate names' },
        { name: 'Update', value: 'update', action: 'Update a person', description: 'Update canonical or alternate names using optimistic concurrency' },
      ],
      default: 'list',
    },
    {
      displayName: 'Person ID',
      name: 'personId',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'per_...',
      displayOptions: { show: { resource: ['person'], personOperation: ['get', 'update', 'delete'] } },
      description: 'Stable Space Person identifier',
    },
    {
      displayName: 'Display Name',
      name: 'personDisplayName',
      type: 'string',
      default: '',
      displayOptions: { show: { resource: ['person'], personOperation: ['create', 'update'] } },
      description: 'Canonical Person label. Required for Create; leave empty on Update to keep the current display name.',
    },
    personNameCollection(
      'Alternate Names',
      'personAlternateNames',
      createShow,
      'Optional alternate names for a newly created Person. Names are Space-local lookup aliases; the canonical display name is not duplicated here.',
    ),
    {
      displayName: 'Version',
      name: 'personVersion',
      type: 'number',
      default: 1,
      required: true,
      typeOptions: { minValue: 1, numberPrecision: 0 },
      displayOptions: { show: { resource: ['person'], personOperation: ['update', 'delete'] } },
      description: 'Expected Person version for optimistic concurrency',
    },
    {
      displayName: 'Alternate Name Change',
      name: 'personAlternateNameMode',
      type: 'options',
      noDataExpression: true,
      default: 'none',
      displayOptions: updateShow,
      options: [
        { name: 'No Change', value: 'none', description: 'Keep the current alternate-name set unchanged' },
        { name: 'Replace All', value: 'set', description: 'Replace the complete active alternate-name set atomically' },
        { name: 'Incremental', value: 'incremental', description: 'Add, remove, and/or rename alternate names in one Person mutation' },
      ],
    },
    personNameCollection(
      'Replacement Alternate Names',
      'personSetAlternateNames',
      { show: { resource: ['person'], personOperation: ['update'], personAlternateNameMode: ['set'] } },
      'Complete replacement set. Leaving this empty removes all alternate names.',
    ),
    personNameCollection(
      'Alternate Names to Add',
      'personAddAlternateNames',
      { show: { resource: ['person'], personOperation: ['update'], personAlternateNameMode: ['incremental'] } },
      'Names to add to the current active alternate-name set.',
    ),
    personNameCollection(
      'Alternate Names to Remove',
      'personRemoveAlternateNames',
      { show: { resource: ['person'], personOperation: ['update'], personAlternateNameMode: ['incremental'] } },
      'Currently active alternate names to remove.',
    ),
    {
      displayName: 'Alternate Names to Rename',
      name: 'personRenameAlternateNames',
      type: 'fixedCollection',
      default: {},
      placeholder: 'Add Rename',
      typeOptions: {
        multipleValues: true,
        multipleValueButtonText: 'Add Rename',
      },
      displayOptions: { show: { resource: ['person'], personOperation: ['update'], personAlternateNameMode: ['incremental'] } },
      options: [{
        displayName: 'Rename',
        name: 'rename',
        values: [
          { displayName: 'From', name: 'from', type: 'string', default: '', required: true },
          { displayName: 'To', name: 'to', type: 'string', default: '', required: true },
        ],
      }],
      description: 'Rename active alternate names without exposing alias rows as independent resources.',
    },
    {
      displayName: 'Search',
      name: 'personSearch',
      type: 'string',
      default: '',
      displayOptions: listShow,
      description: 'Optional substring search across canonical display names and active alternate names',
    },
    {
      displayName: 'Return All',
      name: 'personReturnAll',
      type: 'boolean',
      default: false,
      displayOptions: listShow,
      description: 'Whether to follow Person Directory cursors until every matching Person has been returned',
    },
    {
      displayName: 'Limit',
      name: 'personLimit',
      type: 'number',
      default: 50,
      typeOptions: { minValue: 1, maxValue: 100, numberPrecision: 0 },
      displayOptions: { show: { resource: ['person'], personOperation: ['list'], personReturnAll: [false] } },
      description: 'Maximum number of People to return from this page',
    },
    {
      displayName: 'Cursor',
      name: 'personCursor',
      type: 'string',
      default: '',
      displayOptions: { show: { resource: ['person'], personOperation: ['list'], personReturnAll: [false] } },
      description: 'Optional opaque Person Directory cursor for the next page',
    },
  ];
}

function humanProperties(properties: INodeProperties[]): INodeProperties[] {
  const result: INodeProperties[] = [];
  for (const property of properties) {
    if ([
      'batchAuthorityMode',
      'batchPrincipalUserId',
      'batchOperations',
      'dateFields',
      'singleRelations',
      'filters',
      'queryMode',
      'semanticQueryKey',
      'semanticQueryInput',
      'semanticSort',
    ].includes(property.name)) continue;

    if (property.name === 'resource') {
      const options = (property.options ?? []).filter(
        (option) => !('value' in option) || option.value !== 'batchMutation',
      );
      const apiRequestIndex = options.findIndex((option) => 'value' in option && option.value === 'apiRequest');
      const personOption = { name: 'Person', value: 'person' };
      const personOptions = apiRequestIndex < 0
        ? [...options, personOption]
        : [...options.slice(0, apiRequestIndex), personOption, ...options.slice(apiRequestIndex)];
      result.push({ ...property, options: personOptions }, ...personProperties());
      continue;
    }

    if (property.name === 'spaceId') {
      result.push({
        ...property,
        displayOptions: { show: { resource: ['modelRecord', 'person'] } },
      });
      continue;
    }

    if (property.name === 'fields') {
      result.push(
        {
          ...property,
          typeOptions: {
            loadOptionsDependsOn: ['spaceId', 'recordType', 'operation'],
            resourceMapper: {
              resourceMapperMethod: 'getHumanRecordFields',
              mode: 'add',
              fieldWords: { singular: 'field', plural: 'fields' },
              addAllFields: false,
              supportAutoMap: false,
              noFieldsError: 'The selected LifeSpace Record Type has no scalar or relation fields for this operation.',
            },
          },
          description: 'Only fields selected for this operation are sent. TemporalRange fields use the direct controls below instead of JSON.',
        },
        temporalRangeFieldsProperty(),
      );
      continue;
    }

    if (property.name === 'multiRelations') {
      result.push({
        ...property,
        displayName: 'Related People & Records',
        placeholder: 'Add Related Field',
      });
      continue;
    }

    if (property.name === 'search') {
      result.push(
        { ...property, displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } } },
        filterGroupsProperty(),
      );
      continue;
    }

    if (property.name === 'sorts') {
      result.push({ ...property, displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } } });
      continue;
    }

    if (property.name === 'options') {
      result.push({
        ...property,
        options: [...(property.options ?? []), queryViewingTimezoneOption()],
      });
      continue;
    }

    result.push(property);
  }
  return result;
}

function canonicalOnlyExecutionContext(context: IExecuteFunctions): IExecuteFunctions {
  const human = humanExecutionContext(context);
  return new Proxy(human, {
    get(target, property, receiver) {
      if (property !== 'getNodeParameter') return Reflect.get(target, property, receiver);
      return (name: string, itemIndex: number, fallback?: unknown, options?: unknown) => {
        if (name === 'batchAuthorityMode') return 'service';
        if (name === 'batchPrincipalUserId' || name === 'batchDelegationId') return '';
        if (name === 'queryMode') {
          const operation = String(context.getNodeParameter('operation', itemIndex, '') ?? '');
          if (operation === 'list') return 'canonical';
        }
        return target.getNodeParameter(name, itemIndex, fallback as never, options as never);
      };
    },
  });
}

function assertNoLegacyDelegatedWorkflowBatch(context: IExecuteFunctions): void {
  const items = context.getInputData();
  if (!items.length) return;
  const resource = String(context.getNodeParameter('resource', 0, '') ?? '');
  if (resource !== 'batchMutation') return;
  const legacyMode = String(context.getNodeParameter('batchAuthorityMode', 0, 'service') ?? 'service');
  if (legacyMode !== 'delegatedAgent') return;
  throw new NodeOperationError(
    context.getNode(),
    'LifeSpace 0.2.0 no longer allows Delegated Agent Authority in the ordinary Workflow node. Move this execution to LifeSpace Agent Tool / User Authorization instead of silently changing the Principal.',
  );
}

function requiredPersonId(context: IExecuteFunctions, itemIndex: number): string {
  const value = String(context.getNodeParameter('personId', itemIndex, '') ?? '').trim();
  if (!/^per_[A-Za-z0-9_-]+$/u.test(value)) {
    throw new NodeOperationError(context.getNode(), 'Person ID must be a valid per_* identifier', { itemIndex });
  }
  return value;
}

function personVersion(context: IExecuteFunctions, itemIndex: number): number {
  const value = Number(context.getNodeParameter('personVersion', itemIndex, 0));
  if (!Number.isInteger(value) || value < 1) {
    throw new NodeOperationError(context.getNode(), 'Person Version must be a positive integer', { itemIndex });
  }
  return value;
}

function personNameRows(context: IExecuteFunctions, itemIndex: number, parameter: string): string[] {
  const rows = context.getNodeParameter(`${parameter}.name`, itemIndex, []) as Array<{ value?: unknown }>;
  return rows
    .map((row) => String(row.value ?? '').trim())
    .filter(Boolean);
}

function personAlternateNamePatch(context: IExecuteFunctions, itemIndex: number): PersonAlternateNamePatch | undefined {
  const mode = String(context.getNodeParameter('personAlternateNameMode', itemIndex, 'none') ?? 'none');
  if (mode === 'none') return undefined;
  if (mode === 'set') {
    return { set: personNameRows(context, itemIndex, 'personSetAlternateNames') };
  }
  if (mode !== 'incremental') {
    throw new NodeOperationError(context.getNode(), 'Alternate Name Change mode is invalid', { itemIndex });
  }

  const add = personNameRows(context, itemIndex, 'personAddAlternateNames');
  const remove = personNameRows(context, itemIndex, 'personRemoveAlternateNames');
  const renameRows = context.getNodeParameter('personRenameAlternateNames.rename', itemIndex, []) as Array<{ from?: unknown; to?: unknown }>;
  const rename = renameRows
    .map((row) => ({ from: String(row.from ?? '').trim(), to: String(row.to ?? '').trim() }))
    .filter((row) => row.from || row.to);
  if (rename.some((row) => !row.from || !row.to)) {
    throw new NodeOperationError(context.getNode(), 'Each alternate-name rename requires both From and To', { itemIndex });
  }
  if (!add.length && !remove.length && !rename.length) {
    throw new NodeOperationError(context.getNode(), 'Incremental alternate-name change requires at least one Add, Remove, or Rename operation', { itemIndex });
  }
  return {
    ...(add.length ? { add } : {}),
    ...(remove.length ? { remove } : {}),
    ...(rename.length ? { rename } : {}),
  };
}

async function personRequest(
  context: IExecuteFunctions,
  itemIndex: number,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: { body?: IDataObject; qs?: IDataObject } = {},
): Promise<unknown> {
  const credentials = await context.getCredentials('lifeSpaceApi', itemIndex);
  const baseUrl = normalizeBaseUrl(credentials.baseUrl);
  return context.helpers.httpRequestWithAuthentication.call(
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
}

function responseData(response: unknown, context: IExecuteFunctions, itemIndex: number): IDataObject {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace Person response is invalid', { itemIndex });
  }
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new NodeOperationError(context.getNode(), 'LifeSpace Person response does not contain an object data payload', { itemIndex });
  }
  return data as IDataObject;
}

async function executePersonWorkflow(context: IExecuteFunctions): Promise<INodeExecutionData[][]> {
  const input = context.getInputData();
  const output: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < input.length; itemIndex += 1) {
    try {
      const spaceId = String(context.getNodeParameter('spaceId', itemIndex, '') ?? '').trim();
      if (!/^spc_[A-Za-z0-9_-]+$/u.test(spaceId)) {
        throw new NodeOperationError(context.getNode(), 'Space must resolve to a valid spc_* identifier', { itemIndex });
      }
      const operation = String(context.getNodeParameter('personOperation', itemIndex, 'list') ?? 'list');
      const collectionPath = `/spaces/${encodeURIComponent(spaceId)}/people`;

      if (operation === 'create') {
        const displayName = String(context.getNodeParameter('personDisplayName', itemIndex, '') ?? '').trim();
        if (!displayName) {
          throw new NodeOperationError(context.getNode(), 'Display Name is required when creating a Person', { itemIndex });
        }
        const alternateNames = personNameRows(context, itemIndex, 'personAlternateNames');
        const response = await personRequest(context, itemIndex, 'POST', collectionPath, {
          body: {
            displayName,
            ...(alternateNames.length ? { alternateNames } : {}),
          },
        });
        output.push({ json: responseData(response, context, itemIndex), pairedItem: { item: itemIndex } });
        continue;
      }

      if (operation === 'list') {
        const search = String(context.getNodeParameter('personSearch', itemIndex, '') ?? '').trim();
        const returnAll = Boolean(context.getNodeParameter('personReturnAll', itemIndex, false));
        let cursor = returnAll ? '' : String(context.getNodeParameter('personCursor', itemIndex, '') ?? '').trim();
        const configuredLimit = Number(context.getNodeParameter('personLimit', itemIndex, 50));
        if (!returnAll && (!Number.isInteger(configuredLimit) || configuredLimit < 1 || configuredLimit > 100)) {
          throw new NodeOperationError(context.getNode(), 'Person Limit must be an integer between 1 and 100', { itemIndex });
        }
        const seenCursors = new Set<string>();
        do {
          const qs: IDataObject = {
            limit: returnAll ? 100 : configuredLimit,
            ...(search ? { q: search } : {}),
            ...(cursor ? { cursor } : {}),
          };
          const response = await personRequest(context, itemIndex, 'GET', collectionPath, { qs });
          const page = responseData(response, context, itemIndex) as PersonPage;
          if (!Array.isArray(page.items)) {
            throw new NodeOperationError(context.getNode(), 'LifeSpace Person list response does not contain an items array', { itemIndex });
          }
          for (const person of page.items) {
            if (!person || typeof person !== 'object' || Array.isArray(person)) {
              throw new NodeOperationError(context.getNode(), 'LifeSpace Person list contains an invalid item', { itemIndex });
            }
            output.push({ json: person as IDataObject, pairedItem: { item: itemIndex } });
          }
          const nextCursor = typeof page.nextCursor === 'string' ? page.nextCursor.trim() : '';
          if (!returnAll || !nextCursor) break;
          if (seenCursors.has(nextCursor)) {
            throw new NodeOperationError(context.getNode(), 'LifeSpace Person Directory repeated a cursor while Return All was enabled', { itemIndex });
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        } while (true);
        continue;
      }

      const personId = requiredPersonId(context, itemIndex);
      const personPath = `${collectionPath}/${encodeURIComponent(personId)}`;
      if (operation === 'get') {
        const response = await personRequest(context, itemIndex, 'GET', personPath);
        output.push({ json: responseData(response, context, itemIndex), pairedItem: { item: itemIndex } });
        continue;
      }

      if (operation === 'update') {
        const body: IDataObject = { version: personVersion(context, itemIndex) };
        const displayName = String(context.getNodeParameter('personDisplayName', itemIndex, '') ?? '').trim();
        if (displayName) body.displayName = displayName;
        const alternateNames = personAlternateNamePatch(context, itemIndex);
        if (alternateNames) body.alternateNames = alternateNames as unknown as IDataObject;
        if (!displayName && !alternateNames) {
          throw new NodeOperationError(context.getNode(), 'Person Update requires a Display Name or Alternate Name Change', { itemIndex });
        }
        const response = await personRequest(context, itemIndex, 'PATCH', personPath, { body });
        output.push({ json: responseData(response, context, itemIndex), pairedItem: { item: itemIndex } });
        continue;
      }

      if (operation === 'delete') {
        await personRequest(context, itemIndex, 'DELETE', personPath, {
          body: { version: personVersion(context, itemIndex) },
        });
        output.push({ json: { id: personId, deleted: true }, pairedItem: { item: itemIndex } });
        continue;
      }

      throw new NodeOperationError(context.getNode(), `Unsupported Person operation ${operation}`, { itemIndex });
    } catch (error) {
      if (!context.continueOnFail()) throw new NodeOperationError(context.getNode(), error as Error, { itemIndex });
      output.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: itemIndex } });
    }
  }

  return [output];
}

export class LifeSpaceWorkflow extends LifeSpace {
  constructor() {
    super();
    const description = this.description as INodeTypeDescription & { usableAsTool?: boolean };
    delete description.usableAsTool;
    this.description = {
      ...description,
      icon: {
        light: 'file:lifespace.svg',
        dark: 'file:lifespace.dark.svg',
      },
      subtitle: '={{$parameter["resource"] === "person" ? $parameter["personOperation"] : ($parameter["resource"] === "modelRecord" ? $parameter["operation"] : "API Request")}}',
      description: 'Use LifeSpace with Service Authority in human-authored n8n workflows',
      credentials: [
        {
          name: 'lifeSpaceApi',
          required: true,
        },
      ],
      properties: humanProperties(description.properties),
    };

    const node = this as unknown as INodeType;
    node.methods = {
      ...(node.methods ?? {}),
      loadOptions: {
        ...(node.methods?.loadOptions ?? {}),
        getCanonicalFilterFields,
        getCanonicalFilterOperators,
        getCanonicalFilterOptions,
        getCanonicalTimeWindowFields,
        getSortableFields: getHumanSortableFields,
      },
      resourceMapping: {
        ...(node.methods?.resourceMapping ?? {}),
        getHumanRecordFields,
        getHumanQueryFilterFields,
        getHumanTemporalRangeMutationFields,
        getActionInputFields: getHumanActionInputFields,
      },
    };
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    assertNoLegacyDelegatedWorkflowBatch(this);
    const resource = this.getInputData().length
      ? String(this.getNodeParameter('resource', 0, '') ?? '')
      : '';
    if (resource === 'person') return executePersonWorkflow(this);
    const executions = await LifeSpace.prototype.execute.call(canonicalOnlyExecutionContext(this));
    return restoreLifeSpaceContinueOnFailErrors(executions);
  }
}
