import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { projectHumanFilterBuilder } = require('../dist/nodes/LifeSpaceWorkflow/humanProjection.js');
const { queryPredicateSelector } = require('../dist/nodes/shared/lifeSpaceQuerySemantics.js');

function selector(field, operator, valueType) {
  return queryPredicateSelector({
    field,
    fieldLabel: field,
    operator,
    operatorLabel: operator,
    parameter: field,
    valueType,
    mode: 'scalar',
  });
}

const context = {
  getNode: () => ({ name: 'LifeSpace' }),
};

test('string filter builder lowers A AND (B OR C) into the canonical Boolean AST', () => {
  const filters = projectHumanFilterBuilder(
    context,
    'all',
    [{
      field: 'status', operator: selector('status', 'eq', 'enum'),
      value: 'pending',
    }],
    [{
      match: 'any',
      conditions: {
        condition: [
          {
            field: 'dueDate', operator: selector('dueDate', 'within', 'date'),
            value: JSON.stringify({
              kind: 'local_date_window',
              startDate: '2026-09-18',
              endDateExclusive: '2026-09-25',
              timezone: 'Asia/Shanghai',
            }),
          },
          {
            field: 'dueDate', operator: selector('dueDate', 'isNull', 'date'),
            value: '',
          },
        ],
      },
    }],
  );

  assert.deepEqual(filters, [{
    and: [
      { field: 'status', op: 'eq', value: 'pending' },
      {
        or: [
          {
            field: 'dueDate',
            op: 'within',
            value: {
              kind: 'local_date_window',
              startDate: '2026-09-18',
              endDateExclusive: '2026-09-25',
              timezone: 'Asia/Shanghai',
            },
          },
          { field: 'dueDate', op: 'isNull' },
        ],
      },
    ],
  }]);
});

test('string values are parsed back to canonical number, integer and boolean values', () => {
  const filters = projectHumanFilterBuilder(
    context,
    'all',
    [
      { field: 'score', operator: selector('score', 'gte', 'number'), value: '12.5' },
      { field: 'count', operator: selector('count', 'eq', 'integer'), value: '3' },
      { field: 'enabled', operator: selector('enabled', 'eq', 'boolean'), value: 'true' },
    ],
    [],
  );

  assert.deepEqual(filters, [{
    and: [
      { field: 'score', op: 'gte', value: 12.5 },
      { field: 'count', op: 'eq', value: 3 },
      { field: 'enabled', op: 'eq', value: true },
    ],
  }]);
});

test('TemporalRange JSON strings keep canonical shape and normalize date variants', () => {
  const filters = projectHumanFilterBuilder(
    context,
    'all',
    [{
      field: 'when', operator: selector('when', 'overlaps', 'temporal_range'),
      value: JSON.stringify({
        kind: 'date',
        start: '2026-09-20T00:00:00.000Z',
        endExclusive: '2026-09-22T00:00:00.000Z',
      }),
    }],
    [],
  );

  assert.deepEqual(filters, [{
    field: 'when',
    op: 'overlaps',
    value: {
      kind: 'date',
      start: '2026-09-20',
      endExclusive: '2026-09-22',
    },
  }]);
});

test('invalid typed string values fail before the Core request', () => {
  assert.throws(
    () => projectHumanFilterBuilder(
      context,
      'all',
      [{ field: 'count', operator: selector('count', 'eq', 'integer'), value: '3.5' }],
      [],
    ),
    /requires an integer value/u,
  );

  assert.throws(
    () => projectHumanFilterBuilder(
      context,
      'all',
      [{ field: 'enabled', operator: selector('enabled', 'eq', 'boolean'), value: 'yes' }],
      [],
    ),
    /requires true or false/u,
  );
});


test('stored 0.1.11 combined predicate rows remain executable', () => {
  const filters = projectHumanFilterBuilder(
    context,
    'all',
    [{ predicate: selector('status', 'eq', 'enum'), value: 'pending' }],
    [],
  );
  assert.deepEqual(filters, [{ field: 'status', op: 'eq', value: 'pending' }]);
});

test('stale operator from a different field is rejected before the Core request', () => {
  assert.throws(
    () => projectHumanFilterBuilder(
      context,
      'all',
      [{ field: 'status', operator: selector('dueDate', 'lt', 'date'), value: '2026-09-20' }],
      [],
    ),
    /does not belong to field/u,
  );
});
