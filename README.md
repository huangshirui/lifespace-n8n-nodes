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

Manual installation is useful for queue-mode deployments or environments where community packages are managed outside the n8n UI.

Enter the n8n container or host, then install the package in the n8n community-node directory:

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-lifespace
```

Restart n8n after installation. In a queue-mode deployment, make sure the package is available to every n8n process that executes workflows.

### n8n Cloud

This package is published on npm and is intended for n8n Community Node verification. Until it is approved as a **Verified Community Node**, direct npm installation is intended for self-hosted n8n. After verification, n8n Cloud owners/admins can discover and install it from the node picker when verified community nodes are enabled for the instance.

## Quick start

The normal setup has two parts:

1. configure a LifeSpace integration and obtain its connection values;
2. add those values to an n8n **LifeSpace Connection API** credential.

### 1. Create a LifeSpace connection

Configure the external integration in the application Web administration surface first. The integration binds the target Space and the model permissions that the external system may use.

For HomeMew, use the external-system/integration settings in HomeMew Web.

For an API Token connection, copy the two values shown by the application:

- **Connection Base URL**, for example:

  ```text
  https://core.aisr.online/api/v1/spaces/spc_...
  ```

- **Service API Token**, an opaque value beginning with:

  ```text
  lsp_pat_
  ```

The token is shown only when it is created or rotated. Store it in n8n immediately; do not put it in a workflow field, URL, source file, or workflow export.

### 2. Create the n8n credential

In n8n:

1. Add a **LifeSpace** node to a workflow.
2. In **Credential to connect with**, create a new **LifeSpace Connection API** credential.
3. Paste:
   - **Connection Base URL**
   - **Service API Token**
4. Save the credential.

The Space is already encoded in the Connection Base URL. Individual LifeSpace nodes therefore do **not** ask for a separate Space ID.

The URL is routing context only. Real authorization still comes from the Service API Token plus current LifeSpace credential scopes, Application × Model Access and Space/Data Grant authority.

## Use the LifeSpace node

The **LifeSpace** node exposes the **Model Record** resource for normal LifeSpace data operations.

Choose a model from the dynamic **Model** selector. The list comes from LifeSpace Runtime Discovery and only contains models that the current connection can use.

Supported operations:

- **Create** — create a record;
- **Get** — get one record by ID;
- **List / Query** — search, filter, sort and page through records;
- **Update** — update a record with optimistic concurrency;
- **Delete** — delete a record with optimistic concurrency;
- **Execute Action** — run a published LifeSpace workflow/Capability action.

### Example: create a record

1. Add a **LifeSpace** node.
2. Set **Resource** to **Model Record**.
3. Set **Operation** to **Create**.
4. Choose the model from **Model**.
5. Fill in the dynamically generated **Fields** form.
6. Execute the node.

The field UI is generated from the selected model's current LifeSpace metadata. Required fields, enums and supported primitive types are provided dynamically instead of being hard-coded in this package.

### Example: query records

1. Set **Operation** to **List / Query**.
2. Choose a model.
3. Optionally configure:
   - **Search**;
   - one or more **Filters**;
   - **Sort Field** and **Sort Direction**;
   - **Limit**;
   - **Cursor** for the next page.
4. Execute the node.

Only query fields declared searchable/filterable/sortable by LifeSpace are offered.

### Example: update or delete a record

Update and Delete use LifeSpace optimistic concurrency.

Provide:

- the **Record ID**;
- the record's current **Version**;
- for Update, the writable fields you want to change.

If another writer has already changed the record, LifeSpace rejects the stale version instead of silently overwriting newer data.

### Example: execute an action

1. Set **Operation** to **Execute Action**.
2. Choose the model and record.
3. Choose an **Action** from the dynamic selector.
4. Fill in the dynamically generated **Action Input** form when the Action has semantic/domain inputs.
5. Execute the node.

LifeSpace Runtime Discovery keeps **Action semantic input** separate from technical optimistic-concurrency metadata. The Action Input form therefore contains only model/Capability-owned business inputs; an Action with no domain input has no business fields to fill in.

When the selected Action declares the `record-version` concurrency strategy, the node reads the current record immediately before execution and injects the required concurrency evidence using the transport metadata supplied by LifeSpace. The adapter does not hard-code a model-specific Action schema or expose the concurrency field as ordinary business input. If the record changes again between that read and Action execution, LifeSpace still rejects the stale write through its normal optimistic-concurrency guard.

For compatibility with older LifeSpace Runtime Discovery versions that represented concurrency inside Action Input, the node continues to send the discovered input unchanged when no separate `concurrency` metadata is present.

### Advanced API Request

The **API Request** resource is an escape hatch for advanced LifeSpace routes that do not yet have dedicated node UX.

Paths are relative to the configured Connection Base URL. Use the normal Model Record operations when they cover your use case, because they benefit from the discovery-driven UI.

## Use the LifeSpace Trigger

The **LifeSpace Trigger** receives signed LifeSpace Domain Event webhooks.

The current LifeSpace eventing model separates:

- **Webhook Endpoint** — destination URL, signing secret and delivery diagnostics;
- **Event Subscription** — model/event filters attached to that endpoint.

### Trigger setup

1. Add a **LifeSpace Trigger** node to an n8n workflow.
2. Activate the workflow and copy the Trigger's production webhook URL.
3. In the application/LifeSpace integration management UI, create a **Webhook Endpoint** using that n8n webhook URL.
4. Copy the one-time webhook signing secret returned by LifeSpace.
5. In n8n, create a **LifeSpace Webhook API** credential and paste the signing secret into it.
6. Attach that credential to the LifeSpace Trigger.
7. Create one or more **Event Subscription** filters for the required Space/model/event types and attach them to the Webhook Endpoint.
8. Use LifeSpace's endpoint test operation to confirm delivery.

The Trigger verifies `X-LifeSpace-Timestamp` and `X-LifeSpace-Signature` with the LifeSpace HMAC-SHA256 contract before emitting workflow data.

Optionally configure expected Space/model filters in the Trigger as an additional local safety check.

## What the package provides

- **LifeSpace Connection API** credential: Connection Base URL + `lsp_pat_*` Service API Token;
- **LifeSpace Webhook API** credential: webhook signing secret;
- **LifeSpace** node: discovery-driven Model Record operations plus advanced API Request;
- **LifeSpace Trigger**: signed Domain Event webhook trigger;
- dynamic Model, field, query, Action and semantic Action Input UI based on current LifeSpace Runtime Discovery;
- discovery-driven Action concurrency handling without copying model-specific mutation semantics into the adapter.

LifeSpace Core remains authoritative for validation and authorization when an operation executes. Runtime Discovery is a dynamic UX/capability preview, not an execution-authorization proof.

## Architecture boundary

LifeSpace is the source of truth for identity, authorization, domain models, contracts and events. This repository is an n8n-specific adapter and must not become a second copy of LifeSpace business contracts.

LifeSpace does not depend on n8n. n8n is one optional orchestration and integration runtime that consumes LifeSpace APIs and events.

The node does not use privileged `model-admin/contracts/*` endpoints for ordinary workflow discovery and does not copy model definitions into this repository.

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

## Publishing and verification

This repository is public and is intended to remain eligible for n8n Community Node verification.

Publishing is performed by `.github/workflows/publish.yml` from a version tag matching `*.*.*`. npm authentication uses **Trusted Publishing** through GitHub Actions OIDC, and the workflow has `id-token: write` so npm can attach provenance to releases.

Do not publish a verification candidate directly from a developer workstation and do not add a long-lived npm publishing token back to the repository.

The package intentionally has no runtime `dependencies`. It must not read environment variables or the local filesystem. Node UI, help text, errors, README content and examples remain English-only for n8n verification compatibility.

## Planned surfaces

- richer relation selectors when LifeSpace exposes an appropriate authorized lookup surface;
- a more explicit n8n AI Tool experience for approved LifeSpace actions if the generic tool-capable node proves insufficient;
- delegated Webhook Endpoint / Event Subscription management if LifeSpace later exposes an appropriate user-authorized integration contract;
- OAuth `client_credentials` support where required.

## License

MIT
