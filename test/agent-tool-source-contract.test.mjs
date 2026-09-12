import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('package registers separate human workflow and native Agent Tool surfaces', async () => {
  const packageJson = JSON.parse(await text('package.json'));
  assert.ok(packageJson.n8n.nodes.includes('dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js'));
  assert.ok(packageJson.n8n.nodes.includes('dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js'));
  assert.ok(packageJson.n8n.nodes.includes('dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js'));
  assert.equal(packageJson.n8n.nodes.includes('dist/nodes/LifeSpace/LifeSpace.node.js'), false);
  assert.equal(packageJson.dependencies?.['@langchain/core'], undefined);
  assert.equal(packageJson.peerDependencies?.['@langchain/core'], undefined);
});

test('Agent Tool remains a native AiTool and keeps structural scope outside model input', async () => {
  const base = await text('nodes/agent/LifeSpaceAgentToolBase.ts');
  const projection = await text('nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.ts');
  assert.match(base, /outputs: \[NodeConnectionTypes\.AiTool\]/u);
  assert.match(base, /noDataExpression: true/u);
  assert.match(projection, /async supplyData\(this: ISupplyDataFunctions/u);
  assert.match(projection, /genericQuerySchema\(model\)/u);
  assert.match(projection, /compileGenericQuery\(model, input\)/u);
  assert.doesNotMatch(projection, /@langchain\/core/u);
  assert.doesNotMatch(projection, /DynamicStructuredTool/u);
});

test('Agent Tool remains model-agnostic and projects Discovery semantics', async () => {
  const source = [
    await text('nodes/agent/LifeSpaceAgentToolBase.ts'),
    await text('nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.ts'),
    await text('nodes/agent/lifeSpaceToolFactory.ts'),
    await text('nodes/agent/lifeSpaceGenericQueryTool.ts'),
  ].join('\n');

  assert.doesNotMatch(source, /model\.key\s*===\s*['"](?:task|event|wish|day_record)['"]/u);
  assert.doesNotMatch(source, /switch\s*\(\s*model\.key\s*\)/u);
  assert.doesNotMatch(source, /create_task|query_event|complete_task/u);
  assert.match(source, /queryPredicates\(model\)/u);
  assert.match(source, /query\.capabilityQueries/u);
  assert.match(source, /model\.fields/u);
});

test('human workflow projection is not exposed through usableAsTool', async () => {
  const workflow = await text('nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.ts');
  const packageJson = JSON.parse(await text('package.json'));
  assert.match(workflow, /delete description\.usableAsTool/u);
  assert.ok(packageJson.n8n.nodes.includes('dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js'));
});

test('Agent Tool source uses only public-safe examples and no private infrastructure', async () => {
  const source = [
    await text('README.md'),
    await text('nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.ts'),
    await text('nodes/agent/lifeSpaceGenericQueryTool.ts'),
  ].join('\n');
  assert.equal(source.includes('aisr.online'), false);
  assert.equal(source.includes('homemew.aisr.online'), false);
});
