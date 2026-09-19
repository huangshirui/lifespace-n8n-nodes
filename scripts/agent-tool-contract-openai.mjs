#!/usr/bin/env node

/**
 * Extract the provider-facing OpenAI function contract from a generated
 * Agent Tool contract snapshot.
 *
 * Usage:
 *   node scripts/agent-tool-contract-openai.mjs input.json output.json
 *
 * The output is the shape consumed by OpenAI-compatible providers such as
 * Groq. Keep this separate from n8n internal Tool implementation details.
 */

import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/agent-tool-contract-openai.mjs <input.json> <output.json>');
  process.exit(1);
}

const snapshot = JSON.parse(await readFile(inputPath, 'utf8'));

const contract = snapshot.openAiFunctionTool ?? snapshot;

if (!contract?.function?.parameters) {
  throw new Error('Input does not contain an OpenAI function contract');
}

await writeFile(
  outputPath,
  `${JSON.stringify(contract, null, 2)}\n`,
  'utf8',
);
