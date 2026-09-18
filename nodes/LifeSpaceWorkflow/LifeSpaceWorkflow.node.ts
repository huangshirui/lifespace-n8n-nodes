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
  humanExecutionContext,
} from './humanProjection';

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
      description: 'Enter a scalar value as text. Number, integer and boolean values are parsed by the adapter. For Range, TemporalRange and Within operands, enter the canonical JSON object. Is Empty and Is Not Empty ignore this value.',
    },
  ];
}

function filterConditionsProperty(): INodeProperties {
  return {
    displayName: 'Conditions',
    name: 'queryFilterConditions',
    type: 'fixedCollection',
    default: {},
    placeholder: 'Add Condition',
    typeOptions: {
      multipleValues: true,
      multipleValueButtonText: 'Add Condition',
      fixedCollection: { layout: 'inline' },
    },
    displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
    options: [{
      displayName: 'Condition',
      name: 'condition',
      values: filterConditionValues(),
    }],
    description: 'Top-level filter conditions. The Match setting determines whether all or any top-level conditions and groups must match.',
  };
}

function filterMatchProperty(): INodeProperties {
  return {
    displayName: 'Match',
    name: 'queryFilterMatch',
    type: 'options',
    options: [
      { name: 'All Conditions and Groups', value: 'all' },
      { name: 'Any Condition or Group', value: 'any' },
    ],
    default: 'all',
    displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
    description: 'How top-level Conditions and Groups are combined',
  };
}

function filterGroupsProperty(): INodeProperties {
  return {
    displayName: 'Condition Groups',
    name: 'queryFilterGroups',
    type: 'fixedCollection',
    default: {},
    placeholder: 'Add Condition Group',
    typeOptions: { multipleValues: true },
    displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
    options: [{
      displayName: 'Condition Group',
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
            fixedCollection: { layout: 'inline' },
          },
          options: [{
            displayName: 'Condition',
            name: 'condition',
            values: filterConditionValues(),
          }],
        },
      ],
    }],
    description: 'Add one level of nested Boolean groups. Each group has its own All/Any match rule and participates in the top-level Match rule.',
  };
}

function queryViewingTimezoneProperty(): INodeProperties {
  return {
    displayName: 'Viewing Timezone',
    name: 'queryViewingTimezone',
    type: 'string',
    default: '',
    placeholder: 'Asia/Shanghai',
    displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
    description: 'IANA timezone used only when a TemporalRange field is sorted. LifeSpace requires this context to compare date and instant variants deterministically.',
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
      result.push({
        ...property,
        typeOptions: {
          loadOptionsDependsOn: ['spaceId', 'recordType', 'operation'],
          resourceMapper: {
            resourceMapperMethod: 'getHumanRecordFields',
            mode: 'add',
            fieldWords: { singular: 'field', plural: 'fields' },
            addAllFields: false,
            supportAutoMap: false,
            noFieldsError: 'The selected LifeSpace Record Type has no writable fields for this operation.',
          },
        },
        description: 'Only fields selected for this operation are sent. Required Create fields are shown first; optional fields can be added from LifeSpace Discovery.',
      });
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
        filterMatchProperty(),
        filterConditionsProperty(),
        filterGroupsProperty(),
      );
      continue;
    }

    if (property.name === 'sorts') {
      result.push(
        { ...property, displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } } },
        queryViewingTimezoneProperty(),
      );
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
      parameterPane: 'wide',
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
      },
      resourceMapping: {
        ...(node.methods?.resourceMapping ?? {}),
        getHumanRecordFields,
        getHumanQueryFilterFields,
        getActionInputFields: getHumanActionInputFields,
      },
    };
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const executions = await LifeSpace.prototype.execute.call(canonicalOnlyExecutionContext(this));
    return restoreLifeSpaceContinueOnFailErrors(executions);
  }
}
