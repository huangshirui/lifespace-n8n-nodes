from pathlib import Path

p = Path('test/agent-configuration-discovery.test.mjs')
s = p.read_text()
old = """  assert.deepEqual(context.calls.map((call) => call.url), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/inventory`,
    `${CORE_BASE}/spaces/spc_external/_discovery/models/health_document`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]);"""
new = """  const urls = context.calls.map((call) => call.url);
  assert.deepEqual(urls.slice(0, 2), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/inventory`,
  ]);
  assert.deepEqual(new Set(urls.slice(2)), new Set([
    `${CORE_BASE}/spaces/spc_external/_discovery/models/health_document`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]));"""
if old not in s:
    raise SystemExit('missing concurrent request-order assertion')
s = s.replace(old, new, 1)
p.write_text(s)
print('Agent dynamic concurrent request assertion corrected')
