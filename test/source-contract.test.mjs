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
  assert.match(node, /name: 'Record'/u);
  assert.match(node, /displayName: 'Record Type Name or ID'/u);
  assert.match(node, /displayName: 'Return All'/u);
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
