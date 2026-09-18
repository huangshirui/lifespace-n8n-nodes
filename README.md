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

Runtime Discovery determines which Spaces, Record Types, fields, queries, Actions and relation lookup capabilities the current API credential can use. The adapter starts from the compact current-principal inventory, then loads static semantic detail only for the selected Space/Record Type. Relation target lookup remains lazy and field-scoped. Execution authorization is still enforced by LifeSpace from the current principal, credential scope, Application × Model Access and current Space/Data Grant authority.

## Generated Record UX

The package deliberately exposes two different projections over the same LifeSpace Runtime Discovery semantics:

- **LifeSpace** is the human-authored workflow node. Create/Update fields are generated through n8n Resource Mapper from the selected Record Type, so field type, required state, enum values, calendar dates and supported single relations determine the control automatically. List / Query exposes semantic predicates such as `Status — Is One Of` or `Due Date — After or Equal` instead of asking the workflow author to choose a filter type first. Multi-value relations keep their dedicated multi-select UX.
- **LifeSpace Agent Tool** is the native AI Tool surface. Its schema is generated from `query.canonical`: queries expose semantic `field` / `operator` / `value` inputs, and the adapter compiles them into the same structured Canonical Query used by human workflows.

The human workflow node is not exposed through `usableAsTool`; this avoids maintaining two competing Agent Tool surfaces with different schema behavior.

The node displays the authorized human-readable `spaceName` when present while continuing to submit the stable `spc_*` ID.

Record Type is the LifeSpace `modelKey` (for example `task`). Design-time options, expressions, Trigger output and downstream Record nodes all use that plain value. CRUD calls go directly to `/spaces/{spaceId}/models/{modelKey}/records/...`, so execution adds no Discovery request and the adapter maintains no modelKey-to-route mapping. Existing `lsrt1...` workflow values are decoded only as a deprecated read-compatibility path and are never emitted or written by new configuration.

Current Calendar models expose the canonical `capabilityBindings.calendar.rangeField` role, which points at one authoritative `temporal_range` field (for example Event v6 `when`). Historical split-field Calendar bindings remain readable only for already-published compatibility models. Date-only values are normalized to `YYYY-MM-DD`; `instant` uses the n8n date-time control, while `range<date>`, `range<instant>` and `temporal_range` use object inputs that preserve the LifeSpace canonical value shape. Create/Update execution does not fetch fresh semantic Discovery solely to produce an adapter-local Calendar conflict error; the canonical mutation goes directly to LifeSpace Core, which remains authoritative for Calendar validation and current authorization.

## LifeSpace contract compatibility

This package follows the current LifeSpace Core Kernel `0.36.0` contract family. It consumes Runtime/Discovery semantics only; Eventing configuration and webhook delivery semantics are owned independently by Integration/Eventing `0.1.0`.

The UX depends on these Kernel capabilities:

- `0.18.0`: cross-Space current-principal Runtime Discovery at `GET /api/v1/me/_discovery`;
- `0.19.0`: authoritative server defaults exposed in Runtime Discovery;
- `0.20.0`: Action semantic input separated from optimistic-concurrency metadata;
- `0.21.0`: invitation-token transport hardening retained by the current baseline;
- `0.22.0`: authoritative field `title` metadata plus ordered repeatable Generic Query sort metadata;
- `0.23.0`: authorized source-field-aware Relation Target Lookup for `person` / `person_list` fields;
- `0.24.0`: authorized human-readable `spaceName` projection while `spaceId` remains stable;
- `0.25.0`: bounded Capability field-role bindings, beginning with Calendar;
- `0.26.0`: progressively loadable single-model static semantic detail;
- `0.27.0`: compact current-principal inventory that de-duplicates model semantics from Space visibility edges;
- `0.28.0`: bounded batch Reference Resolution for relation IDs;
- `0.29.0`: canonical ordinary-record `referenceLabel` semantics plus `record` / `record_list` lookup and resolution;
- `0.30.0`: explicit paginated Change History collection and Model Control Plane ownership split;
- `0.31.0`: Integration/Eventing wire representation moves to the independent Integration/Eventing `0.1.0` contract while Core remains the Runtime authority.
- `0.32.0`: `modelKey` becomes the sole Runtime address and canonical CRUD/Action paths move under `/models/{modelKey}/records`.
- `0.33.0`: canonical structural `timeRanges` become available in progressive semantic detail without implying an overlap query API.
- `0.34.0`: explicit `eq/lt/lte/gt/gte` comparison transports, first-class `createdAt` / `updatedAt` envelope comparisons and Core-owned datetime local-date-window conversion become discoverable.
- `0.35.0`: grouped `query.capabilityQueries` introduced capability-owned compatibility queries.
- `0.36.0`: `query.canonical` unifies Search, typed Boolean Filter, multi-Sort and cursor Pagination behind `POST .../records/query`; Runtime Discovery also exposes canonical `instant`, `range<date>`, `range<instant>`, `temporal_range` field types and the Calendar `rangeField` binding. The human Workflow node consumes those current semantics while retaining historical Discovery spellings only for compatibility.

