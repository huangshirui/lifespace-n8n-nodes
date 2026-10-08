# LifeSpace Agent Tool record mutation options

Create / Update / Delete use the same mutation concepts as the ordinary LifeSpace Record node. The controls live in the final **Options** collection rather than beside Operation.

| Option | Default | LifeSpace transport | Semantics |
| --- | --- | --- | --- |
| Batch Processing = On, Atomic Consistency = Off | Yes | `POST /spaces/{spaceId}/models/bulk` | 1-20 items, independent outcomes, partial success, `blk_*` correlation |
| Batch Processing = On, Atomic Consistency = On | No | `POST /spaces/{spaceId}/models/batch` | 1-20 items, all-or-none commit, `cgs_*` ChangeSet |
| Batch Processing = Off | No | ordinary Record endpoint | One record per Tool call |

Batch Processing is a workflow/Tool design choice and defaults **On**. It is deliberately not exposed as an AI-controlled parameter. Atomic Consistency defaults **Off** because multiple items alone do not imply one indivisible business change.

## Let the model decide Atomic Consistency

The workflow owner may keep Atomic Consistency fixed, or use n8n's native **Let the model define this parameter** control (`$fromAI(...)`) on Atomic Consistency. When it is delegated to the model, the LifeSpace Agent Tool projects the generated `$fromAI` key into the provider-facing Tool schema as an optional boolean with default `false`.

The Tool contract explicitly tells the Agent:

- omit the argument or use `false` for normal non-atomic Bulk;
- use `true` only when the user's intent requires the whole mutation set to succeed or roll back together;
- do not choose Atomic merely because the call contains multiple items.

This means the model learns the decision rule from the actual function schema and Tool description it receives. The adapter then removes that control argument from semantic record data and selects `/models/bulk` or `/models/batch` for the current call.

The retired Agent `batchCreate` operation is not supported. New and saved workflows must use Create / Update / Delete plus the Options above.

Bulk and Atomic Batch intentionally cover only `create / update / delete`. LifeSpace Production does not expose a generic Execute Action Batch contract, so the n8n adapter does not emulate one with N Action calls.

For Bulk / Atomic Batch Update and Delete, the AI does not provide record versions. LifeSpace Core resolves omitted versions from the current set-wise snapshot and still enforces optimistic concurrency at commit time.

## Authority

Direct Agent Authority sends no Delegation selector.

When a Tool call uses represented User authority, the selected `dlg_*` is copied onto every operation in the Bulk/Batch body and the outer HTTP request carries no global `X-LifeSpace-Delegation-Id`. This matches the LifeSpace per-operation Batch/Bulk authority contract and keeps the mutation set explicit.

The current Agent Tool is deliberately model-scoped even though the Core Batch/Bulk contract can mix models. One AI Tool instance therefore exposes one Record Type and one operation, keeping the provider-facing contract narrow and reviewable. Cross-model orchestration remains an application/Agent composition concern rather than an unbounded Tool schema.
