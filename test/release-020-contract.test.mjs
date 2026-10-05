import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('0.2.0 exposes split batch processing and atomic consistency semantics', () => {
  const source = readFileSync('nodes/LifeSpace/LifeSpace.node.ts', 'utf8');
  assert.match(source, /name: 'batchProcessing'[\s\S]*default: true/u);
  assert.match(source, /name: 'atomicConsistency'[\s\S]*default: false/u);
  assert.match(source, /atomicConsistency \? 'batch' : 'bulk'/u);
});

test('0.2.0 package registers the complete authorization request node surface', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const name of [
    'LifeSpaceRequestAuthorization',
    'LifeSpaceConfirmAuthorization',
    'LifeSpaceConfirmAuthorizationTool',
    'LifeSpaceDenyAuthorization',
    'LifeSpaceCancelAuthorization',
    'LifeSpaceCancelAuthorizationTool',
  ]) assert.ok(pkg.n8n.nodes.some((entry) => entry.includes(name)), `${name} must be registered`);
});
