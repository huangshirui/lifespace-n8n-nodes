import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function once(content, before, after, label) {
  if (!content.includes(before)) throw new Error(`Missing expected snippet: ${label}`);
  return content.replace(before, after);
}

// Discovery 0.24 adds a human-readable Space label while keeping 0.23 compatible.
{
  const path = 'nodes/lifespaceDiscovery.ts';
  let content = read(path);
  content = once(
    content,
    `export type DiscoverySpace = {\n  spaceId: string;\n  models: DiscoveryModel[];\n};`,
    `export type DiscoverySpace = {\n  spaceId: string;\n  spaceName?: string | null;\n  models: DiscoveryModel[];\n};`,
    'DiscoverySpace label',
  );
  write(path, content);
}

{
  const path = 'nodes/LifeSpace/LifeSpace.node.ts';
  let content = read(path);

  // Date fields get an n8n picker. Model date-only values are normalized by the dedicated mapping below.
  content = once(
    content,
    `    case 'datetime':\n      return 'dateTime';`,
    `    case 'date':\n    case 'datetime':\n      return 'dateTime';`,
    'date resource mapper type',
  );

  // Generic helpers for date-only and relation mappings that Resource Mapper cannot express natively.
  content = once(
    content,
    `function mappedValue(context: IExecuteFunctions, itemIndex: number, parameterName: string): IDataObject {\n  const value = context.getNodeParameter(\`${'${parameterName}'}.value\`, itemIndex, {});\n  return value && typeof value === 'object' && !Array.isArray(value) ? value as IDataObject : {};\n}\n`,
    `function mappedValue(context: IExecuteFunctions, itemIndex: number, parameterName: string): IDataObject {\n  const value = context.getNodeParameter(\`${'${parameterName}'}.value\`, itemIndex, {});\n  return value && typeof value === 'object' && !Array.isArray(value) ? value as IDataObject : {};\n}\n\nfunction dateOnlyValue(context: IExecuteFunctions, itemIndex: number, value: unknown, fieldName: string): string | null {\n  if (value === null || value === undefined || value === '') return null;\n  const raw = String(value).trim();\n  const match = /^(\\d{4}-\\d{2}-\\d{2})(?:$|T)/u.exec(raw);\n  if (!match) {\n    throw new NodeOperationError(context.getNode(), \`${'${fieldName}'} must be a calendar date\`, { itemIndex });\n  }\n  return match[1];\n}\n\nfunction mergeMappedValues(\n  context: IExecuteFunctions,\n  itemIndex: number,\n  ...values: IDataObject[]\n): IDataObject {\n  const result: IDataObject = {};\n  for (const value of values) {\n    for (const [key, entry] of Object.entries(value)) {\n      if (Object.prototype.hasOwnProperty.call(result, key)) {\n        throw new NodeOperationError(context.getNode(), \`Field ${'${key}'} is configured more than once\`, { itemIndex });\n      }\n      result[key] = entry;\n    }\n  }\n  return result;\n}\n\nfunction dateMappedValues(context: IExecuteFunctions, itemIndex: number): IDataObject {\n  const rows = context.getNodeParameter('dateFields.date', itemIndex, []) as Array<{ field?: unknown; value?: unknown }>;\n  const result: IDataObject = {};\n  for (const row of rows) {\n    const field = String(row.field ?? '').trim();\n    if (!field) continue;\n    if (Object.prototype.hasOwnProperty.call(result, field)) {\n      throw new NodeOperationError(context.getNode(), \`Date field ${'${field}'} is configured more than once\`, { itemIndex });\n    }\n    result[field] = dateOnlyValue(context, itemIndex, row.value, field);\n  }\n  return result;\n}\n\nfunction relationMappedValues(context: IExecuteFunctions, itemIndex: number): IDataObject {\n  const singles = context.getNodeParameter('singleRelations.relation', itemIndex, []) as Array<{ field?: unknown; target?: unknown }>;\n  const multiples = context.getNodeParameter('multiRelations.relation', itemIndex, []) as Array<{ field?: unknown; targets?: unknown }>;\n  const result: IDataObject = {};\n  for (const row of singles) {\n    const field = String(row.field ?? '').trim();\n    if (!field) continue;\n    if (Object.prototype.hasOwnProperty.call(result, field)) {\n      throw new NodeOperationError(context.getNode(), \`Relation field ${'${field}'} is configured more than once\`, { itemIndex });\n    }\n    const target = row.target === null || row.target === undefined ? '' : String(row.target).trim();\n    result[field] = target || null;\n  }\n  for (const row of multiples) {\n    const field = String(row.field ?? '').trim();\n    if (!field) continue;\n    if (Object.prototype.hasOwnProperty.call(result, field)) {\n      throw new NodeOperationError(context.getNode(), \`Relation field ${'${field}'} is configured more than once\`, { itemIndex });\n    }\n    const raw = row.targets;\n    const targets = Array.isArray(raw)\n      ? raw.map((value) => String(value).trim()).filter(Boolean)\n      : raw === null || raw === undefined || raw === ''\n        ? []\n        : [String(raw).trim()].filter(Boolean);\n    result[field] = targets;\n  }\n  return result;\n}\n\nfunction mutationMappedValues(context: IExecuteFunctions, itemIndex: number): IDataObject {\n  return mergeMappedValues(\n    context,\n    itemIndex,\n    mappedValue(context, itemIndex, 'fields'),\n    dateMappedValues(context, itemIndex),\n    relationMappedValues(context, itemIndex),\n  );\n}\n\nfunction normalizeActionInput(\n  context: IExecuteFunctions,\n  itemIndex: number,\n  value: IDataObject,\n  fields: DiscoveryField[],\n): IDataObject {\n  const result = { ...value };\n  for (const field of fields) {\n    if (field.type === 'date' && Object.prototype.hasOwnProperty.call(result, field.key)) {\n      result[field.key] = dateOnlyValue(context, itemIndex, result[field.key], field.key);\n    }\n  }\n  return result;\n}\n`,
    'mapping helpers',
  );

  // Normalize Action date inputs while preserving concurrency separation.
  content = once(
    content,
    `  const concurrency = action.concurrency;\n  if (!concurrency || !concurrency.required) return semanticInput;`,
    `  const normalizedInput = normalizeActionInput(context, itemIndex, semanticInput, action.input.fields);\n  const concurrency = action.concurrency;\n  if (!concurrency || !concurrency.required) return normalizedInput;`,
    'action input normalization',
  );
  content = once(
    content,
    `  return {\n    ...semanticInput,\n    [concurrency.transport.name]: await currentRecordVersion(context, itemIndex, baseUrl, recordPath),\n  };`,
    `  return {\n    ...normalizedInput,\n    [concurrency.transport.name]: await currentRecordVersion(context, itemIndex, baseUrl, recordPath),\n  };`,
    'action normalized return',
  );

  // Insert dedicated date and relation controls after the ordinary Resource Mapper.
  const fieldsDescription = `        description: 'Writable fields loaded from LifeSpace Runtime Discovery. Server-defaulted required fields are not required from the n8n user.',\n      },\n`;
  content = once(
    content,
    fieldsDescription,
    `${fieldsDescription}      {\n        displayName: 'Date Fields',\n        name: 'dateFields',\n        type: 'fixedCollection',\n        default: {},\n        placeholder: 'Add Date Field',\n        typeOptions: { multipleValues: true },\n        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },\n        options: [\n          {\n            displayName: 'Date',\n            name: 'date',\n            values: [\n              {\n                displayName: 'Field Name or ID',\n                name: 'field',\n                type: 'options',\n                typeOptions: {\n                  loadOptionsMethod: 'getWritableDateFields',\n                  loadOptionsDependsOn: ['spaceId', 'modelRoute', 'operation'],\n                },\n                options: [],\n                default: '',\n                required: true,\n                description: 'Choose a LifeSpace date field. The node submits calendar-date YYYY-MM-DD values.',\n              },\n              {\n                displayName: 'Date',\n                name: 'value',\n                type: 'dateTime',\n                default: '',\n                description: 'Calendar date. Expressions remain supported; empty values clear nullable fields.',\n              },\n            ],\n          },\n        ],\n      },\n      {\n        displayName: 'Single Relations',\n        name: 'singleRelations',\n        type: 'fixedCollection',\n        default: {},\n        placeholder: 'Add Single Relation',\n        typeOptions: { multipleValues: true },\n        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },\n        options: [\n          {\n            displayName: 'Relation',\n            name: 'relation',\n            values: [\n              {\n                displayName: 'Field Name or ID',\n                name: 'field',\n                type: 'options',\n                typeOptions: {\n                  loadOptionsMethod: 'getSingleRelationFields',\n                  loadOptionsDependsOn: ['spaceId', 'modelRoute', 'operation'],\n                },\n                options: [],\n                default: '',\n                required: true,\n              },\n              {\n                displayName: 'Target Name or ID',\n                name: 'target',\n                type: 'options',\n                typeOptions: {\n                  loadOptionsMethod: 'getRelationTargetsForCurrentField',\n                  loadOptionsDependsOn: ['spaceId', 'modelRoute', '&field'],\n                },\n                options: [],\n                default: '',\n                description: 'Choose an authorized relation target, or use an expression with a stable LifeSpace ID.',\n              },\n            ],\n          },\n        ],\n      },\n      {\n        displayName: 'Multi Relations',\n        name: 'multiRelations',\n        type: 'fixedCollection',\n        default: {},\n        placeholder: 'Add Multi Relation',\n        typeOptions: { multipleValues: true },\n        displayOptions: { show: { resource: ['modelRecord'], operation: ['create', 'update'] } },\n        options: [\n          {\n            displayName: 'Relation',\n            name: 'relation',\n            values: [\n              {\n                displayName: 'Field Name or ID',\n                name: 'field',\n                type: 'options',\n                typeOptions: {\n                  loadOptionsMethod: 'getMultiRelationFields',\n                  loadOptionsDependsOn: ['spaceId', 'modelRoute', 'operation'],\n                },\n                options: [],\n                default: '',\n                required: true,\n              },\n              {\n                displayName: 'Targets Names or IDs',\n                name: 'targets',\n                type: 'multiOptions',\n                typeOptions: {\n                  loadOptionsMethod: 'getRelationTargetsForCurrentField',\n                  loadOptionsDependsOn: ['spaceId', 'modelRoute', '&field'],\n                },\n                options: [],\n                default: [],\n                description: 'Choose authorized relation targets, or use an expression with stable LifeSpace IDs.',\n              },\n            ],\n          },\n        ],\n      },\n`,
    'date/relation UI insertion',
  );

  // Extend the existing Filters fixed collection with type-aware variants while keeping the old filter shape compatible.
  const oldFilterOptions = `        options: [\n          {\n            displayName: 'Filter',\n            name: 'filter',\n            values: [\n              {\n                displayName: 'Field Name or ID',\n                name: 'field',\n                type: 'options',\n                typeOptions: { loadOptionsMethod: 'getFilterableFields' },\n                options: [],\n                default: '',\n                required: true,\n                description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',\n              },\n              {\n                displayName: 'Operator',\n                name: 'operator',\n                type: 'options',\n                options: [\n                  { name: 'Equals', value: 'exact' },\n                  { name: 'From / Greater Than or Equal', value: 'from' },\n                  { name: 'To / Less Than or Equal', value: 'to' },\n                ],\n                default: 'exact',\n                description: 'Range operators are supported only for date, datetime, integer and number fields',\n              },\n              {\n                displayName: 'Value',\n                name: 'value',\n                type: 'string',\n                default: '',\n                required: true,\n                description: 'For enum equality filters, comma-separated values select any listed value. Relation fields use LifeSpace IDs.',\n              },\n            ],\n          },\n        ],`;
  const typedFilterOptions = `        options: [\n          {\n            displayName: 'Text Filter',\n            name: 'text',\n            values: [\n              { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getTextFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },\n              { displayName: 'Value', name: 'value', type: 'string', default: '', required: true },\n            ],\n          },\n          {\n            displayName: 'Enum Filter',\n            name: 'enum',\n            values: [\n              { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getEnumFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },\n              { displayName: 'Values', name: 'values', type: 'multiOptions', typeOptions: { loadOptionsMethod: 'getEnumValuesForCurrentFilter', loadOptionsDependsOn: ['spaceId', 'modelRoute', '&field'] }, options: [], default: [], required: true },\n            ],\n          },\n          {\n            displayName: 'Boolean Filter',\n            name: 'boolean',\n            values: [\n              { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getBooleanFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },\n              { displayName: 'Value', name: 'value', type: 'boolean', default: true },\n            ],\n          },\n          {\n            displayName: 'Number Filter',\n            name: 'number',\n            values: [\n              { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getNumericFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },\n              { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },\n              { displayName: 'Value', name: 'value', type: 'number', default: 0, required: true },\n            ],\n          },\n          {\n            displayName: 'Date / Time Filter',\n            name: 'temporal',\n            values: [\n              { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getTemporalFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },\n              { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },\n              { displayName: 'Value', name: 'value', type: 'dateTime', default: '', required: true },\n            ],\n          },\n          {\n            displayName: 'Person Filter',\n            name: 'person',\n            values: [\n              { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getPersonFilterableFields', loadOptionsDependsOn: ['spaceId', 'modelRoute'] }, options: [], default: '', required: true },\n              { displayName: 'Person Name or ID', name: 'target', type: 'options', typeOptions: { loadOptionsMethod: 'getRelationTargetsForCurrentField', loadOptionsDependsOn: ['spaceId', 'modelRoute', '&field'] }, options: [], default: '', required: true },\n            ],\n          },\n          {\n            displayName: 'Raw / Legacy Filter',\n            name: 'filter',\n            values: [\n              { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getFilterableFields' }, options: [], default: '', required: true, description: 'Compatibility and unsupported relation escape hatch. Prefer the typed filter variants above.' },\n              { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },\n              { displayName: 'Value', name: 'value', type: 'string', default: '', required: true },\n            ],\n          },\n        ],`;
  content = once(content, oldFilterOptions, typedFilterOptions, 'typed filter UI');

  // Action options must refresh when its upstream selectors change.
  content = once(
    content,
    `        typeOptions: {\n          loadOptionsMethod: 'getActions',\n        },`,
    `        typeOptions: {\n          loadOptionsMethod: 'getActions',\n          loadOptionsDependsOn: ['spaceId', 'modelRoute'],\n        },`,
    'Action loadOptions dependency',
  );

  // Human-readable Space name from Core 0.24, with 0.23 raw-ID fallback.
  content = once(
    content,
    `        return discovery.data.spaces.map((space) => ({\n          name: space.spaceId,\n          value: space.spaceId,\n          description: \`${'${space.models.length}'} available Record Type${'${space.models.length === 1 ? \'\' : \'s\'}'}\`,\n        }));`,
    `        return discovery.data.spaces.map((space) => ({\n          name: space.spaceName?.trim() || space.spaceId,\n          value: space.spaceId,\n          description: \`${'${space.spaceId}'} · ${'${space.models.length}'} available Record Type${'${space.models.length === 1 ? \'\' : \'s\'}'}\`,\n        }));`,
    'Space display label',
  );

  // Insert generic field-option loaders before getSortableFields.
  const sortableMarker = `      async getSortableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {`;
  if (!content.includes(sortableMarker)) throw new Error('Missing sortable loader marker');
  const loaderBlock = `      async getWritableDateFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();\n        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();\n        if (!spaceId || !modelRoute) return [];\n        const operation = String(this.getNodeParameter('operation', 'create'));\n        const discovery = await loadRuntimeDiscovery.call(this);\n        const model = discoveryModel(discovery, spaceId, modelRoute);\n        if (!model) return [];\n        return model.fields\n          .filter((field) => field.type === 'date' && !field.readOnly && (operation !== 'update' || !field.immutable))\n          .map((field) => ({ name: field.title?.trim() || humanizeKey(field.key), value: field.key, description: field.description }));\n      },\n      async getSingleRelationFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        return relationFieldOptions(this, 'one', false);\n      },\n      async getMultiRelationFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        return relationFieldOptions(this, 'many', false);\n      },\n      async getRelationTargetsForCurrentField(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();\n        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();\n        const fieldKey = String(this.getCurrentNodeParameter('&field') ?? '').trim();\n        if (!spaceId || !modelRoute || !fieldKey) return [];\n        const discovery = await loadRuntimeDiscovery.call(this);\n        const model = discoveryModel(discovery, spaceId, modelRoute);\n        const field = model?.fields.find((entry) => entry.key === fieldKey);\n        if (!model || !field) return [];\n        const targets = await loadRelationTargets(this, spaceId, model.key, field);\n        return (targets ?? []).map((target) => ({ name: target.label, value: target.id }));\n      },\n      async getTextFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        return filterFieldOptions(this, ['string', 'text', 'timezone']);\n      },\n      async getEnumFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        return filterFieldOptions(this, ['enum']);\n      },\n      async getBooleanFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        return filterFieldOptions(this, ['boolean']);\n      },\n      async getNumericFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        return filterFieldOptions(this, ['integer', 'number']);\n      },\n      async getTemporalFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        return filterFieldOptions(this, ['date', 'datetime'], true);\n      },\n      async getPersonFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        return relationFieldOptions(this, undefined, true);\n      },\n      async getEnumValuesForCurrentFilter(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n        const spaceId = String(this.getNodeParameter('spaceId', '')).trim();\n        const modelRoute = String(this.getNodeParameter('modelRoute', '')).trim();\n        const fieldKey = String(this.getCurrentNodeParameter('&field') ?? '').trim();\n        if (!spaceId || !modelRoute || !fieldKey) return [];\n        const discovery = await loadRuntimeDiscovery.call(this);\n        const field = discoveryModel(discovery, spaceId, modelRoute)?.fields.find((entry) => entry.key === fieldKey);\n        return field?.type === 'enum' ? (field.values ?? []).map((value) => ({ name: value, value })) : [];\n      },\n`;
  content = content.replace(sortableMarker, `${loaderBlock}${sortableMarker}`);

  // Supported dynamic relations and date-only fields move out of Resource Mapper into native n8n controls.
  content = once(
    content,
    `        const writableFields = model.fields\n          .filter((field) => !field.readOnly && (operation !== 'update' || !field.immutable));\n        const fields = await Promise.all(writableFields.map(async (field) => {\n          const relationTargets = await loadRelationTargets(this, spaceId, model.key, field);\n          return mapperField(\n            field,\n            operation === 'create' && field.required === true && !hasServerDefault(model, field.key),\n            relationTargets ?? undefined,\n          );\n        }));\n\n        return { fields };`,
    `        const writableFields = model.fields\n          .filter((field) => !field.readOnly && (operation !== 'update' || !field.immutable))\n          .filter((field) => field.type !== 'date')\n          .filter((field) => field.relation?.lookup.supported !== true);\n        const fields = writableFields.map((field) => mapperField(\n          field,\n          operation === 'create' && field.required === true && !hasServerDefault(model, field.key),\n        ));\n\n        return { fields };`,
    'Resource Mapper special-field exclusion',
  );

  // Mutations now merge scalar mapper + date picker + relation selectors.
  content = once(
    content,
    `                body: mappedValue(this, itemIndex, 'fields'),`,
    `                body: mutationMappedValues(this, itemIndex),`,
    'create merged body',
  );
  content = once(
    content,
    `                  ...mappedValue(this, itemIndex, 'fields'),`,
    `                  ...mutationMappedValues(this, itemIndex),`,
    'update merged body',
  );

  // Replace the legacy filter processing block with typed + backwards-compatible groups.
  const oldFilterLoop = `  const usedKeys = new Set<string>();\n  for (const filter of filters) {\n    const field = String(filter.field ?? '').trim();\n    const value = String(filter.value ?? '');\n    const operator = filter.operator ?? 'exact';\n    if (!field || value === '') continue;\n    const key = operator === 'from' ? \`${'${field}'}From\` : operator === 'to' ? \`${'${field}'}To\` : field;\n    if (usedKeys.has(key)) {\n      throw new NodeOperationError(context.getNode(), \`Query filter ${'${key}'} may be supplied only once\`, { itemIndex });\n    }\n    usedKeys.add(key);\n    qs[key] = value;\n  }`;
  const newFilterLoop = `  const usedKeys = new Set<string>();\n  const setFilter = (field: string, operator: 'exact' | 'from' | 'to', value: string | number | boolean) => {\n    const key = operator === 'from' ? \`${'${field}'}From\` : operator === 'to' ? \`${'${field}'}To\` : field;\n    if (usedKeys.has(key)) {\n      throw new NodeOperationError(context.getNode(), \`Query filter ${'${key}'} may be supplied only once\`, { itemIndex });\n    }\n    usedKeys.add(key);\n    qs[key] = typeof value === 'boolean' ? String(value) : value;\n  };\n\n  for (const filter of filters) {\n    const field = String(filter.field ?? '').trim();\n    const value = String(filter.value ?? '');\n    const operator = filter.operator ?? 'exact';\n    if (field && value !== '') setFilter(field, operator, value);\n  }\n\n  const typedFilters = context.getNodeParameter('filters', itemIndex, {}) as IDataObject;\n  for (const row of (typedFilters.text ?? []) as Array<{ field?: unknown; value?: unknown }>) {\n    const field = String(row.field ?? '').trim();\n    if (field && row.value !== undefined && row.value !== '') setFilter(field, 'exact', String(row.value));\n  }\n  for (const row of (typedFilters.enum ?? []) as Array<{ field?: unknown; values?: unknown }>) {\n    const field = String(row.field ?? '').trim();\n    const values = Array.isArray(row.values) ? row.values.map(String).filter(Boolean) : [];\n    if (field && values.length) setFilter(field, 'exact', values.join(','));\n  }\n  for (const row of (typedFilters.boolean ?? []) as Array<{ field?: unknown; value?: unknown }>) {\n    const field = String(row.field ?? '').trim();\n    if (field) setFilter(field, 'exact', Boolean(row.value));\n  }\n  for (const row of (typedFilters.number ?? []) as Array<{ field?: unknown; operator?: 'exact' | 'from' | 'to'; value?: unknown }>) {\n    const field = String(row.field ?? '').trim();\n    const value = Number(row.value);\n    if (field && Number.isFinite(value)) setFilter(field, row.operator ?? 'exact', value);\n  }\n  for (const row of (typedFilters.temporal ?? []) as Array<{ field?: unknown; operator?: 'exact' | 'from' | 'to'; value?: unknown }>) {\n    const encoded = String(row.field ?? '').trim();\n    if (!encoded || row.value === undefined || row.value === '') continue;\n    const separator = encoded.indexOf(':');\n    const fieldType = separator > 0 ? encoded.slice(0, separator) : 'datetime';\n    const field = separator > 0 ? encoded.slice(separator + 1) : encoded;\n    const raw = String(row.value);\n    const value = fieldType === 'date' ? dateOnlyValue(context, itemIndex, raw, field) : raw;\n    if (value !== null) setFilter(field, row.operator ?? 'exact', value);\n  }\n  for (const row of (typedFilters.person ?? []) as Array<{ field?: unknown; target?: unknown }>) {\n    const field = String(row.field ?? '').trim();\n    const target = String(row.target ?? '').trim();\n    if (field && target) setFilter(field, 'exact', target);\n  }`;
  content = once(content, oldFilterLoop, newFilterLoop, 'typed filter query serialization');

  write(path, content);
}

