#!/usr/bin/env node

/**
 * Agent Tool contract guard.
 *
 * This intentionally checks the provider-facing OpenAI function contract.
 * Breaking changes must be reviewed explicitly.
 *
 * Usage:
 *   node scripts/agent-tool-contract-guard.mjs contract.json
 */

import { readFile } from 'node:fs/promises';

const [, , file] = process.argv;
if (!file) {
  console.error('Usage: node scripts/agent-tool-contract-guard.mjs <contract.json>');
  process.exit(1);
}

const contract = JSON.parse(await readFile(file, 'utf8'));
const fn = contract.function ?? contract.openAiFunctionTool?.function;
const parameters = fn?.parameters;

if (!parameters) {
  throw new Error('Missing OpenAI function parameters');
}

const properties = parameters.properties ?? {};

// Runtime fields must never leak into an Agent-facing contract.
const forbidden = ['action', 'sessionId', 'chatInput', 'toolCallId'];
for (const key of forbidden) {
  if (Object.hasOwn(properties, key)) {
    throw new Error(`Forbidden Agent Tool contract property: ${key}`);
  }
}

// Calendar models should use the high-level date window projection when exposed.
if (Object.hasOwn(properties, 'timeWindow')) {
  const description = String(properties.timeWindow.description ?? '');
  if (!/today|tomorrow|this week|date range/i.test(description)) {
    throw new Error('timeWindow description must explain calendar window usage');
  }
}

console.log(`Agent Tool contract OK: ${fn.name}`);
