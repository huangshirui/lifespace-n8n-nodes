#!/usr/bin/env node

/**
 * Build provider-facing Agent Tool contracts from generated snapshots.
 *
 * Usage:
 *   node scripts/agent-tool-contract-build.mjs input-dir output-dir
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [inputDir, outputDir] = process.argv.slice(2);

if (!inputDir || !outputDir) {
  throw new Error('Usage: node scripts/agent-tool-contract-build.mjs <input-dir> <output-dir>');
}

await mkdir(outputDir, { recursive: true });

for (const file of await readdir(inputDir)) {
  if (!file.endsWith('.json')) continue;

  const snapshot = JSON.parse(await readFile(join(inputDir, file), 'utf8'));
  const contract = snapshot.openAiFunctionTool ?? snapshot;

  if (!contract?.function?.parameters) {
    throw new Error(`Invalid Agent Tool contract snapshot: ${file}`);
  }

  await writeFile(
    join(outputDir, file.replace(/\.json$/, '.openai.json')),
    `${JSON.stringify(contract, null, 2)}\n`,
    'utf8',
  );
}