// Add reusable option helpers immediately after humanizeKey so node code stays model-generic.
{
  const path = 'nodes/lifespaceDiscovery.ts';
  let content = read(path);
  const marker = `export function humanizeKey(key: string): string {`;
  if (!content.includes(marker)) throw new Error('humanizeKey marker missing');
  // Helpers belong in the node file because they depend on n8n UI context, not LifeSpace semantics.
}

// Add n8n-only option helper functions to the node source before the class.
{
  const path = 'nodes/LifeSpace/LifeSpace.node.ts';
  let content = read(path);
  const marker = `export class LifeSpace implements INodeType {`;
  if (!content.includes(marker)) throw new Error('LifeSpace class marker missing');
  const helpers = `async function optionModel(context: ILoadOptionsFunctions): Promise<{ model: DiscoveryModel; spaceId: string } | null> {\n  const spaceId = String(context.getNodeParameter('spaceId', '')).trim();\n  const modelRoute = String(context.getNodeParameter('modelRoute', '')).trim();\n  if (!spaceId || !modelRoute) return null;\n  const discovery = await loadRuntimeDiscovery.call(context);\n  const model = discoveryModel(discovery, spaceId, modelRoute);\n  return model ? { model, spaceId } : null;\n}\n\nasync function filterFieldOptions(\n  context: ILoadOptionsFunctions,\n  types: DiscoveryField['type'][],\n  encodeType = false,\n): Promise<INodePropertyOptions[]> {\n  const selected = await optionModel(context);\n  if (!selected) return [];\n  const allowed = new Set(selected.model.query.filterable);\n  return selected.model.fields\n    .filter((field) => allowed.has(field.key) && types.includes(field.type))\n    .map((field) => ({\n      name: field.title?.trim() || humanizeKey(field.key),\n      value: encodeType ? \`${'${field.type}'}:${'${field.key}'}\` : field.key,\n      description: field.description,\n    }));\n}\n\nasync function relationFieldOptions(\n  context: ILoadOptionsFunctions,\n  cardinality?: 'one' | 'many',\n  filterableOnly = false,\n): Promise<INodePropertyOptions[]> {\n  const selected = await optionModel(context);\n  if (!selected) return [];\n  const operation = String(context.getNodeParameter('operation', 'create'));\n  const filterable = new Set(selected.model.query.filterable);\n  return selected.model.fields\n    .filter((field) => field.relation?.lookup.supported === true)\n    .filter((field) => cardinality === undefined || field.relation?.cardinality === cardinality)\n    .filter((field) => !filterableOnly || filterable.has(field.key))\n    .filter((field) => filterableOnly || (!field.readOnly && (operation !== 'update' || !field.immutable)))\n    .map((field) => ({ name: field.title?.trim() || humanizeKey(field.key), value: field.key, description: field.description }));\n}\n\n`;
  content = content.replace(marker, `${helpers}${marker}`);
  write(path, content);
}

