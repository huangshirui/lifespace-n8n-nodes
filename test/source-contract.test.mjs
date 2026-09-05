import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('public LifeSpace adapter surfaces use neutral examples', async () => {
  const paths = [
    'README.md',
    'credentials/LifeSpaceApi.credentials.ts',
    'credentials/LifeSpaceWebhookApi.credentials.ts',
    'nodes/LifeSpace/LifeSpace.node.ts',
    'nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.ts',
  ];
  const content = (await Promise.all(paths.map(text))).join('\n');
  assert.equal(content.includes('aisr.online'), false);
  assert.equal(content.includes('api.example.com'), true);
});

test('package separates outbound API auth from endpoint-scoped webhook signing', async () => {
  const packageJson = JSON.parse(await text('package.json'));
  assert.deepEqual(packageJson.n8n.credentials, [
    'dist/credentials/LifeSpaceApi.credentials.js',
    'dist/credentials/LifeSpaceWebhookApi.credentials.js',
  ]);

  const trigger = await text('nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.ts');
  assert.match(trigger, /name: 'lifeSpaceApi'/u);
  assert.match(trigger, /name: 'lifeSpaceWebhookApi'/u);
  assert.match(trigger, /getCredentials\('lifeSpaceWebhookApi'\)/u);
});

test('Runtime Discovery UX is cross-Space and Record-facing', async () => {
  const discovery = await text('nodes/lifespaceDiscovery.ts');
  const node = await text('nodes/LifeSpace/LifeSpace.node.ts');
  assert.match(discovery, /\/me\/_discovery/u);
  assert.match(discovery, /defaults: Record<string, unknown>/u);
  assert.match(discovery, /title\?: string/u);
  assert.match(discovery, /repeatable: true/u);
  assert.match(discovery, /envelopeFields: string\[\]/u);
  assert.match(discovery, /relation\?: DiscoveryRelation/u);
  assert.match(discovery, /lookup: DiscoveryRelationLookup/u);
  assert.match(discovery, /export async function loadRelationTargets/u);
  assert.match(node, /name: 'Record'/u);
  assert.match(node, /displayName: 'Record Type Name or ID'/u);
  assert.match(node, /displayName: 'Return All'/u);
  assert.match(node, /name: 'sorts'/u);
  assert.match(node, /field\.title\?\.trim\(\) \|\| humanizeKey/u);
  assert.match(node, /loadRelationTargets\(this, spaceId, model\.key, field\)/u);
});

test('runtime node inputs remain expression-capable except structural controls', async () => {
  const node = await text('nodes/LifeSpace/LifeSpace.node.ts');
  const trigger = await text('nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.ts');

  // n8n parameters accept expressions unless noDataExpression is set. Keep that
  // escape hatch limited to controls that define the node schema itself plus the
  // resourceMapper containers whose individual mapped values remain expression-capable.
  assert.equal((node.match(/noDataExpression: true/gu) ?? []).length, 5);
  assert.match(node, /name: 'resource',[\s\S]{0,80}noDataExpression: true/u);
  assert.match(node, /name: 'operation',[\s\S]{0,80}noDataExpression: true/u);
  assert.match(node, /name: 'fields',[\s\S]{0,140}noDataExpression: true/u);
  assert.match(node, /name: 'actionInput',[\s\S]{0,140}noDataExpression: true/u);
  assert.doesNotMatch(trigger, /noDataExpression: true/u);

  // Discovery-backed runtime selectors keep the standard n8n "select or expression"
  // path so workflows can pass stable IDs/keys from variables or previous item data.
  assert.match(node, /name: 'spaceId'[\s\S]{0,360}specify an ID using an <a href=/u);
  assert.match(node, /name: 'modelRoute'[\s\S]{0,420}specify an ID using an <a href=/u);
  assert.match(node, /name: 'actionKey'[\s\S]{0,420}specify an ID using an <a href=/u);
  assert.match(trigger, /name: 'spaceId'[\s\S]{0,360}specify an ID using an <a href=/u);
  assert.match(trigger, /name: 'recordTypeKeys'[\s\S]{0,460}specify IDs using an <a href=/u);
});

test('npm releases use GitHub OIDC Trusted Publishing without a long-lived write token', async () => {
  const workflow = await text('.github/workflows/publish.yml');

  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /node-version: '22\.22\.0'/u);
  assert.match(workflow, /package-manager-cache: false/u);
  assert.match(workflow, /npm install --global npm@\^11\.15\.0/u);
  assert.match(workflow, /ACTIONS_ID_TOKEN_REQUEST_URL/u);
  assert.match(workflow, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/u);
  assert.match(workflow, /run: npm ci/u);
  assert.match(workflow, /run: npm run release/u);
  assert.doesNotMatch(workflow, /NPM_TOKEN/u);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/u);
  assert.doesNotMatch(workflow, /_authToken/u);
});

test('Trigger supports multiple Record Types and current endpoint test event', async () => {
  const trigger = await text('nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.ts');
  assert.match(trigger, /name: 'recordTypeKeys'[\s\S]*type: 'multiOptions'/u);
  assert.match(trigger, /eventType === 'endpoint\.test'/u);
  assert.doesNotMatch(trigger, /subscription\.test/u);
});

test('Action, Trigger and credentials use the same LifeSpace mark family', async () => {
  const [credentialLight, actionLight, triggerLight, credentialDark, actionDark, triggerDark] = await Promise.all([
    text('credentials/lifespace.svg'),
    text('nodes/LifeSpace/lifespace.svg'),
    text('nodes/LifeSpaceTrigger/lifespace.svg'),
    text('credentials/lifespace.dark.svg'),
    text('nodes/LifeSpace/lifespace.dark.svg'),
    text('nodes/LifeSpaceTrigger/lifespace.dark.svg'),
  ]);

  assert.equal(credentialLight, actionLight);
  assert.equal(actionLight, triggerLight);
  assert.equal(credentialDark, actionDark);
  assert.equal(actionDark, triggerDark);
});
