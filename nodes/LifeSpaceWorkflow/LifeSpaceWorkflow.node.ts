import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
  INodeTypeDescription,
} from 'n8n-workflow';
import { LifeSpace } from '../LifeSpace/LifeSpace.node';
import {
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
    displayOptions: { show: { resource: ['modelRecord'], operation: ['list'], queryMode: ['standard'] } },
    description: 'Add semantic filters published by LifeSpace. Each filter already includes its valid operator and renders a value control from the field type.',
  };
}

function localDateWindowsProperty(): INodeProperties {
  return {
    displayName: 'Advanced Local Date Windows',
    name: 'localDateWindows',
    type: 'fixedCollection',
    default: {},
    placeholder: 'Add Local Date Window',
    typeOptions: { multipleValues: true },
    displayOptions: { show: { resource: ['modelRecord'], operation: ['list'], queryMode: ['standard'] } },
    options: [{
      displayName: 'Window',
      name: 'window',
      values: [
        {
          displayName: 'Field Name or ID',
          name: 'field',
          type: 'options',
          typeOptions: { loadOptionsMethod: 'getLocalDateWindowFields', loadOptionsDependsOn: ['spaceId', 'recordType'] },
          options: [],
          default: '',
          required: true,
          description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        },
        { displayName: 'Start Date', name: 'dateStart', type: 'dateTime', default: '', required: true },
        { displayName: 'End Date (Exclusive)', name: 'dateEndExclusive', type: 'dateTime', default: '', required: true },
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
  };
}

function humanProperties(properties: INodeProperties[]): INodeProperties[] {
  const result: INodeProperties[] = [];
  for (const property of properties) {
    if (property.name === 'dateFields' || property.name === 'singleRelations' || property.name === 'filters') continue;

    if (property.name === 'fields') {
      result.push({
        ...property,
        typeOptions: {
          ...property.typeOptions,
          resourceMapper: {
            ...property.typeOptions?.resourceMapper,
            resourceMapperMethod: 'getHumanRecordFields',
            noFieldsError: 'The selected LifeSpace Record Type has no writable fields for this operation.',
          },
        },
        description: 'Writable fields are loaded from LifeSpace Discovery. Field types, required state, enum values, dates and single relations are rendered automatically.',
      });
      continue;
    }

    if (property.name === 'queryMode') {
      result.push({
        ...property,
        displayName: 'Query Type',
        description: 'Use Records for ordinary search/filter/sort. Capability Query is available only when the selected Record Type publishes one.',
      });
      continue;
    }

    if (property.name === 'semanticQueryKey') {
      result.push({ ...property, displayName: 'Capability Query' });
      continue;
    }

    if (property.name === 'search') {
      result.push(property, queryFiltersProperty(), localDateWindowsProperty());
      continue;
    }

    result.push(property);
  }
  return result;
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

    this.methods = {
      ...this.methods,
      resourceMapping: {
        ...this.methods.resourceMapping,
        getHumanRecordFields,
        getHumanQueryFilterFields,
      },
    };
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return LifeSpace.prototype.execute.call(humanExecutionContext(this));
  }
}
