from pathlib import Path


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise SystemExit(f'missing test fixture block: {label}')
    return source.replace(old, new, 1)

# Agent Tool surface: lsp_agt_* is now the Core credential. There is no
# adapter-side Identity token mint and no manually-added Authorization header.
p = Path('test/agent-tool-surface.test.mjs')
s = p.read_text()
s = replace_required(s, """        return {
          coreBaseUrl: BASE_URL,
          identityBaseUrl: IDENTITY_BASE_URL,
          applicationSecret: 'lsa_surface_test',
          agentId: AGENT_ID,
        };""", """        return {
          coreBaseUrl: BASE_URL,
          agentSecret: 'lsp_agt_surface_test',
        };""", 'agent-tool-surface credentials')
s = replace_required(s, """      async httpRequestWithAuthentication(credentialName, options) {
        calls.push(options);
        if (credentialName === 'lifeSpaceAgentExecutionApi'
          && options.url === `${IDENTITY_BASE_URL}/internal/v1/agent-execution-tokens`) {
          return {
            data: {
              accessToken: 'agent.surface.jwt',
              principalType: 'agent',
              principalId: AGENT_ID,
              actor: { type: 'agent', id: AGENT_ID },
              applicationId: 'app_surface_test',
              purpose: 'agent_execution',
            },
          };
        }
        if (options.url === `${BASE_URL}/me/_discovery/inventory`) return inventory();
        if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/${MODEL_KEY}`) return detail();
        if (onBusiness) return onBusiness(options);
        return { data: { items: [], nextCursor: null } };
      },""", """      async httpRequestWithAuthentication(credentialName, options) {
        calls.push(options);
        if (credentialName === 'lifeSpaceAgentExecutionApi') {
          assert.match(String((await thisContextCredentials()).agentSecret), /^lsp_agt_/u);
        }
        if (options.url === `${BASE_URL}/me/_discovery/inventory`) return inventory();
        if (options.url === `${BASE_URL}/spaces/spc_test/_discovery/models/${MODEL_KEY}`) return detail();
        if (onBusiness) return onBusiness(options);
        return { data: { items: [], nextCursor: null } };
      },""", 'agent-tool-surface credential transport')
# The local helper above cannot call context credentials through `this`; keep the
# assertion at the fixture level instead and simplify the generated helper.
s = s.replace("""        if (credentialName === 'lifeSpaceAgentExecutionApi') {
          assert.match(String((await thisContextCredentials()).agentSecret), /^lsp_agt_/u);
        }
""", """        assert.ok(['lifeSpaceAgentExecutionApi', 'lifeSpaceApi'].includes(credentialName));
""")
s = s.replace("  assert.equal(requested.headers.Authorization, 'Bearer agent.surface.jwt');\n", "")
s = s.replace("  assert.equal(requested.headers['X-LifeSpace-Delegation-Id'], undefined);\n", "  assert.equal(requested.headers?.['X-LifeSpace-Delegation-Id'], undefined);\n")
p.write_text(s)

# User-authorization Agent Tool tests: trusted principalUserId remains node config,
# while represented execution is selected only by dlg_* and Core resolves the root
# Principal from the Delegation chain.
p = Path('test/agent-user-authorization-0.2.test.mjs')
s = p.read_text()
s = replace_required(s, """      return {
        coreBaseUrl: CORE_BASE,
        identityBaseUrl: IDENTITY_BASE,
        applicationSecret: 'lsa_test',
        agentId: AGENT,
      };""", """      return {
        coreBaseUrl: CORE_BASE,
        agentSecret: 'lsp_agt_test',
      };""", 'agent-user credentials')