// Contract tests: real UI behavior, not just Resource Mapper metadata.
{
  const path = 'test/contract.test.mjs';
  let content = read(path);
  content = once(
    content,
    `          spaceId: 'spc_test',\n          models: [`,
    `          spaceId: 'spc_test',\n          spaceName: 'Test Space',\n          models: [`,
    'fixture Space label',
  );
  content = once(
    content,
    `    getNodeParameter(name, defaultValue) {\n      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;\n    },`,
    `    getNodeParameter(name, defaultValue) {\n      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;\n    },\n    getCurrentNodeParameter(name) {\n      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : undefined;\n    },`,
    'load-options current parameter support',
  );
  content = once(
    content,
    `  assert.deepEqual(spaces.map((item) => item.value), ['spc_test', 'spc_read_only']);`,
    `  assert.deepEqual(spaces.map((item) => [item.name, item.value]), [\n    ['Test Space', 'spc_test'],\n    ['spc_read_only', 'spc_read_only'],\n  ]);`,
    'Space label test',
  );
  content = once(
    content,
    `  assert.deepEqual(fields.fields.map((field) => [field.id, field.required]), [\n    ['name', true],\n    ['priority', false],\n    ['dueDate', false],\n  ]);`,
    `  assert.deepEqual(fields.fields.map((field) => [field.id, field.required]), [\n    ['name', true],\n    ['priority', false],\n  ]);\n\n  const dates = await node.methods.loadOptions.getWritableDateFields.call(\n    loadOptionsContext(discoveryFixture(), { spaceId: 'spc_test', modelRoute: 'tasks', operation: 'create' }),\n  );\n  assert.deepEqual(dates.map((field) => field.value), ['dueDate']);`,
    'date mapping test',
  );
  // New typed filter serialization test after the existing legacy filter test.
  const legacyTestEnd = `  assert.deepEqual(context.calls[0].options, {\n    method: 'GET',\n    url: \`${'${BASE_URL}'}/spaces/spc_test/tasks\`,\n    qs: {\n      q: 'milk',\n      limit: 25,\n      status: 'pending',\n      dueDateFrom: '2026-09-01',\n    },\n    json: true,\n  });\n});\n`;
  if (!content.includes(legacyTestEnd)) throw new Error('Legacy list test end missing');
  content = content.replace(legacyTestEnd, `${legacyTestEnd}\ntest('Typed filters serialize enum, boolean, number and calendar-date values through the Generic Query contract', async () => {\n  const node = new LifeSpace();\n  const discovery = discoveryFixture();\n  const task = discovery.data.spaces[0].models[0];\n  task.fields.push({ key: 'flagged', type: 'boolean', title: 'Flagged' }, { key: 'score', type: 'number', title: 'Score' });\n  task.query.filterable.push('flagged', 'score');\n  const context = executeContext(\n    {\n      resource: 'modelRecord', operation: 'list', spaceId: 'spc_test', modelRoute: 'tasks', search: '',\n      returnAll: false, limit: 10, options: {}, 'filters.filter': [],\n      filters: {\n        enum: [{ field: 'status', values: ['pending', 'completed'] }],\n        boolean: [{ field: 'flagged', value: false }],\n        number: [{ field: 'score', operator: 'from', value: 3.5 }],\n        temporal: [{ field: 'date:dueDate', operator: 'to', value: '2026-09-30T00:00:00.000+08:00' }],\n      },\n    },\n    () => ({ data: { items: [], nextCursor: null } }),\n  );\n  await node.execute.call(context);\n  assert.deepEqual(context.calls[0].options.qs, {\n    limit: 10, status: 'pending,completed', flagged: 'false', scoreFrom: 3.5, dueDateTo: '2026-09-30',\n  });\n});\n`);

  // Replace the obsolete Resource Mapper relation test with native n8n selector coverage.
  const start = content.indexOf(`test('LifeSpace 0.23 Person relations render canonical target labels instead of raw IDs'`);
  const next = content.indexOf(`test('Person relation fields keep raw-ID fallback when Runtime Discovery has no lookup contract'`, start);
  if (start < 0 || next < 0) throw new Error('Relation selector tests not found');
  const relationTest = `test('LifeSpace Person relations use native single/multi selectors backed by source-field-aware lookup', async () => {\n  const node = new LifeSpace();\n  const discovery = discoveryFixture();\n  const task = discovery.data.spaces[0].models[0];\n  const lookup = { supported: true, method: 'GET', pathTemplate: '/api/v1/spaces/{spaceId}/_relation-targets/{modelKey}/{fieldKey}', searchParameter: 'q', cursorParameter: 'cursor', limitParameter: 'limit' };\n  task.fields.push(\n    { key: 'ownerPersonId', type: 'person', title: 'Owner', relation: { targetModel: 'person', cardinality: 'one', lookup } },\n    { key: 'assigneePersonIds', type: 'person_list', title: 'Assignees', relation: { targetModel: 'person', cardinality: 'many', lookup } },\n    { key: 'parentTaskId', type: 'record', title: 'Parent Task', targetModel: 'task', relation: { targetModel: 'task', cardinality: 'one', lookup: { supported: false, reason: 'reference-label-unavailable' } } },\n  );\n  const parameters = { spaceId: 'spc_test', modelRoute: 'tasks', operation: 'create', '&field': 'assigneePersonIds' };\n  const context = loadOptionsContext(discovery, parameters);\n  context.helpers = {\n    async httpRequestWithAuthentication(_credentialName, options) {\n      if (options.url === \`${'${BASE_URL}'}/me/_discovery\`) return discovery;\n      assert.equal(options.url, \`${'${BASE_URL}'}/spaces/spc_test/_relation-targets/task/assigneePersonIds\`);\n      return { data: { items: [{ id: 'per_alpha', label: 'Alpha Person' }, { id: 'per_beta', label: 'Beta Person' }], nextCursor: null } };\n    },\n  };\n  const singles = await node.methods.loadOptions.getSingleRelationFields.call(context);\n  const multiples = await node.methods.loadOptions.getMultiRelationFields.call(context);\n  const targets = await node.methods.loadOptions.getRelationTargetsForCurrentField.call(context);\n  const fields = await node.methods.resourceMapping.getRecordFields.call(context);\n  assert.deepEqual(singles.map((entry) => entry.value), ['ownerPersonId']);\n  assert.deepEqual(multiples.map((entry) => entry.value), ['assigneePersonIds']);\n  assert.deepEqual(targets, [{ name: 'Alpha Person', value: 'per_alpha' }, { name: 'Beta Person', value: 'per_beta' }]);\n  assert.equal(fields.fields.some((field) => field.id === 'ownerPersonId'), false);\n  assert.equal(fields.fields.some((field) => field.id === 'assigneePersonIds'), false);\n  assert.equal(fields.fields.find((field) => field.id === 'parentTaskId').type, 'string');\n});\n\n`;
  content = content.slice(0, start) + relationTest + content.slice(next);

  // Update create relation payload test to the native multiOptions-backed parameter shape and include date normalization.
  content = once(
    content,
    `      'fields.value': {\n        name: 'Shared task',\n        assigneePersonIds: ['per_alpha', 'per_beta'],\n      },`,
    `      'fields.value': { name: 'Shared task' },\n      'dateFields.date': [{ field: 'dueDate', value: '2026-09-30T00:00:00.000+08:00' }],\n      'multiRelations.relation': [{ field: 'assigneePersonIds', targets: ['per_alpha', 'per_beta'] }],`,
    'create special mappings input',
  );
  content = once(
    content,
    `    name: 'Shared task',\n    assigneePersonIds: ['per_alpha', 'per_beta'],`,
    `    name: 'Shared task',\n    dueDate: '2026-09-30',\n    assigneePersonIds: ['per_alpha', 'per_beta'],`,
    'create special mappings payload',
  );
  write(path, content);
}

