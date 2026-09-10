import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, value) => fs.writeFileSync(path, value);

function replaceOnce(text, oldText, newText, path) {
  const first = text.indexOf(oldText);
  if (first < 0) throw new Error(`${path}: replacement anchor not found: ${oldText.slice(0, 120)}`);
  const second = text.indexOf(oldText, first + oldText.length);
  if (second >= 0) throw new Error(`${path}: replacement anchor is not unique: ${oldText.slice(0, 120)}`);
  return `${text.slice(0, first)}${newText}${text.slice(first + oldText.length)}`;
}

function updateText(path, transform) {
  const before = read(path);
  const after = transform(before);
  if (after === before) throw new Error(`${path}: transform made no change`);
  write(path, after);
}

updateText('nodes/lifespaceDiscovery.ts', (text) => {
  text = replaceOnce(
    text,
    "export type DiscoveryModel = {\n",
    `export type DiscoveryComparisonOperator = 'eq' | 'lt' | 'lte' | 'gt' | 'gte';

export type DiscoveryComparisonTransport = {
  operator: DiscoveryComparisonOperator;
  parameter: string;
  transport: 'legacy' | 'explicit';
};

export type DiscoveryLocalDateWindow = {
  dateStartParameter: string;
  dateEndExclusiveParameter: string;
  timezoneParameter: string;
  bounds: '[)';
  lowerOperator: 'gte';
  upperOperator: 'lt';
};

export type DiscoveryComparison = {
  field: string;
  source: 'model' | 'envelope';
  valueType: 'date' | 'datetime' | 'integer' | 'number';
  operators: DiscoveryComparisonTransport[];
  localDateWindow?: DiscoveryLocalDateWindow;
};

export type DiscoveryCapabilityQueryParameter = {
  parameter: string;
  type: 'string' | 'boolean' | 'integer' | 'number' | 'date' | 'datetime' | 'timezone';
  required?: boolean;
  role?: string;
  default?: unknown;
};

export type DiscoveryCapabilityQuery = {
  key: string;
  capability: string;
  semantics: string;
  recurrenceExpansion?: boolean;
  parameters: DiscoveryCapabilityQueryParameter[];
  ordering?: {
    parameter: string;
    values: string[];
    default?: string;
    [key: string]: unknown;
  };
};

export type DiscoveryModel = {
`,
    'nodes/lifespaceDiscovery.ts',
  );
  text = replaceOnce(
    text,
    `  query: {
    searchable: string[];
    filterable: string[];
    sortable: string[];
    sort: {
      parameter: 'sort';
      syntax: 'field:direction';
      repeatable: true;
      ordered: true;
      maxCriteria: number;
      default: string[];
      envelopeFields: string[];
    };
  };
`,
    `  query: {
    searchable: string[];
    filterable: string[];
    sortable: string[];
    comparisons?: DiscoveryComparison[];
    capabilityQueries?: DiscoveryCapabilityQuery[];
    sort: {
      parameter: 'sort';
      syntax: 'field:direction';
      repeatable: true;
      ordered: true;
      maxCriteria: number;
      default: string[];
      envelopeFields: string[];
    };
  };
`,
    'nodes/lifespaceDiscovery.ts',
  );
  text = replaceOnce(
    text,
    `  query: {
    searchable: string[];
    filterable: string[];
    sortable: string[];
    sort: {
      parameter: 'sort';
      syntax: 'field:direction';
      repeatable: true;
      ordered: true;
      maxCriteria: number;
      genericDefault: string[];
      envelopeFields: string[];
    };
  };
`,
    `  query: {
    searchable: string[];
    filterable: string[];
    sortable: string[];
    comparisons?: DiscoveryComparison[];
    capabilityQueries?: DiscoveryCapabilityQuery[];
    sort: {
      parameter: 'sort';
      syntax: 'field:direction';
      repeatable: true;
      ordered: true;
      maxCriteria: number;
      genericDefault: string[];
      envelopeFields: string[];
    };
  };
`,
    'nodes/lifespaceDiscovery.ts',
  );
  text = replaceOnce(
    text,
    `      searchable: [],
      filterable: [],
      sortable: [],
      sort: {
`,
    `      searchable: [],
      filterable: [],
      sortable: [],
      comparisons: [],
      capabilityQueries: [],
      sort: {
`,
    'nodes/lifespaceDiscovery.ts',
  );
  text = replaceOnce(
    text,
    `      searchable: detail.query.searchable,
      filterable: detail.query.filterable,
      sortable: detail.query.sortable,
      sort: {
`,
    `      searchable: detail.query.searchable,
      filterable: detail.query.filterable,
      sortable: detail.query.sortable,
      comparisons: detail.query.comparisons ?? [],
      capabilityQueries: detail.query.capabilityQueries ?? [],
      sort: {
`,
    'nodes/lifespaceDiscovery.ts',
  );
  return text;
});