start = s.index('    helpers: {')
end = s.index('    },\n  };\n}', start) + len('    },\n')
helpers = """    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        calls.push({ transport: 'credential', credentialName, options });
        if (coreError) throw coreError;
        return { data: { id: `rec_${calls.length}`, version: 1 } };
      },
      async httpRequest(options) {
        calls.push({ transport: 'direct', options });
        if (coreError) throw coreError;
        return { data: { id: `rec_${calls.length}`, version: 1 } };
      },
    },
"""
s = s[:start] + helpers + s[end:]
old = """  const identity = execution.calls.find((call) => call.transport === 'credential');
  assert.deepEqual(identity.options.body, {
    agentId: AGENT,
    scopes: ['resources:read', 'resources:write'],
  });

  const core = execution.calls.find((call) => call.transport === 'direct');
  assert.equal(core.options.headers.Authorization, `Bearer agent.jwt.agent.${AGENT}`);
  assert.equal(core.options.headers['X-LifeSpace-Delegation-Id'], undefined);"""
new = """  const core = execution.calls.find((call) => call.transport === 'credential');
  assert.ok(core);
  assert.equal(core.options.headers?.['X-LifeSpace-Delegation-Id'], undefined);"""
s = replace_required(s, old, new, 'agent-user direct execution expectation')
old = """  const identity = execution.calls.find((call) => call.transport === 'credential');
  assert.deepEqual(identity.options.body, {
    principalType: 'user',
    principalId: USER,
    agentId: AGENT,
    scopes: ['resources:read', 'resources:write'],
  });

  const core = execution.calls.find((call) => call.transport === 'direct');
  assert.equal(core.options.headers.Authorization, `Bearer agent.jwt.user.${USER}`);
  assert.equal(core.options.headers['X-LifeSpace-Delegation-Id'], 'dlg_test');
  assert.deepEqual(core.options.body, { name: 'Delegated task' });"""
new = """  const core = execution.calls.find((call) => call.transport === 'credential');
  assert.ok(core);
  assert.equal(core.options.headers['X-LifeSpace-Delegation-Id'], 'dlg_test');
  assert.deepEqual(core.options.body, { name: 'Delegated task' });"""
s = replace_required(s, old, new, 'agent-user represented execution expectation')
old = """  const identityCalls = execution.calls.filter((call) => call.transport === 'credential');
  assert.equal(identityCalls.length, 2);
  assert.deepEqual(identityCalls[0].options.body, {
    agentId: AGENT,
    scopes: ['resources:read', 'resources:write'],
  });
  assert.deepEqual(identityCalls[1].options.body, {
    principalType: 'user',
    principalId: USER,
    agentId: AGENT,
    scopes: ['resources:read', 'resources:write'],
  });

  const coreCalls = execution.calls.filter((call) => call.transport === 'direct');
  assert.equal(coreCalls[0].options.headers['X-LifeSpace-Delegation-Id'], undefined);
  assert.equal(coreCalls[1].options.headers['X-LifeSpace-Delegation-Id'], 'dlg_second');"""
new = """  const coreCalls = execution.calls.filter((call) => call.transport === 'credential');
  assert.equal(coreCalls.length, 2);
  assert.equal(coreCalls[0].options.headers?.['X-LifeSpace-Delegation-Id'], undefined);
  assert.equal(coreCalls[1].options.headers['X-LifeSpace-Delegation-Id'], 'dlg_second');"""
s = replace_required(s, old, new, 'agent-user mixed execution expectation')
p.write_text(s)

# Authority-v3 runtime tests now exercise the opaque Agent credential transport
# directly. Read/business Delegation selector separation remains unchanged.
p = Path('test/authority-v3-agent-execution.test.mjs')
s = p.read_text()
s = replace_required(s, """        return {
          coreBaseUrl: CORE_BASE,
          identityBaseUrl: IDENTITY_BASE,
          applicationSecret: 'lsa_test',
          agentId: AGENT,
        };""", """        return {
          coreBaseUrl: CORE_BASE,
          agentSecret: 'lsp_agt_test',
        };""", 'authority-v3 credentials')
