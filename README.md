# n8n-nodes-lifespace

Official n8n community nodes for integrating workflows and AI agents with LifeSpace.

## Status

The package currently provides:

- a LifeSpace Connection credential using a Connection Base URL plus an opaque `lsp_pat_*` Service API Token;
- a LifeSpace node with generic Model Record operations plus an advanced connection-relative API request escape hatch;
- discovery-driven Model and Action selectors against the connection's current LifeSpace authority;
- a LifeSpace Trigger that receives signed LifeSpace domain-event webhooks;
- the official `n8n-node` development toolchain;
- CI for lint and build validation.

Domain-specific UX and AI-tool surfaces will be added only against stable upstream LifeSpace contracts/discovery metadata.

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

Create and authorize the integration in LifeSpace Web first. The Web configuration owns the target Space and its granted model permissions, then exposes the values to copy into n8n:

- **Connection Base URL**, for example `https://core.aisr.online/api/v1/spaces/spc_...`;
- **Service API Token**, an opaque `lsp_pat_*` token issued for that connection.

The Credential represents one already-configured LifeSpace connection. Individual LifeSpace nodes therefore do not ask for a Space ID.

The Connection Base URL carries routing context only. Authorization still comes from the Service API Token plus LifeSpace credential scopes, Application × Model Access and current Space/Data Grant authority. Revoking the token or grant invalidates the connection without changing the n8n workflow.

Do not store real tokens in source code, workflow examples or repository files.

## LifeSpace Model Record

The **Model Record** resource is a thin adapter over LifeSpace Generic Runtime routes. It supports:

- Create;
- Get;
- List / Query;
- Update with optimistic concurrency;
- Delete with optimistic concurrency;
- Execute Action for published Capability/workflow actions.

The node loads its Model selector from `{Connection Base URL}/_discovery`. The list contains only models the current connection can actually use after LifeSpace applies credential scopes, Application × Model Access and current Space membership/Data Grants. The **Action** selector is then loaded dynamically from the selected model and is filtered by the same effective authority.

The node does not use the privileged `model-admin/contracts/*` surface for ordinary workflow discovery and does not copy model definitions into this repository. Record fields, query parameters and action inputs remain governed by LifeSpace model metadata. They remain JSON inputs for now; later UX may use n8n dynamic schema/resource mapping where that can be driven directly by stable LifeSpace discovery metadata.

The **API Request** resource remains available as an advanced escape hatch for paths relative to the configured Connection Base URL.

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

- dynamic field/query UX driven by stable LifeSpace discovery metadata;
- n8n AI Tool experience for approved LifeSpace actions;
- delegated subscription management if LifeSpace later exposes an appropriate user-authorized contract;
- OAuth `client_credentials` support where required;
- npm publishing with GitHub Actions provenance.

## License

MIT
