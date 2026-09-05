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

Create a **LifeSpace API** credential for Runtime Discovery and LifeSpace API calls.

It contains:

- **API Base URL**, for example:

  ```text
  https://api.example.com/api/v1
  ```

- **Service API Token**, an opaque LifeSpace `lsp_pat_*` token.

The API Base URL is the LifeSpace Core API root. Do not include a Space ID or Record Type path.

The token is shown only when it is created or rotated. Store it in n8n immediately; do not put it in workflow fields, URLs, source files, or workflow exports.

A **LifeSpace Trigger** additionally uses a **LifeSpace Webhook Signing** credential containing the endpoint-scoped HMAC signing secret. This is deliberately separate from the API credential: the Service API Token authenticates outbound n8n → LifeSpace calls, while the signing secret verifies inbound LifeSpace → n8n deliveries and rotates with its Webhook Endpoint. The Trigger still reuses the LifeSpace API credential for Space/Record Type discovery, so API context is not duplicated.

Runtime Discovery determines which Spaces, Record Types, fields, queries, Actions and relation lookup capabilities the current API credential can use. Execution authorization is still enforced by LifeSpace from the current principal, credential scope, Application × Model Access and current Space/Data Grant authority.

## LifeSpace contract compatibility

This package follows the current LifeSpace Core Kernel `0.23.0` contract family.

The UX depends on these Kernel capabilities:

- `0.18.0`: cross-Space current-principal Runtime Discovery at `GET /api/v1/me/_discovery`;
- `0.19.0`: authoritative server defaults exposed in Runtime Discovery;
- `0.20.0`: Action semantic input separated from optimistic-concurrency metadata;
- `0.21.0`: invitation-token transport hardening retained by the current baseline;
- `0.22.0`: authoritative field `title` metadata plus ordered repeatable Generic Query sort metadata;
- `0.23.0`: authorized source-field-aware Relation Target Lookup for `person` / `person_list` fields.

Ordinary Record CRUD/Action routes remain model-contract surfaces derived from published Model Definitions; the n8n adapter does not maintain a second copy of those schemas.

## Expressions and variables

Runtime/business inputs follow normal n8n expression behavior. A value that can be entered or selected in the node can also be supplied through an n8n expression unless it is deliberately a structural control.

Examples:

```text
{{$json.spaceId}}
{{$json.recordId}}
{{$vars.lifeSpaceRecordType}}
```

Discovery-backed selectors such as **Space**, **Record Type**, **Filter Field**, **Sort Field** and **Action** support the normal n8n pattern: choose a value from the list, or switch the parameter to an expression and provide the corresponding stable ID/key.

The same applies to ordinary values such as Record ID, Search, Filter Value, Return All, Limit, Sort Direction, Cursor, explicit Version, API Method, API Path and JSON Body.

Two boundaries are intentional:

- **Resource** and **Operation** are structural node controls and do not accept expressions because they determine which parameter schema and execution path the node has.
- **Fields** and **Action Input** use n8n's `resourceMapper`. The mapper container is structural, but each generated field value inside it remains expression-capable. This includes relation-backed field values: the UI can offer authorized Person options while an expression can still supply a stable Person ID or ID list.

For **Filters** and **Sorts**, add the required rows in the node UI and use expressions inside each row's Field/Operator/Value or Field/Direction inputs. The number of rows is treated as workflow structure rather than per-item data. This avoids relying on whole-array expressions for n8n `fixedCollection` parameters.

If **Record Type** itself varies per input item and those Record Types have different schemas, one discovery-generated mapper cannot safely represent every possible schema at design time. In that case, branch to separate LifeSpace nodes per schema or use **API Request** for a deliberately fully dynamic request.

A Trigger has no upstream input item. Trigger parameters can still use stable n8n variables/expressions, but should not rely on previous-item `$json` data. Because LifeSpace Webhook Endpoint/Event Subscription configuration is external to the Trigger today, variable-driven Trigger filters should remain stable with that external subscription configuration.

Credentials are intentionally static secure configuration and are not workflow-expression inputs.

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

