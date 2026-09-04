# n8n-nodes-lifespace

Official n8n community nodes for integrating workflows and AI agents with LifeSpace.

## Install in n8n

The npm package is:

```text
n8n-nodes-lifespace
```

### Self-hosted n8n: install from the UI

You must be an n8n instance Owner or Admin.

1. Open **Settings → Community Nodes**.
2. Select **Install**.
3. Enter:

   ```text
   n8n-nodes-lifespace
   ```

4. Confirm the community-node warning.
5. Select **Install**.
6. Return to a workflow and search for **LifeSpace**.

To pin a release, use for example:

```text
n8n-nodes-lifespace@0.1.0
```

### Self-hosted n8n: manual npm installation

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-lifespace
```

Restart n8n afterwards. In queue mode, install the package anywhere that may execute workflows.

## Quick start

Create one **LifeSpace API** credential.

It contains:

- **API Base URL**, for example:

  ```text
  https://api.example.com/api/v1
  ```

- **Service API Token**, an opaque LifeSpace `lsp_pat_*` token;
- **Webhook Signing Secret**, optional for normal LifeSpace nodes and required only when the credential is also used by **LifeSpace Trigger**.

The API Base URL is the LifeSpace Core API root. Do not include a Space ID or Record Type path.

The token is shown only when it is created or rotated. Store it in n8n immediately; do not put it in workflow fields, URLs, source files, or workflow exports.

Runtime Discovery determines which Spaces, Record Types, fields, queries and Actions the current credential can use. Execution authorization is still enforced by LifeSpace from the current principal, credential scope, Application × Model Access and current Space/Data Grant authority.

## LifeSpace contract compatibility

This package follows the current LifeSpace Core Kernel `0.21.0` contract family.

The UX depends on these Kernel capabilities:

- `0.18.0`: cross-Space current-principal Runtime Discovery at `GET /api/v1/me/_discovery`;
- `0.19.0`: authoritative server defaults exposed in Runtime Discovery;
- `0.20.0`: Action semantic input separated from optimistic-concurrency metadata;
- `0.21.0`: current Kernel baseline consumed during this convergence pass.

Ordinary Record CRUD/Action routes remain model-contract surfaces derived from published Model Definitions; the n8n adapter does not maintain a second copy of those schemas.

## Use the LifeSpace node

The normal n8n-facing resource is **Record**. LifeSpace still owns **Model** semantics internally; the adapter uses **Record Type** for the workflow-facing selection.

Supported operations:

- **Create**;
- **Get**;
- **List / Query**;
- **Update**;
- **Delete**;
- **Execute Action**.

### Choose Space and Record Type

For Record operations:

1. choose a **Space** from `/me/_discovery`;
2. choose a **Record Type** available in that Space;
3. configure the operation.

You normally do not type Space IDs or model keys manually.

### Create

Writable fields are generated from Runtime Discovery.

LifeSpace server defaults are authoritative. A field that is `required` but has a declared server default is not required from the n8n user. Read-only state owned by a LifeSpace Action/Capability is not exposed as a normal Create/Update field.

For example, lifecycle state such as Task status can remain server/Action-owned instead of being manually entered by the workflow author.

### Update and Delete

LifeSpace uses optimistic concurrency.

By default the node reads the current Record version immediately before Update/Delete and sends that version with the mutation. This keeps the ordinary n8n UI free from mandatory internal `version` entry while preserving LifeSpace stale-write protection for the actual mutation race.

If a workflow intentionally needs to bind a known version, add **Concurrency Options → Version**.

### List / Query

The normal UI supports:

- optional **Search**;
- one or more **Filters**;
- **Return All** to follow `nextCursor` automatically;
- **Limit** when Return All is disabled.

Advanced **Options** contain:

- optional **Sort Field** and **Sort Direction**;
- manual **Cursor** as an escape hatch.

If Sort is omitted, the adapter omits the query parameter and LifeSpace supplies its deterministic default order. Ordered multi-field sort is not emulated in the adapter; it will be exposed only when the LifeSpace Generic Query contract supports it.

### Execute Action

Choose an Action from Runtime Discovery.

**Action Input** contains only semantic/domain inputs. LifeSpace concurrency metadata is not rendered as a business field. For the current `record-version` contract, the node reads the current Record version immediately before Action execution and sends it using the transport declared by Runtime Discovery.

This means actions such as `complete` / `reopen` no longer ask users to type an internal version value.

### Advanced API Request

The **API Request** resource is an escape hatch for LifeSpace routes that do not yet have dedicated node UX.

Paths are relative to the configured API Base URL, for example:

```text
/me/_discovery
```

Use normal Record operations when possible because they benefit from Runtime Discovery metadata and n8n-specific UX.

## Use the LifeSpace Trigger

The **LifeSpace Trigger** receives signed LifeSpace Domain Event webhooks.

LifeSpace Eventing separates:

- **Webhook Endpoint** — reusable callback URL, signing secret and delivery diagnostics for one Space;
- **Event Subscription** — one Record Type plus selected event types attached to that endpoint.

One Webhook Endpoint can therefore carry events for multiple Record Types through the same n8n callback.

### Trigger setup

1. Add a **LifeSpace Trigger** node.
2. Attach the same **LifeSpace API** credential type used by normal LifeSpace nodes and set its **Webhook Signing Secret**.
3. Choose the **Space** from Runtime Discovery.
4. Choose one or more **Record Types**.
5. Choose the required **Event Types**.
6. Activate the workflow and copy the production webhook URL.
7. In the application/LifeSpace integration management surface, configure one **Webhook Endpoint** using that URL.
8. Store the endpoint's one-time signing secret in the n8n credential.
9. Attach one LifeSpace **Event Subscription** per selected Record Type to the same endpoint, with matching event-type filters.
10. Use the LifeSpace Webhook Endpoint test operation to verify delivery.

The Trigger verifies `X-LifeSpace-Timestamp` and `X-LifeSpace-Signature` with the LifeSpace HMAC-SHA256 contract before emitting workflow data. `endpoint.test` payloads are always accepted after signature verification.

Webhook Endpoint / Event Subscription creation is intentionally not performed by the n8n service credential today because LifeSpace treats that configuration as a Space-management operation. The adapter does not bypass that authority boundary.

## What the package provides

- one **LifeSpace API** credential type for API authentication plus optional webhook verification secret;
- **LifeSpace** node with discovery-driven Record operations plus advanced API Request;
- **LifeSpace Trigger** with signed multi-Record-Type Domain Event filtering;
- dynamic Space, Record Type, field, query, Action and Action Input UI based on Runtime Discovery.

LifeSpace remains authoritative for validation, authorization, defaults, Mutation Authority, Action semantics and event contracts. Runtime Discovery is a current capability/UX projection, not an execution-authorization proof.

## Architecture boundary

LifeSpace is the source of truth for Identity, Authority, Shared Reality semantics, contracts and Eventing. This repository is an n8n Adapter and must not become a second LifeSpace business-contract implementation.

LifeSpace does not depend on n8n. n8n is one optional orchestration/integration runtime consuming LifeSpace APIs and events.

The adapter does not use privileged model-admin endpoints for ordinary workflow discovery and does not copy Model Definitions into this repository.

## Development

Requirements:

- Node.js 22.22.0 or newer;
- npm;
- local n8n for interactive testing.

Validate:

```bash
npm install
npm run lint
npm test
```

`npm test` builds the package before running adapter contract tests.

Run a local n8n development instance:

```bash
npm run dev
```

## Publishing and verification

This repository is public and is intended to remain eligible for n8n Community Node verification.

Publishing is performed by `.github/workflows/publish.yml` from a version tag matching `*.*.*`. npm authentication uses Trusted Publishing through GitHub Actions OIDC and provenance.

Do not publish a verification candidate directly from a developer workstation and do not add a long-lived npm publishing token to the repository.

The package intentionally has no runtime `dependencies`. It must not read environment variables or the local filesystem. Node UI/help text/errors/README/examples remain English-only for n8n verification compatibility.

## Remaining upstream-dependent UX

The adapter deliberately does not invent missing platform semantics. Remaining improvements include:

- ordered multi-field sort after LifeSpace Generic Query supports it;
- canonical field labels after LifeSpace exposes them in Model semantics / Runtime Discovery;
- richer relation selectors when LifeSpace exposes an authorized generic lookup surface appropriate for generated clients.

## License

MIT
