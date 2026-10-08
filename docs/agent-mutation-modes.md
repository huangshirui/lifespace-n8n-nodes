# LifeSpace Agent Tool mutation modes

The LifeSpace Agent Tool keeps the selected Record Type pinned to one Runtime Discovery snapshot and exposes three mutation modes for Create / Update / Delete.

| Mutation Mode | LifeSpace transport | Semantics |
| --- | --- | --- |
| Single | ordinary Record endpoint | One record per Tool call |
| Bulk | `POST /spaces/{spaceId}/models/bulk` | 1-20 items, independent outcomes, partial success, `blk_*` correlation |
| Atomic Batch | `POST /spaces/{spaceId}/models/batch` | 1-20 items, all-or-none commit, `cgs_*` ChangeSet |

Existing Agent Tool workflows remain **Single** by default. The retired UI-specific `batchCreate` profile remains a runtime compatibility path for already-saved workflows, but new workflows should use Create + Mutation Mode instead.

Bulk and Atomic Batch intentionally cover only `create / update / delete`. LifeSpace Production does not expose a generic Execute Action Batch contract, so the n8n adapter does not emulate one with N Action calls.

For Bulk / Atomic Batch Update and Delete, the AI does not provide record versions. LifeSpace Core resolves omitted versions from the current set-wise snapshot and still enforces optimistic concurrency at commit time.

## Authority

Direct Agent Authority sends no Delegation selector.

When a Tool call uses represented User authority, the selected `dlg_*` is copied onto every operation in the Bulk/Batch body and the outer HTTP request carries no global `X-LifeSpace-Delegation-Id`. This matches the LifeSpace per-operation Batch/Bulk authority contract and keeps the mutation set explicit.

The current Agent Tool is deliberately model-scoped even though the Core Batch/Bulk contract can mix models. One AI Tool instance therefore exposes one Record Type and one operation, keeping the provider-facing contract narrow and reviewable. Cross-model orchestration remains an application/Agent composition concern rather than an unbounded Tool schema.