When Runtime Discovery advertises supported Relation Target Lookup, `person` and `person_list` fields are rendered from the current authorized `{ id, label }` target projection instead of asking the workflow author to type raw `per_*` identifiers. The displayed value is the LifeSpace Person label, while the workflow payload still stores and submits the stable Person ID.

Older compatible Discovery responses without relation lookup metadata retain the raw-ID field behavior. `record` / `record_list` fields also retain raw-ID behavior until LifeSpace defines canonical generic Record reference-label semantics; the adapter does not guess labels from fields such as `name`, `title` or `summary`.

The current n8n Resource Mapper loads bounded relation options when the field schema is requested. Very large target sets should use expressions with stable IDs until n8n exposes a searchable per-field Resource Mapper option surface that can consume LifeSpace's paginated/searchable lookup directly.

### Update and Delete

LifeSpace uses optimistic concurrency.

By default the node reads the current Record version immediately before Update/Delete and sends that version with the mutation. This keeps the ordinary n8n UI free from mandatory internal `version` entry while preserving stale-write protection for the actual mutation race.

If a workflow intentionally needs to bind a known version, add **Concurrency Options → Version**.

### List / Query

The normal UI supports:

- optional **Search**;
- one or more **Filters**;
- **Return All** to follow `nextCursor` automatically;
- **Limit** when Return All is disabled.

Use **Sorts → Add Sort** to add zero or more sort criteria in priority order. Sortable model fields use authoritative `title` metadata from Runtime Discovery, while envelope fields such as `createdAt` / `updatedAt` are offered only when Discovery advertises them. Multiple criteria are sent as ordered repeated `sort=field:direction` query parameters.

Advanced **Options** contain manual **Cursor** as an escape hatch.

If Sorts is omitted, the adapter omits the query parameter and LifeSpace supplies its deterministic default order. Existing workflow exports that still contain the former single `options.sortField` / `options.sortDirection` parameters remain executable for compatibility.

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
2. Attach a **LifeSpace API** credential. The Trigger uses it only for Runtime Discovery and normal LifeSpace API context.
3. Attach a **LifeSpace Webhook Signing** credential containing the signing secret for this Webhook Endpoint.
4. Choose the **Space** from Runtime Discovery.
5. Choose one or more **Record Types**.
6. Choose the required **Event Types**.
7. Activate the workflow and copy the production webhook URL.
8. In the application/LifeSpace integration management surface, configure one **Webhook Endpoint** using that URL.
9. Store the endpoint's one-time signing secret in the Webhook Signing credential.
10. Attach one LifeSpace **Event Subscription** per selected Record Type to the same endpoint, with matching event-type filters.
11. Use the LifeSpace Webhook Endpoint test operation to verify delivery.

The Trigger verifies `X-LifeSpace-Timestamp` and `X-LifeSpace-Signature` with the LifeSpace HMAC-SHA256 contract before emitting workflow data. `endpoint.test` payloads are always accepted after signature verification.

Webhook Endpoint / Event Subscription creation is intentionally not performed by the n8n Service API Token today because LifeSpace treats that configuration as a Space-management operation. The adapter does not bypass that authority boundary.

## What the package provides

- **LifeSpace API** credential for API authentication and Runtime Discovery;
- **LifeSpace Webhook Signing** credential for endpoint-scoped inbound HMAC verification;
- **LifeSpace** node with discovery-driven Record operations plus advanced API Request;
- **LifeSpace Trigger** with signed multi-Record-Type Domain Event filtering;
- dynamic Space, Record Type, field, relation target, query, Action and Action Input UI based on Runtime Discovery.

LifeSpace remains authoritative for validation, authorization, defaults, Mutation Authority, Action semantics, relation semantics and event contracts. Runtime Discovery and Relation Target Lookup are current capability/reference projections, not execution-authorization proofs.

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

The adapter deliberately does not invent missing platform semantics. Remaining relation work is limited to `record` / `record_list` selectors after LifeSpace defines canonical generic Record reference-label semantics. Person relation selection already consumes the LifeSpace 0.23 Runtime/Discovery contract.

## License

MIT
