#!/usr/bin/env node

/**
 * Normalize a provider-facing Agent Tool contract into the shape consumed by
 * OpenAI-compatible tool binding layers.
 *
 * This is intentionally dependency-free. It does not emulate n8n internals;
 * it validates the boundary contract that n8n/LangChain adapters must preserve.
 *
 * Usage:
 *   node scripts/agent-tool-contract-runtime.mjs input.json output.json
 */

import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/agent-tool-contract-runtime.mjs <input> <output>');
}

const source = JSON.parse(await readFile(inputPath, 'utf8'));
const contract = source.function ? source : source.openAiFunctionTool;

if (!contract?.function?.name || !contract.function.parameters) {
  throw new Error('Invalid Agent Tool runtime contract');
}

const runtimeContract = {
  type: 'function',
  function: {
    name: contract.function.name,
    description: contract.function.description ?? '',
    parameters: contract.function.parameters,
  },
};

await writeFile(outputPath, `${JSON.stringify(runtimeContract, null, 2)}\n`, 'utf8');
console.log(`Runtime Agent Tool contract OK: ${runtimeContract.function.name}`);
