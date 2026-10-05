from pathlib import Path


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise SystemExit(f'missing closeout block: {label}')
    return source.replace(old, new, 1)

# #307 first-class lsp_agt_* semantics: no Delegation means direct
# Principal=Agent / Actor=Agent. A dlg_* is only a selector for represented
# User execution, so ordinary Agent Tool runtime must never require one locally.
p = Path('nodes/LifeSpaceTool/LifeSpaceTool.node.ts')
s = p.read_text()
s = replace_required(
    s,
    "      { requireDelegation: runtime.config.operation !== 'batchCreate' },",
    "      { requireDelegation: false },",
    'direct Agent authority',
)
p.write_text(s)

# fix_020_tests.py migrates the old token-mint test to opaque Agent credential
# transport. Keep its second assertion about the now-unused direct HTTP helper;
# an earlier broad replacement accidentally rewrote that assertion to credential=0.
p = Path('test/authority-v3-agent-execution.test.mjs')
s = p.read_text()
s = replace_required(
    s,
    """  assert.equal(execution.calls.filter((call) => call.transport === 'credential').length, 2);
  assert.equal(execution.calls.filter((call) => call.transport === 'credential').length, 0);""",
    """  assert.equal(execution.calls.filter((call) => call.transport === 'credential').length, 2);
  assert.equal(execution.calls.filter((call) => call.transport === 'direct').length, 0);""",
    'opaque Agent transport assertions',
)

# The pre-#307 expectation that a missing dlg_* must fail in the adapter is no
# longer valid. Missing dlg_* deliberately selects direct Agent Authority; Core
# remains authoritative for whether that Agent has sufficient current Authority.
old = """test('missing business Delegation remains a deterministic request_authorization result', async () => {
  const execution = context(
    model(),
    () => {
      throw new Error('Core must not be called when business Delegation is missing');
    },
    { delegationId: '', readDelegationId: '' },
  );
  const tool = (await new LifeSpaceTool().supplyData.call(execution, 0)).response;
  const result = JSON.parse(await tool.invoke({ name: 'Must not execute' }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DELEGATION_REQUIRED');
  assert.equal(result.error.retryable, false);
  assert.equal(result.error.nextAction, 'request_authorization');
  assert.equal(execution.calls.filter((call) => call.transport === 'direct').length, 0);
});"""
new = """test('missing business Delegation selects direct Agent Authority', async () => {
  let posted;
  const execution = context(
    model(),
    (options) => {
      posted = options;
      return { data: { id: 'rec_direct_agent', version: 1 } };
    },
    { delegationId: '', readDelegationId: '' },
  );
  const tool = (await new LifeSpaceTool().supplyData.call(execution, 0)).response;
  const result = JSON.parse(await tool.invoke({ name: 'Direct Agent execution' }));

  assert.equal(result.data.id, 'rec_direct_agent');
  assert.equal(posted.headers?.['X-LifeSpace-Delegation-Id'], undefined);
  assert.equal(execution.calls.filter((call) => call.transport === 'credential').length, 1);
  assert.equal(execution.calls.filter((call) => call.transport === 'direct').length, 0);
});"""
s = replace_required(s, old, new, 'missing Delegation direct Agent semantics')
p.write_text(s)