// Lock the actual n8n UI boundary and Action refresh dependency in source-level tests.
{
  const path = 'test/source-contract.test.mjs';
  let content = read(path);
  content = once(
    content,
    `  assert.match(discovery, /relation\\?: DiscoveryRelation/u);`,
    `  assert.match(discovery, /spaceName\\?: string \\| null/u);\n  assert.match(discovery, /relation\\?: DiscoveryRelation/u);`,
    'spaceName source contract',
  );
  content = once(
    content,
    `  assert.match(node, /loadRelationTargets\\(this, spaceId, model\\.key, field\\)/u);`,
    `  assert.match(node, /name: 'dateFields'[\\s\\S]{0,900}type: 'dateTime'/u);\n  assert.match(node, /name: 'multiRelations'[\\s\\S]{0,1400}type: 'multiOptions'/u);\n  assert.match(node, /getCurrentNodeParameter\\('&field'\\)/u);\n  assert.match(node, /loadRelationTargets\\(this, spaceId, model\\.key, field\\)/u);\n  assert.match(node, /name: 'actionKey'[\\s\\S]{0,260}loadOptionsDependsOn: \\['spaceId', 'modelRoute'\\]/u);`,
    'typed UX source contract',
  );
  write(path, content);
}

// README compatibility/UX notes: 0.24 labels are additive; 0.23 remains functional with raw IDs.
{
  const path = 'README.md';
  let content = read(path);
  const marker = '## Compatibility';
  if (!content.includes(marker)) throw new Error('README compatibility marker missing');
  content = content.replace(marker, `## Generated Record UX\n\nCreate/Update now keep scalar fields in n8n Resource Mapper while using native n8n controls for LifeSpace calendar-date fields and supported relations. ` +
    `Single Person relations use a selector; multi-Person relations use multi-select. List / Query offers typed filter variants for text, enum, boolean, number, date/time and authorized Person relations, while retaining the raw legacy filter as an expression/compatibility escape hatch.\n\nCore Kernel 0.24 adds the optional human-readable ` + '`spaceName`' + ` Runtime Discovery projection. The node displays it when present and continues to submit the stable ` + '`spc_*`' + ` ID; Core 0.23 remains compatible and falls back to displaying the raw Space ID.\n\n${marker}`);
  write(path, content);
}

console.log('Typed Runtime Discovery UX patch applied');
