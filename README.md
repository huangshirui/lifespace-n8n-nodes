# n8n-nodes-lifespace

Official n8n community nodes for integrating workflows and AI agents with LifeSpace.

## Status

The package currently provides:

- a LifeSpace API credential for opaque `lsp_pat_*` Service API Tokens;
- a thin LifeSpace node with a generic Core API request operation;
- a LifeSpace Trigger that receives signed LifeSpace domain-event webhooks;
- the official `n8n-node` development toolchain;
- CI for lint and build validation.

Domain-specific resources, actions and AI-tool surfaces will be added only against stable upstream LifeSpace contracts/discovery metadata.

## Architecture boundary

LifeSpace is the source of truth for identity, authorization, domain models, contracts and events. This repository is an n8n-specific adapter and must not become a second copy of LifeSpace business contracts.

LifeSpace does not depend on n8n. n8n is one optional orchestration and integration runtime that consumes LifeSpace APIs and events.

## Development

Requirements:

- Node.js 22.22.0 or newer;
- npm;
- a local n8n instance for interactive node testing.

Install and validate:

```bash
npm install
npm run lint
npm run build
```

Run the node in a local n8n development instance:

```bash
npm run dev
```

## Credentials

For owner-controlled n8n instances, use a LifeSpace Service API Token (`lsp_pat_*`). The LifeSpace action node sends it to LifeSpace Core as a Bearer token.

Do not store real tokens in source code, workflow examples or repository files.

## LifeSpace Trigger

LifeSpace event subscriptions are currently managed by an authenticated LifeSpace user with Space-management permission. A service token intentionally cannot create or modify subscriptions.

To use the trigger:

1. add a LifeSpace Trigger to an n8n workflow and activate the workflow;
2. copy the node's production webhook URL;
3. create a LifeSpace event subscription for the required Space/model/events and use that URL as the webhook destination;
4. copy the one-time signing secret returned by LifeSpace into the Trigger's **Signing Secret** field;
5. optionally set expected Space/model filters in the Trigger as an additional local check;
6. use LifeSpace's subscription test action to verify delivery.

The trigger validates `X-LifeSpace-Timestamp` and `X-LifeSpace-Signature` using the upstream LifeSpace HMAC-SHA256 contract before emitting workflow data.

## Planned surfaces

- LifeSpace resource/action node backed by stable LifeSpace contracts and discovery metadata;
- discovery-driven action/resource UX;
- n8n AI Tool support for approved LifeSpace actions;
- delegated subscription management if LifeSpace later exposes an appropriate user-authorized contract;
- OAuth `client_credentials` support where required;
- npm publishing with GitHub Actions provenance.

## License

MIT