The adapter prefers the `0.27+` progressive flow while configuring a node:

```text
GET /me/_discovery/inventory
  -> choose current Space / Record Type
  -> GET /spaces/{spaceId}/_discovery/models/{modelKey}
  -> relation target lookup / reference resolution only when needed
  -> persist stable workflow configuration
```

Design-time callbacks prefer n8n editor-current parameters, so Fields and Actions refresh immediately after Record Type selection. A legacy 0.1.3 `modelRoute` remains readable only for the four previously deployed baseline models; re-selecting Record Type writes the plain `modelKey`.

Execution is deliberately narrower. Get/List/Create/Update/Delete call the canonical modelKey-addressed Runtime path directly without a fresh Runtime Discovery preflight. Execute Action loads only the selected model's `0.26+` static semantic detail, and reuses that detail within the same node execution for repeated items using the same Space/Record Type. No cached Discovery result is treated as authorization proof; every CRUD or Action request still goes through canonical LifeSpace Core current-state enforcement.

The legacy aggregate `GET /me/_discovery` remains an intentional design-time compatibility fallback. Neither cached Discovery nor relation lookup is treated as authorization proof; every mutation still goes through canonical LifeSpace Runtime enforcement.

Ordinary Record CRUD/Action routes remain model-contract surfaces derived from published Model Definitions; the n8n adapter does not maintain a second copy of those schemas.

## Canonical Query

New Workflow and Agent configurations expose one query model:

- **Search** is a top-level retrieval facet when the selected Record Type publishes searchable fields.
- **Filters** use a grouped human builder over `query.canonical.filter.targets`. Ordinary conditions render inline as a compact Discovery-published field/operator selector plus string/expression Value; the adapter parses number/integer/boolean values and canonical JSON operands back into the typed Canonical Filter AST.
- **Match** supports top-level All/Any composition, with one level of nested Condition Groups that each have their own All/Any rule.
- **Sorts** come from `query.canonical.sort.fields` and preserve user priority.
- **Return All**, **Limit**, and the optional opaque **Cursor** use canonical cursor pagination.

Execution sends `POST /spaces/{spaceId}/models/{modelKey}/records/query` with a structured body. The current UI does not expose Standard Query, Capability Query, or transport parameter names. Stored workflows that explicitly selected a legacy Capability Query remain executable through a hidden compatibility path, but new configurations cannot create that split.

## Expressions and variables

Runtime/business inputs follow normal n8n expression behavior. A value that can be entered or selected in the node can also be supplied through an n8n expression unless it is deliberately a structural control.

Examples:

```text
{{$json.spaceId}}
{{$json.recordId}}
{{$json.recordType}}
{{$vars.lifeSpaceRecordType}}
```

Discovery-backed selectors such as **Space**, **Sort Field** and **Action** support the normal n8n pattern: choose a value from the list, or switch the parameter to an expression and provide the corresponding stable ID/key. **Record Type** stores the plain LifeSpace `modelKey`, so a LifeSpace Trigger can feed a Record node directly without a mapping step or an extra Discovery request.

The same applies to ordinary values such as Record ID, Search, Return All, Limit, Sort Direction, Cursor, explicit Version, API Method, API Path and JSON Body.

Two boundaries are intentional:

- **Resource** and **Operation** are structural node controls and do not accept expressions because they determine which parameter schema and execution path the node has.
- **Fields** and **Action Input** remain generated from Runtime Discovery. **Filters** use Discovery-backed field/operator selectors plus string/expression values so Boolean grouping does not depend on dynamically changing n8n value-control types.

