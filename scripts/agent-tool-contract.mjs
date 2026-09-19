#!/usr/bin/env node

/**
 * Unified Agent Tool contract entrypoint.
 *
 * The generated contract is the provider-facing function calling JSON that
 * OpenAI-compatible providers (including Groq) receive.
 *
 * Usage:
 *   node scripts/agent-tool-contract.mjs snapshot.json output.json
 */

import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/agent-tool-contract.mjs <snapshot.json> <output.json>');
  process.exit(1);
}

const snapshot = JSON.parse(await readFile(inputPath, 'utf8'));
const contract = snapshot.openAiFunctionTool ?? snapshot;

if (!contract?.function?.parameters) {
  throw new Error('Missing provider-facing OpenAI function contract');
}

const properties = contract.function.parameters.properties ?? {};
for (const key of ['action', 'sessionId', 'chatInput', 'toolCallId']) {
  if (Object.hasOwn(properties, key)) {
    throw new Error(`Runtime field leaked into Agent Tool contract: ${key}`);
  }
}

if (Object.hasOwn(properties, 'timeWindow')) {
  const description = String(properties.timeWindow.description ?? '');
  if (!/today|tomorrow|this week|date range/i.test(description)) {
    throw new Error('timeWindow must describe calendar window usage');
  }
}

await writeFile(outputPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
console.log(`Agent Tool contract OK: ${contract.function.name}`);
