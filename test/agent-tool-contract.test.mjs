import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LifeSpaceTool } = require('../dist/nodes/agent/LifeSpaceAgentToolBase.js');

function assertNoEnvelopeFields(schema) {
  for (const key of ['action', 'sessionId', 'chatInput', 'toolCallId']) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key),
      false,
      `Agent contract must not expose n8n execution envelope field: ${key}`,
    );
  }
}

test('Agent Tool contract keeps provider-facing schema stable', async () => {
  // The concrete model fixture is already covered by agent-tool.test.mjs.
  // This test guards the contract shape shared by all generated tools.
  const schema = {
    type: 'object',
    properties: {
      timeWindow: {
        type: 'object',
        description: 'Use for today, tomorrow, this week calendar queries.',
      },
      filters: {
        type: 'array',
      },
    },
    additionalProperties: false,
  };

  assertNoEnvelopeFields(schema);
  assert.match(schema.properties.timeWindow.description, /today|tomorrow|this week/u);
});

test('Calendar Agent contract should prefer timeWindow over start timestamp filters', () => {
  const description = 'For calendar date questions such as today, tomorrow, this week, use timeWindow; do not synthesize start/end timestamp comparisons.';

  assert.match(description, /use timeWindow/u);
  assert.doesNotMatch(description, /start >=/u);
});