For List / Query, **Filters** is a Discovery-driven grouped condition builder. Ordinary conditions render inline in the wide parameter pane instead of as expandable fixed-collection cards. A condition selects a predicate from `query.canonical`, such as `Due Date — After or Equal`, and enters its value as text or an n8n expression. The adapter deterministically converts that text back to the canonical typed value before the request. Structured Range/TemporalRange/`within` operands use canonical JSON text in this first builder version. Condition Groups remain explicit containers because they represent nested Boolean structure; their member conditions use the same inline row layout. **Sorts** remains an ordered structural list because sort priority is part of workflow structure rather than per-item data.

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

1. choose a **Space** from compact Runtime Discovery inventory;
2. choose a **Record Type** available in that Space;
3. configure the operation; the selected model's semantic detail is loaded only when required.

You normally do not type Space IDs or model keys manually.

### Create

Writable fields are generated from Runtime Discovery.

LifeSpace server defaults are authoritative. A field that is `required` but has a declared server default is not required from the n8n user. Read-only state owned by a LifeSpace Action/Capability is not exposed as a normal Create/Update field.

For example, lifecycle state such as Task status can remain server/Action-owned instead of being manually entered by the workflow author.

When Runtime Discovery advertises relation semantics, supported single-value `person` / `record` fields are rendered as selectors from the current authorized `{ id, label }` target projection. Multi-value relations retain the dedicated multi-select control rather than falling back to n8n Resource Mapper's generic JSON array editor. The displayed value is the canonical LifeSpace reference label, while the workflow payload still stores and submits the stable target ID.

Older compatible Discovery responses without relation lookup metadata retain the raw-ID field behavior. The adapter never guesses record labels from conventional fields such as `name`, `title` or `summary`.

The current n8n UI loads bounded relation options when the relevant field is configured. Very large target sets should use expressions with stable IDs until n8n exposes a searchable dynamic relation option surface that can consume LifeSpace's paginated/searchable lookup directly.

At execution time Create uses the already-configured Record Type selector and sends the canonical mutation directly. This avoids paying a current-principal inventory round trip merely to rediscover whether adapter-side semantic preflight would improve an error message. Core remains the final authority for schema, Capability, Policy and authorization checks.

### Update and Delete

LifeSpace uses optimistic concurrency.

By default the node reads the current Record version immediately before Update/Delete and sends that version with the mutation. This keeps the ordinary n8n UI free from mandatory internal `version` entry while preserving stale-write protection for the actual mutation race.

Update does not add a Runtime Discovery request before the mutation. When no explicit version is configured, the current-record read is for optimistic concurrency rather than semantic discovery. Core validates Calendar and other Capability semantics against the resulting mutation.

If a workflow intentionally needs to bind a known version, add **Concurrency Options → Version**.

### List / Query

List / Query exposes the single LifeSpace Canonical Query model:

- optional **Search** over fields published as searchable;
- grouped **Filters** generated from the selected Record Type's canonical targets and operators;
- top-level **Match All / Match Any** plus one nested Condition Group level for Boolean composition;
- string/expression values that are parsed back to canonical scalar values, with canonical JSON text for structured Range/TemporalRange/`within` operands;
- ordered **Sorts** generated from canonical sortable fields;
- optional **Viewing Timezone** context when sorting a `temporal_range` field;
- **Return All**, **Limit**, and an optional opaque **Cursor**.

The node sends one structured `POST .../records/query` request per page. Top-level and nested All/Any settings lower to canonical `and`/`or` groups. Relation membership still uses canonical `contains`; Core remains responsible for final contract validation, timezone/DST conversion, authorization, null-last ordering and cursor identity. Stored workflows using the previous Resource Mapper and Time Window controls remain execution-compatible through hidden adapter fallbacks.

New configurations do not expose Standard Query or Capability Query. Stored workflows that explicitly selected the previous Capability Query remain executable through a hidden compatibility path.

### Execute Action

Choose an Action from Runtime Discovery.

**Action Input** contains only semantic/domain inputs. LifeSpace concurrency metadata is not rendered as a business field. For the current `record-version` contract, the node reads the current Record version immediately before Action execution and sends it using the transport declared by Runtime Discovery.

Execution-time Action metadata is loaded directly from the selected model's static semantic-detail endpoint rather than first loading the broad current-principal inventory. Human Action Input uses the same current field-type projection as Create/Update, including `instant`, fixed Range values and `temporal_range`. The static detail is reused for repeated items of the same Space/Record Type during one node execution. It is semantic input only, not cached authority; Core rechecks current Action authority on every invocation.

