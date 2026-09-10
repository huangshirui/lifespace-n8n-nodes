import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('package registers a native LifeSpace AiTool sub-node', async () => {
  const packageJson = JSON.parse(await text('package.json'));
  assert.ok(packageJson.n8n.nodes.includes('dist/nodes/LifeSpaceTool/LifeSpaceTool.node.js'));
  assert.equal(packageJson.dependencies?.['@langchain/core'], '1.2.8');

  const source = await text('nodes/LifeSpaceTool/LifeSpaceTool.node.ts');
  assert.match(source, /inputs: \[\]/u);
  assert.match(source, /outputs: \[NodeConnectionTypes\.AiTool\]/u);
  assert.match(source, /async supplyData\(this: ISupplyDataFunctions/u);
  assert.match(source, /new DynamicStructuredTool/u);
});

test('Agent Tool remains model-agnostic and does not copy domain schemas', async () => {
  const source = [
    await text('nodes/LifeSpaceTool/LifeSpaceTool.node.ts'),
    await text('nodes/agent/lifeSpaceToolFactory.ts'),
  ].join('\n');

  assert.doesNotMatch(source, /model\.key\s*===\s*['"](?:task|event|wish|day_record)['"]/u);
  assert.doesNotMatch(source, /switch\s*\(\s*model\.key\s*\)/u);
  assert.doesNotMatch(source, /create_task|query_event|complete_task/u);
  assert.match(source, /query\.comparisons/u);
  assert.match(source, /query\.capabilityQueries/u);
  assert.match(source, /model\.fields/u);
  assert.match(source, /model\.actions/u);
});

test('Agent Tool source uses only public-safe examples and no private infrastructure', async () => {
  const source = [
    await text('README.md'),
    await text('nodes/LifeSpaceTool/LifeSpaceTool.node.ts'),
    await text('nodes/agent/lifeSpaceToolFactory.ts'),
    await text('test/agent-tool.test.mjs'),
  ].join('\n');
  assert.equal(source.includes('aisr.online'), false);
  assert.equal(source.includes('homemew.aisr.online'), false);
  assert.match(source, /example\.invalid/u);
});

test('ordinary workflow node remains separately registered for non-Agent workflows', async () => {
  const packageJson = JSON.parse(await text('package.json'));
  assert.ok(packageJson.n8n.nodes.includes('dist/nodes/LifeSpace/LifeSpace.node.js'));
  assert.ok(packageJson.n8n.nodes.includes('dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js'));

  const ordinary = await text('nodes/LifeSpace/LifeSpace.node.ts');
  assert.match(ordinary, /usableAsTool: true/u);
});