updateText('nodes/LifeSpace/LifeSpace.node.ts', (text) => {
  text = replaceOnce(
    text,
    `  type DiscoveryAction,
  type DiscoveryField,
  type DiscoveryModel,
  type RelationTarget,
`,
    `  type DiscoveryAction,
  type DiscoveryCapabilityQueryParameter,
  type DiscoveryComparison,
  type DiscoveryField,
  type DiscoveryModel,
  type RelationTarget,
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `type QueryFilter = {
  field?: string;
  operator?: 'exact' | 'from' | 'to';
  value?: string;
};

type QuerySort = {
`,
    `type QueryFilter = {
  field?: string;
  operator?: 'exact' | 'from' | 'to';
  value?: string;
};

type QueryComparison = {
  field?: string;
  parameter?: string;
  value?: unknown;
};

type QueryLocalDateWindow = {
  field?: string;
  dateStart?: unknown;
  dateEndExclusive?: unknown;
  timezone?: unknown;
};

type QuerySort = {
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `const LEGACY_MODEL_ROUTE_TO_KEY: Readonly<Record<string, string>> = Object.freeze({
  tasks: 'task',
  wishes: 'wish',
  'day-records': 'day_record',
  events: 'event',
});

function parseJsonObject(
`,
    `const LEGACY_MODEL_ROUTE_TO_KEY: Readonly<Record<string, string>> = Object.freeze({
  tasks: 'task',
  wishes: 'wish',
  'day-records': 'day_record',
  events: 'event',
});
const LOCAL_DATE_WINDOW_SELECTOR_PREFIX = 'lsqw1.';

const COMPARISON_OPERATOR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  eq: 'Equals',
  lt: 'Less Than',
  lte: 'Less Than or Equal',
  gt: 'Greater Than',
  gte: 'Greater Than or Equal',
});

type LocalDateWindowSelector = {
  field: string;
  valueType: 'datetime';
  dateStartParameter: string;
  dateEndExclusiveParameter: string;
  timezoneParameter: string;
};

function comparisonFieldParts(value: unknown): { field: string; valueType: string } {
  const raw = String(value ?? '').trim();
  const separator = raw.indexOf(':');
  if (separator <= 0) return { field: raw, valueType: '' };
  return { valueType: raw.slice(0, separator), field: raw.slice(separator + 1) };
}

function encodeLocalDateWindowSelector(comparison: DiscoveryComparison): string {
  const window = comparison.localDateWindow;
  if (!window || comparison.valueType !== 'datetime') return '';
  return `${LOCAL_DATE_WINDOW_SELECTOR_PREFIX}${Buffer.from(JSON.stringify([
    comparison.field,
    comparison.valueType,
    window.dateStartParameter,
    window.dateEndExclusiveParameter,
    window.timezoneParameter,
  ])).toString('base64url')}`;
}

function decodeLocalDateWindowSelector(value: unknown): LocalDateWindowSelector | null {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith(LOCAL_DATE_WINDOW_SELECTOR_PREFIX)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw.slice(LOCAL_DATE_WINDOW_SELECTOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 5 || decoded.some((entry) => typeof entry !== 'string' || !entry)) return null;
    if (decoded[1] !== 'datetime') return null;
    return {
      field: decoded[0],
      valueType: 'datetime',
      dateStartParameter: decoded[2],
      dateEndExclusiveParameter: decoded[3],
      timezoneParameter: decoded[4],
    };
  } catch {
    return null;
  }
}

function semanticQueryMapperType(parameter: DiscoveryCapabilityQueryParameter): FieldType {
  if (parameter.type === 'boolean') return 'boolean';
  if (parameter.type === 'integer' || parameter.type === 'number') return 'number';
  return 'string';
}

function semanticQueryMapperField(parameter: DiscoveryCapabilityQueryParameter) {
  return {
    id: parameter.parameter,
    displayName: humanizeKey(parameter.role?.trim() || parameter.parameter),
    required: parameter.required === true,
    defaultMatch: false,
    canBeUsedToMatch: false,
    display: true,
    type: semanticQueryMapperType(parameter),
    description: `${parameter.type}${parameter.role ? ` · ${parameter.role}` : ''} · LifeSpace query parameter ${parameter.parameter}`,
  };
}

function parseJsonObject(
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `  const configuredSorts = context.getNodeParameter('sorts.sort', itemIndex, []) as QuerySort[];
  const legacySortField = String(options.sortField ?? '').trim();
`,
    `  const configuredSorts = context.getNodeParameter('sorts.sort', itemIndex, []) as QuerySort[];
  const semanticSort = String(context.getNodeParameter('semanticSort', itemIndex, '') ?? '').trim();
  const legacySortField = String(options.sortField ?? '').trim();
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `  if (orderedSorts.length === 1) qs.sort = orderedSorts[0];
  if (orderedSorts.length > 1) qs.sort = orderedSorts;
  if (orderedSorts.length === 0 && legacySortField) qs.sort = `${legacySortField}:${legacySortDirection}`;
`,
    `  if (semanticSort && (orderedSorts.length > 0 || legacySortField)) {
    throw new NodeOperationError(context.getNode(), 'Semantic Sort cannot be combined with field Sorts', { itemIndex });
  }
  if (semanticSort) qs.sort = semanticSort;
  if (!semanticSort && orderedSorts.length === 1) qs.sort = orderedSorts[0];
  if (!semanticSort && orderedSorts.length > 1) qs.sort = orderedSorts;
  if (!semanticSort && orderedSorts.length === 0 && legacySortField) qs.sort = `${legacySortField}:${legacySortDirection}`;
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `  const usedKeys = new Set<string>();
  const setFilter = (field: string, operator: 'exact' | 'from' | 'to', value: string | number | boolean) => {
    const key = operator === 'from' ? `${field}From` : operator === 'to' ? `${field}To` : field;
    if (usedKeys.has(key)) {
      throw new NodeOperationError(context.getNode(), `Query filter ${key} may be supplied only once`, { itemIndex });
    }
    usedKeys.add(key);
    qs[key] = typeof value === 'boolean' ? String(value) : value;
  };
`,
    `  const usedKeys = new Set<string>();
  const setQueryParameter = (key: string, value: string | number | boolean) => {
    if (usedKeys.has(key)) {
      throw new NodeOperationError(context.getNode(), `Query parameter ${key} may be supplied only once`, { itemIndex });
    }
    usedKeys.add(key);
    qs[key] = typeof value === 'boolean' ? String(value) : value;
  };
  const setFilter = (field: string, operator: 'exact' | 'from' | 'to', value: string | number | boolean) => {
    const key = operator === 'from' ? `${field}From` : operator === 'to' ? `${field}To` : field;
    setQueryParameter(key, value);
  };
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `  for (const row of (typedFilters.person ?? []) as Array<{ field?: unknown; target?: unknown }>) {
    const field = String(row.field ?? '').trim();
    const target = String(row.target ?? '').trim();
    if (field && target) setFilter(field, 'exact', target);
  }

  return qs;
}
`,
    `  for (const row of (typedFilters.person ?? []) as Array<{ field?: unknown; target?: unknown }>) {
    const field = String(row.field ?? '').trim();
    const target = String(row.target ?? '').trim();
    if (field && target) setFilter(field, 'exact', target);
  }
  for (const row of (typedFilters.numberComparison ?? []) as QueryComparison[]) {
    const field = comparisonFieldParts(row.field).field;
    const parameter = String(row.parameter ?? '').trim();
    const value = Number(row.value);
    if (field && parameter && Number.isFinite(value)) setQueryParameter(parameter, value);
  }
  for (const row of (typedFilters.temporalComparison ?? []) as QueryComparison[]) {
    const { field, valueType } = comparisonFieldParts(row.field);
    const parameter = String(row.parameter ?? '').trim();
    if (!field || !parameter || row.value === undefined || row.value === '') continue;
    const raw = String(row.value);
    const value = valueType === 'date' ? dateOnlyValue(context, itemIndex, raw, field) : raw;
    if (value !== null) setQueryParameter(parameter, value);
  }

  const localDateWindows = context.getNodeParameter('localDateWindows.window', itemIndex, []) as QueryLocalDateWindow[];
  for (const row of localDateWindows) {
    const selector = decodeLocalDateWindowSelector(row.field);
    if (!selector) {
      if (String(row.field ?? '').trim()) {
        throw new NodeOperationError(context.getNode(), 'Local Date Window selector is invalid. Re-select the field from Runtime Discovery.', { itemIndex });
      }
      continue;
    }
    const dateStart = dateOnlyValue(context, itemIndex, row.dateStart, selector.field);
    const dateEndExclusive = dateOnlyValue(context, itemIndex, row.dateEndExclusive, selector.field);
    const timezone = String(row.timezone ?? '').trim();
    if (dateStart !== null) setQueryParameter(selector.dateStartParameter, dateStart);
    if (dateEndExclusive !== null) setQueryParameter(selector.dateEndExclusiveParameter, dateEndExclusive);
    if (timezone) setQueryParameter(selector.timezoneParameter, timezone);
  }

  const semanticQueryInput = mappedValue(context, itemIndex, 'semanticQueryInput');
  for (const [parameter, value] of Object.entries(semanticQueryInput)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new NodeOperationError(context.getNode(), `Semantic Query parameter ${parameter} must be a scalar value`, { itemIndex });
    }
    setQueryParameter(parameter, value);
  }

  return qs;
}
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `async function relationFieldOptions(
  context: ILoadOptionsFunctions,
`,
    `async function comparisonFieldOptions(
  context: ILoadOptionsFunctions,
  types: DiscoveryComparison['valueType'][],
): Promise<INodePropertyOptions[]> {
  const selected = await optionModel(context);
  if (!selected) return [];
  const allowed = new Set(types);
  return (selected.model.query.comparisons ?? [])
    .filter((comparison) => allowed.has(comparison.valueType))
    .map((comparison) => {
      const field = selected.model.fields.find((entry) => entry.key === comparison.field);
      return {
        name: field?.title?.trim() || humanizeKey(comparison.field),
        value: `${comparison.valueType}:${comparison.field}`,
        description: `${comparison.source} · ${comparison.valueType} · explicit LifeSpace comparison operators`,
      };
    });
}

async function relationFieldOptions(
  context: ILoadOptionsFunctions,
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `          { displayName: 'Date / Time Filter', name: 'temporal', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getTemporalFilterableFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },
            { displayName: 'Value', name: 'value', type: 'dateTime', default: '', required: true },
          ] },
          { displayName: 'Person Filter', name: 'person', values: [
`,
    `          { displayName: 'Date / Time Filter', name: 'temporal', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', typeOptions: { loadOptionsMethod: 'getTemporalFilterableFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Operator', name: 'operator', type: 'options', options: [{ name: 'Equals', value: 'exact' }, { name: 'From / Greater Than or Equal', value: 'from' }, { name: 'To / Less Than or Equal', value: 'to' }], default: 'exact' },
            { displayName: 'Value', name: 'value', type: 'dateTime', default: '', required: true },
          ] },
          { displayName: 'Number Comparison', name: 'numberComparison', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Fields and envelope values advertised by LifeSpace explicit comparison semantics.', typeOptions: { loadOptionsMethod: 'getNumericComparisonFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Operator', name: 'parameter', type: 'options', description: 'The option value is the exact query parameter published by LifeSpace; the adapter does not derive transport names.', typeOptions: { loadOptionsMethod: 'getComparisonOperatorsForCurrentField', loadOptionsDependsOn: ['spaceId', 'recordType', '&field'] }, options: [], default: '', required: true },
            { displayName: 'Value', name: 'value', type: 'number', default: 0, required: true },
          ] },
          { displayName: 'Date / Time Comparison', name: 'temporalComparison', values: [
            { displayName: 'Field Name or ID', name: 'field', type: 'options', description: 'Includes model date/datetime fields plus LifeSpace envelope timestamps such as createdAt/updatedAt when advertised.', typeOptions: { loadOptionsMethod: 'getTemporalComparisonFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true },
            { displayName: 'Operator', name: 'parameter', type: 'options', description: 'Uses the exact explicit comparison transport advertised by LifeSpace.', typeOptions: { loadOptionsMethod: 'getComparisonOperatorsForCurrentField', loadOptionsDependsOn: ['spaceId', 'recordType', '&field'] }, options: [], default: '', required: true },
            { displayName: 'Value', name: 'value', type: 'dateTime', default: '', required: true },
          ] },
          { displayName: 'Person Filter', name: 'person', values: [
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `      {
        displayName: 'Return All', name: 'returnAll', type: 'boolean', default: false,
`,
    `      {
        displayName: 'Local Date Windows', name: 'localDateWindows', type: 'fixedCollection', default: {},
        placeholder: 'Add Local Date Window', typeOptions: { multipleValues: true },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        options: [{ displayName: 'Window', name: 'window', values: [
          { displayName: 'Field Name or ID', name: 'field', type: 'options', typeOptions: { loadOptionsMethod: 'getLocalDateWindowFields', loadOptionsDependsOn: ['spaceId', 'recordType'] }, options: [], default: '', required: true, description: 'Only datetime fields whose published comparison semantics include a local-date-window transport are offered.' },
          { displayName: 'Start Date', name: 'dateStart', type: 'dateTime', default: '', required: true, description: 'Inclusive local calendar start date. The adapter submits YYYY-MM-DD and does not calculate UTC boundaries.' },
          { displayName: 'End Date (Exclusive)', name: 'dateEndExclusive', type: 'dateTime', default: '', required: true, description: 'Exclusive local calendar end date.' },
          { displayName: 'Viewing Timezone', name: 'timezone', type: 'string', default: '', required: true, placeholder: 'Europe/Amsterdam', description: 'IANA timezone passed unchanged to LifeSpace Core.' },
        ] }],
      },
      {
        displayName: 'Semantic Query Name or ID', name: 'semanticQueryKey', type: 'options',
        typeOptions: { loadOptionsMethod: 'getCapabilityQueries', loadOptionsDependsOn: ['spaceId', 'recordType'] },
        options: [], default: '',
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Optional grouped capability query published by LifeSpace, for example Calendar Window. The adapter does not hard-code Event fields.',
      },
      {
        displayName: 'Semantic Query Input', name: 'semanticQueryInput', type: 'resourceMapper',
        default: { mappingMode: 'defineBelow', value: null }, noDataExpression: true,
        typeOptions: {
          loadOptionsDependsOn: ['spaceId', 'recordType', 'semanticQueryKey'],
          resourceMapper: {
            resourceMapperMethod: 'getSemanticQueryInputFields', mode: 'add',
            fieldWords: { singular: 'parameter', plural: 'parameters' }, addAllFields: true, supportAutoMap: false,
            noFieldsError: 'Choose a Semantic Query to load its LifeSpace-published parameters.',
          },
        },
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Parameters are projected directly from query.capabilityQueries. Calendar local dates/timezone are sent to Core unchanged; Core owns overlap and DST semantics.',
      },
      {
        displayName: 'Semantic Sort Name or ID', name: 'semanticSort', type: 'options',
        typeOptions: { loadOptionsMethod: 'getSemanticSorts', loadOptionsDependsOn: ['spaceId', 'recordType', 'semanticQueryKey'] },
        options: [], default: '',
        displayOptions: { show: { resource: ['modelRecord'], operation: ['list'] } },
        description: 'Optional capability-specific sort published with the selected Semantic Query. Do not combine with field Sorts.',
      },
      {
        displayName: 'Return All', name: 'returnAll', type: 'boolean', default: false,
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `      async getTemporalFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return filterFieldOptions(this, ['date', 'datetime'], true); },
      async getPersonFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return relationFieldOptions(this, undefined, true); },
`,
    `      async getTemporalFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return filterFieldOptions(this, ['date', 'datetime'], true); },
      async getNumericComparisonFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return comparisonFieldOptions(this, ['integer', 'number']); },
      async getTemporalComparisonFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return comparisonFieldOptions(this, ['date', 'datetime']); },
      async getComparisonOperatorsForCurrentField(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        const { field } = comparisonFieldParts(this.getCurrentNodeParameter('&field'));
        const comparison = selected?.model.query.comparisons?.find((entry) => entry.field === field);
        return (comparison?.operators ?? [])
          .filter((operator) => operator.transport === 'explicit')
          .map((operator) => ({
            name: COMPARISON_OPERATOR_LABELS[operator.operator] ?? humanizeKey(operator.operator),
            value: operator.parameter,
            description: `${operator.operator} · ${operator.transport} · ${operator.parameter}`,
          }));
      },
      async getLocalDateWindowFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        if (!selected) return [];
        return (selected.model.query.comparisons ?? [])
          .filter((comparison) => comparison.valueType === 'datetime' && comparison.localDateWindow)
          .map((comparison) => {
            const field = selected.model.fields.find((entry) => entry.key === comparison.field);
            return {
              name: field?.title?.trim() || humanizeKey(comparison.field),
              value: encodeLocalDateWindowSelector(comparison),
              description: `${comparison.source} · [start,end) local calendar window · Core resolves timezone/DST`,
            };
          });
      },
      async getCapabilityQueries(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        return (selected?.model.query.capabilityQueries ?? []).map((query) => ({
          name: `${humanizeKey(query.capability)} · ${humanizeKey(query.key)}`,
          value: query.key,
          description: `${query.semantics}${query.recurrenceExpansion === false ? ' · recurrence not expanded' : ''}`,
        }));
      },
      async getSemanticSorts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const selected = await optionModel(this);
        const queryKey = loadOptionParameter(this, 'semanticQueryKey');
        const query = selected?.model.query.capabilityQueries?.find((entry) => entry.key === queryKey);
        return (query?.ordering?.values ?? []).map((value) => ({
          name: value === query?.ordering?.default ? `${value} (Default)` : value,
          value,
          description: `${query?.key ?? 'semantic query'} ordering`,
        }));
      },
      async getPersonFilterableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> { return relationFieldOptions(this, undefined, true); },
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  text = replaceOnce(
    text,
    `      async getActionInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const selected = await optionModel(this);
        const actionKey = loadOptionParameter(this, 'actionKey');
        const action = selected?.model.actions.find((entry) => entry.key === actionKey);
        return action
          ? { fields: action.input.fields.map((field) => mapperField(field, field.required === true)) }
          : { fields: [] };
      },
`,
    `      async getActionInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const selected = await optionModel(this);
        const actionKey = loadOptionParameter(this, 'actionKey');
        const action = selected?.model.actions.find((entry) => entry.key === actionKey);
        return action
          ? { fields: action.input.fields.map((field) => mapperField(field, field.required === true)) }
          : { fields: [] };
      },
      async getSemanticQueryInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        const selected = await optionModel(this);
        const queryKey = loadOptionParameter(this, 'semanticQueryKey');
        const query = selected?.model.query.capabilityQueries?.find((entry) => entry.key === queryKey);
        return query ? { fields: query.parameters.map(semanticQueryMapperField) } : { fields: [] };
      },
`,
    'nodes/LifeSpace/LifeSpace.node.ts',
  );
  return text;
});

updateText('README.md', (text) => {
  text = replaceOnce(
    text,
    'This package follows the current LifeSpace Core Kernel `0.32.0` contract family.',
    'This package follows the current LifeSpace Core Kernel `0.35.0` contract family.',
    'README.md',
  );
  text = replaceOnce(
    text,
    '- `0.32.0`: `modelKey` becomes the sole Runtime address and canonical CRUD/Action paths move under `/models/{modelKey}/records`.\n',
    `- \`0.32.0\`: \`modelKey\` becomes the sole Runtime address and canonical CRUD/Action paths move under \`/models/{modelKey}/records\`.
- \`0.33.0\`: canonical structural \`timeRanges\` become available in progressive semantic detail without implying an overlap query API.
- \`0.34.0\`: explicit \`eq/lt/lte/gt/gte\` comparison transports, first-class \`createdAt\` / \`updatedAt\` envelope comparisons and Core-owned datetime local-date-window conversion become discoverable.
- \`0.35.0\`: grouped \`query.capabilityQueries\` adds the preferred \`calendar.window\` viewing-window query with explicit IANA viewing timezone and deterministic mixed all-day/timed ordering.
`,
    'README.md',
  );
  text = replaceOnce(
    text,
    `The normal UI supports:

- optional **Search**;
- one or more typed **Filters**;
- **Return All** to follow \`nextCursor\` automatically;
- **Limit** when Return All is disabled.
`,
    `The normal UI supports:

- optional **Search**;
- one or more typed **Filters**;
- Discovery-driven explicit **Number Comparison** and **Date / Time Comparison** rows using the exact LifeSpace-published operator transport;
- generic **Local Date Windows** for datetime fields advertised by Time Semantics, including envelope \`createdAt\` / \`updatedAt\`, with local dates + IANA timezone sent unchanged to Core;
- optional grouped **Semantic Query** input generated from \`query.capabilityQueries\` (for example \`calendar.window\`) plus its published semantic ordering;
- **Return All** to follow \`nextCursor\` automatically;
- **Limit** when Return All is disabled.

The adapter never derives explicit comparison parameter names from field naming and never converts local calendar windows to UTC. Those transport names and timezone/DST semantics come from LifeSpace Runtime Semantic Detail. Existing \`exact/from/to\` filters remain available as compatibility UI and preserve the legacy inclusive \`To\` behavior.
`,
    'README.md',
  );
  return text;
});

updateText('test/source-contract.test.mjs', (text) => {
  text = replaceOnce(
    text,
    `  assert.match(discovery, /envelopeFields: string\\[\\]/u);
`,
    `  assert.match(discovery, /envelopeFields: string\\[\\]/u);
  assert.match(discovery, /comparisons\\?: DiscoveryComparison\\[\\]/u);
  assert.match(discovery, /capabilityQueries\\?: DiscoveryCapabilityQuery\\[\\]/u);
`,
    'test/source-contract.test.mjs',
  );
  text = replaceOnce(
    text,
    `  assert.equal((node.match(/noDataExpression: true/gu) ?? []).length, 5);
`,
    `  assert.equal((node.match(/noDataExpression: true/gu) ?? []).length, 6);
`,
    'test/source-contract.test.mjs',
  );
  text = replaceOnce(
    text,
    `  assert.match(node, /name: 'actionInput',[\\s\\S]{0,140}noDataExpression: true/u);
`,
    `  assert.match(node, /name: 'actionInput',[\\s\\S]{0,140}noDataExpression: true/u);
  assert.match(node, /name: 'semanticQueryInput',[\\s\\S]{0,180}noDataExpression: true/u);
`,
    'test/source-contract.test.mjs',
  );
  return text;
});

const timeSemanticsTestPath = 'test/time-query-semantics.test.mjs';
if (fs.existsSync(timeSemanticsTestPath)) throw new Error(`${timeSemanticsTestPath}: already exists`);
write(timeSemanticsTestPath, `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpace } = require('../dist/nodes/LifeSpace/LifeSpace.node.js');

const BASE_URL = 'https://example.invalid/api/v1';

const explicitOperators = (field) => ['eq', 'lt', 'lte', 'gt', 'gte'].map((operator) => ({
  operator,
  parameter: \`${'${field}'}.$\{operator}\`,
  transport: 'explicit',
}));

const inventory = {
  data: {
    semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
    models: [{
      key: 'event', version: 9, schemaHash: 'sha256:synthetic-event-v9',
      display: { singular: 'Event', plural: 'Events' }, capabilities: ['calendar'], actions: [],
    }],
    spaces: [{ spaceId: 'spc_test', spaceName: 'Test Space', models: [{ modelKey: 'event', access: ['read'] }] }],
  },
};

const detail = {
  data: {
    key: 'event', version: 9, schemaHash: 'sha256:synthetic-event-v9',
    display: { singular: 'Event', plural: 'Events' }, description: 'Synthetic Time Semantics fixture.',
    declaredAccess: ['read'],
    fields: [
      { key: 'score', type: 'number', title: 'Score' },
      { key: 'dueDate', type: 'date', title: 'Due Date' },
      { key: 'startsAt', type: 'datetime', title: 'Starts At' },
    ],
    defaults: {},
    query: {
      searchable: [], filterable: ['score', 'dueDate', 'startsAt'], sortable: ['startsAt'],
      comparisons: [
        { field: 'score', source: 'model', valueType: 'number', operators: explicitOperators('score') },
        { field: 'dueDate', source: 'model', valueType: 'date', operators: explicitOperators('dueDate') },
        {
          field: 'startsAt', source: 'model', valueType: 'datetime', operators: explicitOperators('startsAt'),
          localDateWindow: {
            dateStartParameter: 'startsAt.dateStart', dateEndExclusiveParameter: 'startsAt.dateEndExclusive',
            timezoneParameter: 'startsAt.timezone', bounds: '[)', lowerOperator: 'gte', upperOperator: 'lt',
          },
        },
        {
          field: 'createdAt', source: 'envelope', valueType: 'datetime', operators: explicitOperators('createdAt'),
          localDateWindow: {
            dateStartParameter: 'createdAt.dateStart', dateEndExclusiveParameter: 'createdAt.dateEndExclusive',
            timezoneParameter: 'createdAt.timezone', bounds: '[)', lowerOperator: 'gte', upperOperator: 'lt',
          },
        },
        { field: 'updatedAt', source: 'envelope', valueType: 'datetime', operators: explicitOperators('updatedAt') },
      ],
      sort: {
        parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true, maxCriteria: 8,
        genericDefault: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'],
      },
      capabilityQueries: [{
        key: 'calendar.window', capability: 'calendar', semantics: 'record-interval-overlap', recurrenceExpansion: false,
        parameters: [
          { parameter: 'windowStartDate', type: 'date', required: true, role: 'window-start-date' },
          { parameter: 'windowEndDateExclusive', type: 'date', required: true, role: 'window-end-date-exclusive' },
          { parameter: 'viewingTimezone', type: 'timezone', required: true, role: 'viewing-timezone' },
        ],
        ordering: {
          parameter: 'sort', values: ['calendarStart:asc', 'calendarStart:desc'], default: 'calendarStart:asc',
          dateBasis: 'viewing-timezone', allDayPlacement: 'before-timed-within-date', timedOrder: 'instant', tieBreaker: 'record-id-asc',
        },
      }],
    },
    actions: [], capabilities: ['calendar'], capabilityBindings: {},
  },
};

function designContext(parameters = {}) {
  const calls = [];
  return {
    calls,
    getCredentials: async () => ({ baseUrl: \`${'${BASE_URL}'}/\` }),
    getNodeParameter(name, defaultValue) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    getCurrentNodeParameter(name) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : undefined;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    helpers: {
      async httpRequestWithAuthentication(_credentialName, options) {
        calls.push(options);
        if (options.url === \`${'${BASE_URL}'}/me/_discovery/inventory\`) return inventory;
        if (options.url === \`${'${BASE_URL}'}/spaces/spc_test/_discovery/models/event\`) return detail;
        throw new Error(\`Unexpected request $\{options.method\} $\{options.url\}\`);
      },
    },
  };
}

function executeContext(parameters) {
  const calls = [];
  return {
    calls,
    getInputData: () => [{ json: {} }],
    getCredentials: async () => ({ baseUrl: BASE_URL }),
    getNodeParameter(name, _itemIndex, defaultValue) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : defaultValue;
    },
    getNode: () => ({ name: 'LifeSpace' }),
    continueOnFail: () => false,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ credentialName, options });
        return { data: { items: [], nextCursor: null } };
      },
    },
  };
}

function baseListParameters(overrides = {}) {
  return {
    resource: 'modelRecord', operation: 'list', spaceId: 'spc_test', recordType: 'event', search: '',
    returnAll: false, limit: 20, options: {}, 'sorts.sort': [], 'filters.filter': [], filters: {},
    'localDateWindows.window': [], 'semanticQueryInput.value': {}, semanticSort: '',
    ...overrides,
  };
}

test('progressive semantic detail exposes envelope comparisons and exact explicit operator transport', async () => {
  const node = new LifeSpace();
  const fieldsContext = designContext({ spaceId: 'spc_test', recordType: 'event', operation: 'list' });
  const fields = await node.methods.loadOptions.getTemporalComparisonFields.call(fieldsContext);
  assert.deepEqual(fields.map((entry) => entry.value), ['date:dueDate', 'datetime:startsAt', 'datetime:createdAt', 'datetime:updatedAt']);

  const operatorContext = designContext({ spaceId: 'spc_test', recordType: 'event', operation: 'list', '&field': 'datetime:createdAt' });
  const operators = await node.methods.loadOptions.getComparisonOperatorsForCurrentField.call(operatorContext);
  assert.deepEqual(operators.map((entry) => entry.value), ['createdAt.eq', 'createdAt.lt', 'createdAt.lte', 'createdAt.gt', 'createdAt.gte']);
});

test('explicit comparisons persist published parameter names and List execution performs no Discovery request', async () => {
  const node = new LifeSpace();
  const context = executeContext(baseListParameters({
    filters: {
      numberComparison: [{ field: 'number:score', parameter: 'score.lt', value: 7.5 }],
      temporalComparison: [
        { field: 'date:dueDate', parameter: 'dueDate.gte', value: '2026-09-10T00:00:00.000Z' },
        { field: 'datetime:createdAt', parameter: 'createdAt.lt', value: '2026-09-11T00:00:00.000Z' },
      ],
    },
  }));
  await node.execute.call(context);
  assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0].options.url, \`${'${BASE_URL}'}/spaces/spc_test/models/event/records\`);
  assert.deepEqual(context.calls[0].options.qs, {
    limit: 20, 'score.lt': 7.5, 'dueDate.gte': '2026-09-10', 'createdAt.lt': '2026-09-11T00:00:00.000Z',
  });
});

test('local date window selector carries published transport and leaves timezone conversion to Core', async () => {
  const node = new LifeSpace();
  const design = designContext({ spaceId: 'spc_test', recordType: 'event', operation: 'list' });
  const windows = await node.methods.loadOptions.getLocalDateWindowFields.call(design);
  const createdAt = windows.find((entry) => entry.name === 'Created At');
  assert.ok(createdAt);

  const context = executeContext(baseListParameters({
    'localDateWindows.window': [{
      field: createdAt.value,
      dateStart: '2026-09-10T00:00:00.000+02:00',
      dateEndExclusive: '2026-09-11T00:00:00.000+02:00',
      timezone: 'Europe/Amsterdam',
    }],
  }));
  await node.execute.call(context);
  assert.deepEqual(context.calls[0].options.qs, {
    limit: 20,
    'createdAt.dateStart': '2026-09-10',
    'createdAt.dateEndExclusive': '2026-09-11',
    'createdAt.timezone': 'Europe/Amsterdam',
  });
  assert.equal(Object.values(context.calls[0].options.qs).some((value) => String(value).includes('T22:')), false);
});

test('capability query UI is generated from capabilityQueries and execution submits mapper keys unchanged', async () => {
  const node = new LifeSpace();
  const design = designContext({ spaceId: 'spc_test', recordType: 'event', operation: 'list', semanticQueryKey: 'calendar.window' });
  const queries = await node.methods.loadOptions.getCapabilityQueries.call(design);
  assert.deepEqual(queries.map((entry) => entry.value), ['calendar.window']);
  const fields = await node.methods.resourceMapping.getSemanticQueryInputFields.call(design);
  assert.deepEqual(fields.fields.map((field) => [field.id, field.required, field.type]), [
    ['windowStartDate', true, 'string'],
    ['windowEndDateExclusive', true, 'string'],
    ['viewingTimezone', true, 'string'],
  ]);
  const sorts = await node.methods.loadOptions.getSemanticSorts.call(design);
  assert.deepEqual(sorts.map((entry) => entry.value), ['calendarStart:asc', 'calendarStart:desc']);

  const context = executeContext(baseListParameters({
    'semanticQueryInput.value': {
      windowStartDate: '2026-09-10', windowEndDateExclusive: '2026-09-11', viewingTimezone: 'Asia/Shanghai',
    },
    semanticSort: 'calendarStart:desc',
  }));
  await node.execute.call(context);
  assert.equal(context.calls.length, 1);
  assert.deepEqual(context.calls[0].options.qs, {
    sort: 'calendarStart:desc', limit: 20,
    windowStartDate: '2026-09-10', windowEndDateExclusive: '2026-09-11', viewingTimezone: 'Asia/Shanghai',
  });
});

test('legacy exact/from/to filters remain compatible and preserve inclusive To transport', async () => {
  const node = new LifeSpace();
  const context = executeContext(baseListParameters({
    'filters.filter': [
      { field: 'dueDate', operator: 'from', value: '2026-09-01' },
      { field: 'dueDate', operator: 'to', value: '2026-09-30' },
    ],
  }));
  await node.execute.call(context);
  assert.deepEqual(context.calls[0].options.qs, { limit: 20, dueDateFrom: '2026-09-01', dueDateTo: '2026-09-30' });
});
`);

console.log('Time Semantics n8n adapter transform completed');
