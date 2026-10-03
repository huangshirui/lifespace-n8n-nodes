# Authority v3 Delegation adapter boundary

This adapter work targets the LifeSpace Authority v3 contracts currently validated in staging by LifeSpace PR #304.

## Upstream dependency

The implementation expects:

- LifeSpace Core Kernel `0.42.0` or a compatible contract exposing `POST /api/v1/spaces/{spaceId}/delegations`;
- LifeSpace Identity `0.8.0` or a compatible contract exposing `POST /internal/v1/agent-execution-tokens`;
- trusted Application user-token exchange at `POST /internal/v1/tokens`.

Do not publish an npm release that requires these contracts before the corresponding LifeSpace production release is accepted and deployed.

## n8n responsibility boundary

`LifeSpace Delegation` is an ordinary workflow node. It does **not** request authorization from the user, interpret chat replies, persist pending authorization context, correlate a `sessionId`, or resume an Agent conversation. Those are application/n8n workflow responsibilities.

The node is invoked only after the application has already established a clear affirmative user decision. It then:

1. uses the trusted `lsa_*` Application credential to mint a short-lived token for the already-resolved `usr_*` Principal;
2. calls the generic Core Delegation endpoint;
3. currently delegates to the `agt_*` Agent configured in the `LifeSpace Agent Execution API` credential, because Agent is the current LifeSpace Entity type that may receive Delegation;
4. returns the Core Delegation response containing the `dlg_*` ID.

One n8n input item creates one Delegation. Multiple confirmed scopes are represented by multiple input items. The node does not add grouping, application-level authorization-request state, or cross-item atomicity.

## Authority v3 Agent execution

Delegated Agent execution now mints short-lived tokens through:

```text
POST /internal/v1/agent-execution-tokens
```

with an independently authenticated Agent Actor and explicit represented Principal claims. Business calls continue to select the current Delegation explicitly with `X-LifeSpace-Delegation-Id` (or per-operation selectors for Generic Runtime Batch).
