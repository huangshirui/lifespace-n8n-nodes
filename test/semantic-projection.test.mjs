import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  mutationFieldSelector,
} = require('../dist/nodes/shared/lifeSpaceAdapterSemantics.js');
const {
  queryPredicateSelector,
  queryPredicates,
} = require('../dist/nodes/shared/lifeSpaceQuerySemantics.js');
const {
  projectMutationValues,
  projectQueryFilters,
} = require('../dist/nodes/LifeSpaceWorkflow/humanProjection.js');
const {
  compileGenericQuery,
  genericQuerySchema,
} = require('../dist/nodes/agent/lifeSpaceGenericQueryTool.js');

function model() {
  return {
    key: 'work_item',
    version: 1,
    schemaHash: 'sha256:test',
    display: { singular: 'Work Item', plural: 'Work Items' },
    description: null,
    access: ['read', 'write'],
    defaults: {},
    fields: [
      { key: 'name', type: 'string', title: 'Name', required: true },
      { key: 'status', type: 'enum', title: 'Status', values: ['todo', 'done'] },
      { key: 'dueDate', type: 'date', title: 'Due Date' },
    ],
    query: {
      searchable: ['name'],
      filterable: ['status', 'dueDate'],
      sortable: ['dueDate'],
      search: { parameter: 'q', minLength: 1, maxLength: 200 },
      filters: [
        { field: 'status', parameter: 'status', mode: 'enum-set' },
      ],
      comparisons: [
        {
          field: 'dueDate', source: 'model', valueType: 'date',
          operators: [
            { operator: 'gte', parameter: 'dueDate.gte', transport: 'explicit' },
            { operator: 'lt', parameter: 'dueDate.lt', transport: 'explicit' },
          ],
        },
        {
          field: 'createdAt', source: 'envelope', valueType: 'datetime',
          operators: [{ operator: 'gte', parameter: 'createdAt.gte', transport: 'explicit' }],
          localDateWindow: {
            dateStartParameter: 'createdAt.dateStart',
            dateEndExclusiveParameter: 'createdAt.dateEndExclusive',
            timezoneParameter: 'createdAt.timezone',
            bounds: '[)', lowerOperator: 'gte', upperOperator: 'lt',
          },
        },
      ],
      capabilityQueries: [],
      sort: {
        parameter: 'sort', syntax: 'field:direction', repeatable: true, ordered: true,
        maxCriteria: 8, default: ['createdAt:desc'], envelopeFields: ['createdAt', 'updatedAt'],
        nullPlacement: 'last', genericValues: ['dueDate:asc', 'dueDate:desc', 'createdAt:desc'],
      },
      pagination: {
        limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
        cursor: { parameter: 'cursor', type: 'string' },
      },
    },
    actions: [],
    capabilities: [],
    capabilityBindings: {},
  };
}

test('human Create projection normalizes date fields while preserving omission', () => {
  const dueDate = model().fields.find((field) => field.key === 'dueDate');
  const name = model().fields.find((field) => field.key === 'name');
  const projected = projectMutationValues({
    [mutationFieldSelector(name)]: 'Buy food',
    [mutationFieldSelector(dueDate)]: '2026-09-13T00:00:00.000+08:00',
  });
  assert.deepEqual(projected, { name: 'Buy food', dueDate: '2026-09-13' });
  assert.equal(Object.hasOwn(projected, 'assignees'), false);
});

test('human Create projection sends only active fields and preserves explicit null', () => {
  const name = model().fields.find((field) => field.key === 'name');
  const status = model().fields.find((field) => field.key === 'status');
  const nameId = mutationFieldSelector(name);
  const statusId = mutationFieldSelector(status);
  const values = { [nameId]: 'Buy food', [statusId]: null };

  const omitted = projectMutationValues(values, [
    { id: nameId, displayName: 'Name', required: true, defaultMatch: false, canBeUsedToMatch: false, display: true, type: 'string', removed: false },
    { id: statusId, displayName: 'Status', required: false, defaultMatch: false, canBeUsedToMatch: false, display: true, type: 'options', removed: true },
  ]);
  assert.deepEqual(omitted, { name: 'Buy food' });

  const explicitNull = projectMutationValues(values, [
    { id: nameId, displayName: 'Name', required: true, defaultMatch: false, canBeUsedToMatch: false, display: true, type: 'string', removed: false },
    { id: statusId, displayName: 'Status', required: false, defaultMatch: false, canBeUsedToMatch: false, display: true, type: 'options', removed: false },
  ]);
  assert.deepEqual(explicitNull, { name: 'Buy food', status: null });
});

test('human Query projection uses semantic predicate IDs and exact published transport', () => {
  const predicates = queryPredicates(model());
  const status = predicates.find((entry) => entry.field === 'status');
  const due = predicates.find((entry) => entry.field === 'dueDate' && entry.operator === 'gte');
  assert.ok(status);
  assert.ok(due);

  const projected = projectQueryFilters({
    [queryPredicateSelector(status)]: 'todo',
    [queryPredicateSelector(due)]: '2026-09-13T00:00:00.000+08:00',
  });
  assert.deepEqual(projected, [
    { field: 'status', operator: 'exact', value: 'todo' },
    { field: 'dueDate.gte', operator: 'exact', value: '2026-09-13' },
  ]);
});

test('Agent generic query schema is semantic and compiles to LifeSpace transport', () => {
  const schema = genericQuerySchema(model());
  assert.ok(schema.properties.filters);
  assert.ok(schema.properties.localDateWindows);
  assert.equal(Object.hasOwn(schema.properties, 'dueDate.gte'), false);

  const qs = compileGenericQuery(model(), {
    search: 'food',
    filters: [
      { field: 'status', operator: 'in', value: ['todo'] },
      { field: 'dueDate', operator: 'gte', value: '2026-09-13' },
    ],
    localDateWindows: [{
      field: 'createdAt',
      dateStart: '2026-09-12',
      dateEndExclusive: '2026-09-13',
      timezone: 'Asia/Shanghai',
    }],
    sort: [{ field: 'dueDate', direction: 'asc' }],
    limit: 20,
  });

  assert.deepEqual(qs, {
    q: 'food',
    status: 'todo',
    'dueDate.gte': '2026-09-13',
    'createdAt.dateStart': '2026-09-12',
    'createdAt.dateEndExclusive': '2026-09-13',
    'createdAt.timezone': 'Asia/Shanghai',
    sort: ['dueDate:asc'],
    limit: 20,
  });
});
