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
  getCanonicalTimeWindowFields,
  getHumanActionInputFields,
  getHumanQueryFilterFields,
  getHumanRecordFields,
  humanExecutionContext,
} from './humanProjection';

function queryFiltersProperty(): INodeProperties {
  return {
    displayName: 'Filters',
    name: 'queryFilters',
    type: 'resourceMapper',
    default: { mappingMode: 'defineBelow', value: null },
    noDataExpression: true,
    typeOptions: {
      loadOptionsDependsOn: ['spaceId', 'recordType'],
      resourceMapper: {
        resourceMapperMethod: 'getHumanQueryFilterFields',
        mode: 'add',
        fieldWords: { singular: 'filter', plural: 'filters' },
        addAllFields: false,
        supportAutoMap: false,
        noFieldsError: 'The selected Record Type does not publish any query filters.',
      },
    },
    displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
    description: 'Add semantic filters published by LifeSpace. Each filter already includes its valid operator and renders a value control from the field type.',
  };
}

function queryTimeWindowsProperty(): INodeProperties {
  return {
    displayName: 'Time Window Filters',
    name: 'queryTimeWindows',
    type: 'fixedCollection',
    default: {},
    placeholder: 'Add Time Window Filter',
    typeOptions: { multipleValues: true },
    displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
    options: [{
      displayName: 'Time Window',
      name: 'window',
      values: [
        {
          displayName: 'Field and Operator Name or ID',
          name: 'target',
          type: 'options',
          typeOptions: {
            loadOptionsMethod: 'getCanonicalTimeWindowFields',
            loadOptionsDependsOn: ['spaceId', 'recordType'],
          },
          options: [],
          default: '',
          required: true,
          description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        },
        { displayName: 'Start Date', name: 'startDate', type: 'dateTime', default: '', required: true },
        { displayName: 'End Date (Exclusive)', name: 'endDateExclusive', type: 'dateTime', default: '', required: true },
        {
          displayName: 'Viewing Timezone',
          name: 'timezone',
          type: 'string',
          default: '',
          required: true,
          placeholder: 'Asia/Shanghai',
          description: 'IANA timezone. LifeSpace Core owns timezone and DST conversion.',
        },
      ],
    }],
    description: 'Typed local-date-window predicates from the same Canonical Filter contract',
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
        queryFiltersProperty(),
        queryTimeWindowsProperty(),
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
      properties: humanProperties(description.properties),
    };

    const node = this as unknown as INodeType;
    node.methods = {
      ...(node.methods ?? {}),
      loadOptions: {
        ...(node.methods?.loadOptions ?? {}),
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
