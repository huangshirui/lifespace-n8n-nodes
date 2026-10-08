# LifeSpace Person Directory in n8n

## Compatibility

This adapter surface targets the LifeSpace Core Kernel Person Directory contract that is live in Production release #34 (2026-10-08, Core schema 53).

`Person` is a LifeSpace Kernel first-class resource. It is intentionally separate from the ordinary metadata-driven `person_group` model.

## Surfaces

The human-authored **LifeSpace Workflow** node exposes a dedicated **Person** resource with:

- Create
- Get
- Update
- Delete
- List / Search

The **LifeSpace Agent Tool** exposes the same Kernel Person Directory as a selectable **Person** resource. The AI-facing schema carries only semantic Person inputs; version/concurrency metadata remains adapter-owned.

Ordinary **Record** operations remain discovery-driven from Model Registry metadata. A model field of type `person` or `person_list` continues to use the published Relation Target Lookup and stores stable `per_*` references. Person is not injected into the Record Type selector.

## Person operations

Create sends a canonical `displayName` and optional `alternateNames` to the Space Person Directory.

Update supports canonical-name changes plus aggregate alternate-name mutation:

- `set` replaces the complete active alternate-name set;
- `add` adds names;
- `remove` removes active names;
- `rename` renames active names.

Incremental alternate-name operations are submitted as one Person mutation and therefore advance the Person version once. Alias rows are not exposed as independent n8n resources.

For the Workflow node, Update/Delete accept the expected Person `version` explicitly. For the Agent Tool, version is deliberately hidden from the AI schema: the adapter reads the current Person version immediately before Update/Delete and LifeSpace Core remains authoritative for optimistic concurrency and lifecycle checks.

List / Search uses the Core `q`, `limit`, and opaque `cursor` contract. The Workflow node can **Return All** by following cursors. The Agent Tool stays bounded to one page per Tool call so the Agent must explicitly continue with `cursor` when more results are needed.

## Authority

The human-authored Workflow node uses the **LifeSpace Service API** credential and preserves the Service Authority boundary.

The Agent Tool uses the **LifeSpace Agent API** credential (`lsp_agt_*`). Without a `dlg_*` selector it executes with direct Agent Authority. When represented User authority is required, Person requests use a **Space-scoped** Authorization Request (`target.type = space`) because Person is a Kernel Space resource, not a model. The resulting Delegation may then be supplied to the Tool runtime.

Credential proves which Application/Agent is calling; Delegation expresses represented authority. The adapter does not treat Person as an authority-bearing identity and does not invent a `person` delegation target type.
