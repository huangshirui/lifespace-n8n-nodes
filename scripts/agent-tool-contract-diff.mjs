#!/usr/bin/env node

/**
 * Agent Tool contract snapshot diff helper.
 *
 * Usage:
 *   node scripts/agent-tool-contract-diff.mjs old.json new.json
 *
 * This intentionally compares the provider-facing OpenAI function contract,
 * not internal n8n node implementation details.
 */

import { readFile } from 'node:fs/promises';

function usage() {
  console.error('Usage: node scripts/agent-tool-contract-diff.mjs <old.json> <new.json>');
  process.exit(1);
}

function flatten(value, prefix = '') {
  const output = new Map();
  if (!value || typeof value !== 'object') {
    output.set(prefix, String(value));
    return output;
  }

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      for (const [childPath, childValue] of flatten(child, path)) {
        output.set(childPath, childValue);
      }
    } else {
      output.set(path, JSON.stringify(child));
    }
  }
  return output;
}

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) usage();

const oldContract = JSON.parse(await readFile(oldPath, 'utf8'));
const newContract = JSON.parse(await readFile(newPath, 'utf8'));

const oldMap = flatten(oldContract);
const newMap = flatten(newContract);

for (const [key, value] of newMap) {
  if (!oldMap.has(key)) console.log(`+ ${key}: ${value}`);
  else if (oldMap.get(key) !== value) console.log(`~ ${key}: ${oldMap.get(key)} -> ${value}`);
}

for (const [key, value] of oldMap) {
  if (!newMap.has(key)) console.log(`- ${key}: ${value}`);
}