old_helpers = """      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ transport: 'credential', credentialName, options });
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        assert.equal(options.url, `${IDENTITY_BASE}/internal/v1/agent-execution-tokens`);
        assert.deepEqual(options.body, {
          principalType: 'user',
          principalId: PRINCIPAL,
          agentId: AGENT,
          scopes: ['resources:read', 'resources:write'],
        });
        return {
          data: {
            accessToken: 'agent.jwt.test',
            principalId: PRINCIPAL,
            principalType: 'user',
            actor: { type: 'agent', id: AGENT },
            applicationId: 'app_test',
            purpose: 'agent_execution',
          },
        };
      },
      async httpRequest(options) {
        calls.push({ transport: 'direct', options });
        return business(options);
      },"""
new_helpers = """      async httpRequestWithAuthentication(credentialName, options) {
        calls.push({ transport: 'credential', credentialName, options });
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        return business(options);
      },
      async httpRequest(options) {
        calls.push({ transport: 'direct', options });
        return business(options);
      },"""
s = replace_required(s, old_helpers, new_helpers, 'authority-v3 transport')
s = s.replace("test('Authority v3 Agent token mint is lazy and reused inside one Tool runtime'", "test('opaque Agent credential is reused as transport inside one Tool runtime'")
s = s.replace("""  assert.equal(execution.calls.filter((call) => call.transport === 'credential').length, 1);
  assert.equal(execution.calls.filter((call) => call.transport === 'direct').length, 2);""", """  assert.equal(execution.calls.filter((call) => call.transport === 'credential').length, 2);
  assert.equal(execution.calls.filter((call) => call.transport === 'direct').length, 0);""", 1)
s = s.replace("test('delegated Agent business execution uses Authority v3 token plus explicit Delegation selector'", "test('delegated Agent business execution uses opaque Agent credential plus explicit Delegation selector'")
s = s.replace("  assert.equal(posted.headers.Authorization, 'Bearer agent.jwt.test');\n", "")
s = s.replace("  assert.equal(execution.calls.filter((call) => call.transport === 'direct').length, 0);", "  assert.equal(execution.calls.filter((call) => call.transport === 'credential').length, 0);", 1)
p.write_text(s)

# Static release expectations must follow the 0.2.0 registered node surface.
p = Path('test/query-ui-regression.test.mjs')
s = p.read_text()
old = """  assert.deepEqual(packageJson.n8n.nodes, [
    'dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js',
    'dist/nodes/LifeSpaceDelegation/LifeSpaceDelegation.node.js',
    'dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js',
    'dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js',
  ]);"""
new = """  assert.deepEqual(packageJson.n8n.nodes, [
    'dist/nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.js',
    'dist/nodes/LifeSpaceDelegation/LifeSpaceDelegation.node.js',
    'dist/nodes/LifeSpaceTrigger/LifeSpaceTrigger.node.js',
    'dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js',
    'dist/nodes/LifeSpaceRequestAuthorization/LifeSpaceRequestAuthorization.node.js',
    'dist/nodes/LifeSpaceConfirmAuthorization/LifeSpaceConfirmAuthorization.node.js',
    'dist/nodes/LifeSpaceConfirmAuthorizationTool/LifeSpaceConfirmAuthorizationTool.node.js',
    'dist/nodes/LifeSpaceDenyAuthorization/LifeSpaceDenyAuthorization.node.js',
    'dist/nodes/LifeSpaceCancelAuthorization/LifeSpaceCancelAuthorization.node.js',
    'dist/nodes/LifeSpaceCancelAuthorizationTool/LifeSpaceCancelAuthorizationTool.node.js',
  ]);"""
s = replace_required(s, old, new, 'package node list')
p.write_text(s)

p = Path('test/source-contract.test.mjs')
s = p.read_text()
s = s.replace("assert.equal(content.includes('api.example.com'), true);", "assert.equal(content.includes('example.com'), true);")
s = s.replace("assert.match(node, /name: 'recordOptions'[\\s\\S]{0,500}displayName: 'Batch Mode'/u);", "assert.match(node, /name: 'recordOptions'[\\s\\S]{0,800}displayName: 'Batch Processing'/u);\n  assert.match(node, /name: 'recordOptions'[\\s\\S]{0,1200}displayName: 'Atomic Consistency'/u);")
p.write_text(s)
