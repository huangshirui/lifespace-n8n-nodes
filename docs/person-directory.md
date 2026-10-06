# LifeSpace Person Directory in n8n

## Compatibility

This adapter surface depends on the LifeSpace Core Kernel `0.47.0` Person Directory contract introduced by LifeSpace Core PR `#322`.

Do not publish an npm release containing this surface before the matching Core contract has been merged and validated in staging.

## Boundary

`Person` is a LifeSpace Kernel resource, not a metadata-driven ordinary Record Type.

The human-authored **LifeSpace Workflow** node therefore exposes a dedicated **Person** resource with:

- Create
- Get
- Update
- Delete
- List / Search

Ordinary **Record** operations remain discovery-driven from Model Registry metadata. A model field of type `person` or `person_list` continues to use the published Relation Target Lookup and stores stable `per_*` references. Person is not injected into the Record Type selector.

## Person operations

Create sends a canonical `displayName` and optional `alternateNames` to the Space Person Directory.

Update requires the current Person `version` and supports canonical-name changes plus aggregate alternate-name mutation:

- `set` replaces the complete active alternate-name set;
- `add` adds names;
- `remove` removes active names;
- `rename` renames active names.

Incremental alternate-name operations are submitted as one Person mutation and therefore advance the Person version once. Alias rows are not exposed as independent n8n resources.

Delete requires the current Person `version`. LifeSpace Core remains authoritative for lifecycle constraints, including rejecting deletion of a Person linked to a current User or referenced by active ordinary records.

List / Search supports the Core `q`, `limit`, and opaque `cursor` contract. **Return All** follows the cursor until no next page remains.

## Authority

The human-authored Workflow node uses the existing **LifeSpace Service API** credential and therefore preserves the ordinary Service Authority boundary.

Agent execution and represented User authority remain separate concerns owned by the LifeSpace Agent Tool / User Authorization flow; this Workflow resource does not silently substitute Service authority for delegated User authority.
