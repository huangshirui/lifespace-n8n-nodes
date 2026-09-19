import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { LifeSpace } from '../LifeSpace/LifeSpace.node';
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

function humanProperties(properties: INodeProperties[]): INodeProperties[] {
  const result: INodeProperties[] = [];
  for (const property of properties) {
    if ([
      'dateFields',
      'singleRelations',
      'filters',
      'queryMode',
      'semanticQueryKey',
      'semanticQueryInput',
      'semanticSort',
    ].includes(property.name)) continue;

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
        if (name === 'queryMode') {
          const operation = String(context.getNodeParameter('operation', itemIndex, '') ?? '');
          if (operation === 'list') return 'canonical';
        }
        return target.getNodeParameter(name, itemIndex, fallback as never, options as never);
      };
    },
  });
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
      description: 'Use LifeSpace in human-authored n8n workflows',
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
    const executions = await LifeSpace.prototype.execute.call(canonicalOnlyExecutionContext(this));
    return restoreLifeSpaceContinueOnFailErrors(executions);
  }
}
