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
3. Enter the npm package name:

   ```text
   n8n-nodes-lifespace
   ```

   To pin a specific release, enter for example:

   ```text
   n8n-nodes-lifespace@0.1.0
   ```

4. Confirm that you understand the risks of installing community code.
5. Select **Install**.
6. Return to a workflow and search for **LifeSpace** in the node picker.

n8n resolves a package version at install time. Later releases are not installed automatically; update the package from **Settings → Community Nodes** when you want to upgrade.

### Self-hosted n8n: manual npm installation

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-lifespace
```

Restart n8n after installation. In a queue-mode deployment, make sure the package is available to every n8n process that executes workflows.

### n8n Cloud

This package is published on npm and is intended for n8n Community Node verification. Until it is approved as a **Verified Community Node**, direct npm installation is intended for self-hosted n8n. After verification, n8n Cloud owners/admins can discover and install it from the node picker when verified community nodes are enabled for the instance.

## Quick start

Create one **LifeSpace API** credential in n8n.

It contains:

- **API Base URL**, for example:

  ```text
  https://api.example.com/api/v1
  ```

- **Service API Token**, an opaque value beginning with:

  ```text
  lsp_pat_
  ```

- **Webhook Signing Secret**, optional for normal actions and required only when the same credential is attached to **LifeSpace Trigger**.

The API Base URL is the LifeSpace Core API root. It does not contain a Space ID or Record Type path.

The token is shown only when it is created or rotated. Store it in n8n immediately; do not put it in a workflow field, URL, source file, or workflow export.

Runtime Discovery determines which Spaces and Record Types the current credential can use. Real authorization still comes from current LifeSpace credential scopes, Application × Model Access and Space/Data Grant authority.

## Use the LifeSpace node

The normal resource is **Record**. `Model` remains a LifeSpace semantic/runtime concept, while the n8n-facing UX talks about records and record types.

Supported operations:

- **Create** — create a record;
- **Get** — get one record by ID;
- **List / Query** — search, filter, sort and page through records;
- **Update** — update a record with optimistic concurrency;
- **Delete** — delete a record with optimistic concurrency;
- **Execute Action** — run a published LifeSpace workflow/Capability action.

### Choose Space and Record Type

For Record operations:

1. choose a **Space** from the current credential's `/me/_discovery` result;
2. choose a **Record Type** available in that Space;
3. configure the operation.

You normally do not type a Space ID or Record Type key manually.

### Create or update a record

Choose **Create** or **Update**, then fill the dynamically generated **Fields** form.

The field list is generated from LifeSpace Runtime Discovery rather than copied into this package. Until LifeSpace exposes canonical human-facing field labels, this adapter uses a simple key-to-label fallback for display only; the stable field key is still sent to LifeSpace.

Update also requires the record's current **Version** because LifeSpace currently exposes optimistic concurrency as part of the Runtime contract.

### List / Query records

The default UI supports:

- optional **Search**;
- one or more **Filters**;
- **Return All** to automatically follow `nextCursor` values;
- **Limit** when Return All is disabled.

Advanced **Options** contain:

- an optional single **Sort Field** and **Sort Direction**;
- a manual **Cursor** escape hatch.

If no sort is configured, the node omits the `sort` parameter and LifeSpace supplies its deterministic default ordering. Multi-field sorting will be exposed only after the LifeSpace query contract supports it.

### Execute an action

Choose an action from Runtime Discovery and fill the generated **Action Input** form.

The node does not maintain a second copy of action schemas. Current LifeSpace Discovery may still expose optimistic-concurrency metadata such as `version` as an Action input; the adapter deliberately does not invent a separate transport convention before the LifeSpace contract is refined.

### Advanced API Request

The **API Request** resource is an escape hatch for LifeSpace routes that do not yet have dedicated node UX.

Paths are relative to the configured API Base URL. For example:

```text
/me/_discovery
```

Use normal Record operations when they cover your use case because they benefit from discovery-driven selectors and field/query metadata.

## Use the LifeSpace Trigger

The **LifeSpace Trigger** receives signed LifeSpace Domain Event webhooks.

LifeSpace separates:

- **Webhook Endpoint** — one reusable destination URL, signing secret and delivery diagnostics for one Space;
- **Event Subscription** — one Record Type plus selected event types attached to that endpoint.

One Webhook Endpoint can therefore carry events for multiple Record Types through the same n8n webhook URL.

### Trigger setup

1. Add a **LifeSpace Trigger** node.
2. Attach the same **LifeSpace API** credential type used by normal LifeSpace nodes and make sure its **Webhook Signing Secret** is set.
3. Choose the **Space** from Runtime Discovery.
4. Choose one or more **Record Types**.
5. Choose the required **Event Types**.
6. Activate the workflow and copy the Trigger's production webhook URL.
7. In the application/LifeSpace integration management UI, configure one **Webhook Endpoint** using that URL.
8. Store the endpoint's one-time signing secret in the n8n credential.
9. Attach one LifeSpace **Event Subscription** per selected Record Type to the same endpoint, with matching event-type filters.
10. Use LifeSpace's Webhook Endpoint test operation to confirm delivery.

The Trigger verifies `X-LifeSpace-Timestamp` and `X-LifeSpace-Signature` with the LifeSpace HMAC-SHA256 contract before emitting workflow data. `endpoint.test` payloads are always accepted after signature verification.

Webhook Endpoint / Event Subscription creation is intentionally not performed by the n8n service credential today because LifeSpace treats that configuration as a Space-management operation. This adapter does not bypass that authority boundary.

## What the package provides

- one **LifeSpace API** credential type for API authentication plus optional webhook verification secret;
- **LifeSpace** node: discovery-driven Record operations plus advanced API Request;
- **LifeSpace Trigger**: signed multi-Record-Type Domain Event webhook trigger;
- dynamic Space, Record Type, field, query, Action and Action Input UI based on current LifeSpace Runtime Discovery.

LifeSpace Core remains authoritative for validation and authorization when an operation executes. Runtime Discovery is a dynamic UX/capability preview, not an execution-authorization proof.

## Architecture boundary

LifeSpace is the source of truth for identity, authorization, domain semantics, contracts and events. This repository is an n8n-specific adapter and must not become a second copy of LifeSpace business contracts.

LifeSpace does not depend on n8n. n8n is one optional orchestration and integration runtime that consumes LifeSpace APIs and events.

The node does not use privileged `model-admin/contracts/*` endpoints for ordinary workflow discovery and does not copy Model Definitions into this repository.

## Development

Requirements:

- Node.js 22.22.0 or newer;
- npm;
- a local n8n instance for interactive node testing.

Install and validate:

```bash
npm install
npm test
npm run lint
npm run build
```

Run the node in a local n8n development instance:

```bash
npm run dev
```

## Publishing and verification

This repository is public and is intended to remain eligible for n8n Community Node verification.

Publishing is performed by `.github/workflows/publish.yml` from a version tag matching `*.*.*`. npm authentication uses **Trusted Publishing** through GitHub Actions OIDC, and the workflow has `id-token: write` so npm can attach provenance to releases.

Do not publish a verification candidate directly from a developer workstation and do not add a long-lived npm publishing token back to the repository.

The package intentionally has no runtime `dependencies`. It must not read environment variables or the local filesystem. Node UI, help text, errors, README content and examples remain English-only for n8n verification compatibility.

## Planned surfaces

- authoritative Create/default semantics from LifeSpace Runtime Discovery;
- canonical human-facing field labels from LifeSpace semantics;
- ordered multi-field sort after the LifeSpace query contract supports it;
- refined optimistic-concurrency transport metadata for Actions;
- richer relation selectors when LifeSpace exposes an appropriate authorized lookup surface;
- delegated Webhook Endpoint / Event Subscription management if LifeSpace later exposes an appropriate user-authorized integration contract;
- OAuth `client_credentials` support where required.

## License

MIT