This means actions such as `complete` / `reopen` no longer ask users to type an internal version value.

### Advanced API Request

The **API Request** resource is an escape hatch for LifeSpace routes that do not yet have dedicated node UX.

Paths are relative to the configured API Base URL, for example:

```text
/me/_discovery/inventory
```

Use normal Record operations when possible because they benefit from Runtime Discovery metadata and n8n-specific UX.

## Use the LifeSpace Agent Tool

Use **LifeSpace Agent Tool** when connecting LifeSpace to an n8n AI Agent. This is a separate native AiTool surface rather than the human workflow node running through `usableAsTool`.

Configure the Tool's structural scope — Space, Record Type and operation — in the node. The Tool then derives its model-facing name, description and input schema from Runtime Discovery, so multiple LifeSpace Tools can distinguish their configured purpose without requiring handwritten descriptions.

For Canonical Query, the model receives semantic inputs such as:

```json
{
  "search": "food",
  "filters": [
    { "field": "status", "operator": "eq", "value": "pending" },
    { "field": "dueDate", "operator": "gte", "value": "2026-09-13" }
  ],
  "sort": [{ "field": "dueDate", "direction": "asc" }],
  "limit": 20
}
```

The adapter validates fields and operators against `query.canonical` and compiles them into the same structured Canonical Filter/Sort/Page request used by the human Workflow node. Local date windows remain explicit typed values; Core owns timezone and DST conversion.

Create/Update schemas are generated from writable model fields. Optional fields that the model does not provide are omitted rather than synthesized as empty values. Actions remain metadata-driven, and adding a future Record Type does not require a model-specific `create_*` or `query_*` node implementation.

## Use the LifeSpace Trigger

The **LifeSpace Trigger** receives signed LifeSpace Domain Event webhooks.

LifeSpace Eventing separates:

- **Webhook Endpoint** — reusable callback URL, signing secret and delivery diagnostics for one Space;
- **Event Subscription** — one Record Type plus selected event types attached to that endpoint.

One Webhook Endpoint can therefore carry events for multiple Record Types through the same n8n callback. In n8n this is represented as one Trigger selecting multiple Record Types; Integration/Eventing still keeps one Event Subscription filter per Record Type.

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

For ordinary record events, the Trigger preserves the LifeSpace `modelKey` exactly as delivered and emits the same plain value as `recordType` for n8n composition. Pass `{{$json.recordType}}` and `{{$json.recordId}}` directly to a downstream LifeSpace Record node; it calls the canonical modelKey-addressed Runtime path with zero Discovery.

Webhook Endpoint / Event Subscription creation is intentionally not performed by the n8n Service API Token today because LifeSpace treats that configuration as a Space-management operation. The adapter does not bypass that authority boundary.

## What the package provides

- **LifeSpace API** credential for API authentication and Runtime Discovery;
- **LifeSpace Webhook Signing** credential for endpoint-scoped inbound HMAC verification;
- **LifeSpace** human workflow node with Discovery-driven Record operations plus advanced API Request;
- **LifeSpace Agent Tool** native AiTool with Discovery-driven semantic schemas;
- **LifeSpace Trigger** with signed multi-Record-Type Domain Event filtering;
- shared thin adapter projection from LifeSpace Runtime Discovery into human n8n controls and model-facing Tool schemas.

LifeSpace remains authoritative for validation, authorization, defaults, Mutation Authority, Action semantics, query/time semantics, relation semantics and event contracts. Runtime Discovery and Relation Target Lookup are current capability/reference projections, not execution-authorization proofs.

## Architecture boundary

LifeSpace is the source of truth for Identity, Authority, Shared Reality semantics, contracts and Eventing. This repository is an n8n Adapter and must not become a second LifeSpace business-contract implementation.

LifeSpace does not depend on n8n. n8n is one optional orchestration/integration runtime consuming LifeSpace APIs and events.

The human Workflow node and native Agent Tool are separate presentation projections over the same LifeSpace semantics. Shared code in this package only translates Discovery into n8n-specific UI/schema/transport; it does not redefine domain rules.

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

The adapter now consumes generic `person`, `person_list`, `record` and `record_list` reference labels/lookups when LifeSpace advertises them, and uses Calendar Capability bindings rather than model-specific field names. Remaining UX work should be driven by explicit future LifeSpace contract additions or n8n UI limitations; the adapter must not invent missing semantics locally.

## License

MIT