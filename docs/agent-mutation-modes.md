# LifeSpace Agent Tool record mutation options

Create / Update / Delete use the same mutation concepts as the ordinary LifeSpace Record node. The controls live in the final **Options** collection rather than beside Operation.

| Option | Default | LifeSpace transport | Semantics |
| --- | --- | --- | --- |
| Batch Processing = On, Atomic Consistency = Off | Yes | `POST /spaces/{spaceId}/models/bulk` | 1-20 items, independent outcomes, partial success, `blk_*` correlation |
| Batch Processing = On, Atomic Consistency = On | No | `POST /spaces/{spaceId}/models/batch` | 1-20 items, all-or-none commit, `cgs_*` ChangeSet |
| Batch Processing = Off | No | ordinary Record endpoint | One record per Tool call |

Batch Processing is a workflow/Tool design choice and defaults **On**. It is deliberately not exposed as an AI-controlled parameter. Atomic Consistency defaults **Off** because multiple items alone do not imply one indivisible business change.

## Provider-facing guidance is projected from the selected mode

The Agent receives only guidance that can affect the configured Tool:

- **Batch Processing Off** — no Bulk or Atomic guidance is added; the ordinary single-record Tool contract is used.
- **Bulk fixed** — only non-atomic semantics are described, including that partial success is possible, an all-or-none user request must not use this Tool, and after partial failure only failed items may be retried. Already-succeeded items must never be resent.
- **Atomic fixed** — only all-or-none semantics are described. Atomicity is limited to the items in the current Tool call and never spans Tool calls, operations, models, or Spaces.
- **Atomic controlled by `$fromAI(...)`** — both choices are necessarily described because the model must choose per call, but the explanation stays bounded to the decision rule and the two execution consequences.

Create contracts omit Update/Delete-only version and stable-ID guidance. Update/Delete contracts include it. This keeps provider-facing context proportional to the configured behavior rather than accumulating every available option.

CI generates the actual OpenAI-compatible function contracts and enforces hard `cl100k_base` reference-token budgets for the representative Bulk, fixed Atomic, and Agent-controlled Atomic mutation contracts. The budgets are guardrails against prompt growth, not a claim that every provider uses the same tokenizer.

## Let the model decide Atomic Consistency

The workflow owner may keep Atomic Consistency fixed, or use n8n's native **Let the model define this parameter** control (`$fromAI(...)`) on Atomic Consistency. When it is delegated to the model, the LifeSpace Agent Tool projects the generated `$fromAI` key into the provider-facing Tool schema as an optional boolean with default `false`.

The Tool contract tells the Agent:

- omit the argument or use `false` for normal non-atomic Bulk;
- use `true` only when the user requires every item in the current Tool call to commit or roll back together;
- item count alone is not a reason to choose Atomic;
- Atomic never spans Tool calls, operations, models, or Spaces;
- after a Bulk partial failure, retry only failed items and never resend succeeded items.

The adapter removes the control argument from semantic record data and selects `/models/bulk` or `/models/batch` for the current call.

The retired Agent `batchCreate` operation is not supported. New and saved workflows must use Create / Update / Delete plus the Options above.

Bulk and Atomic Batch intentionally cover only `create / update / delete`. LifeSpace Production does not expose a generic Execute Action Batch contract, so the n8n adapter does not emulate one with N Action calls.

For Bulk / Atomic Batch Update and Delete, the AI does not provide record versions. LifeSpace Core resolves omitted versions from the current set-wise snapshot and still enforces optimistic concurrency at commit time.

## Authority

Direct Agent Authority sends no Delegation selector.

When a Tool call uses represented User authority, the selected `dlg_*` is copied onto every operation in the Bulk/Batch body and the outer HTTP request carries no global `X-LifeSpace-Delegation-Id`. This matches the LifeSpace per-operation Batch/Bulk authority contract and keeps the mutation set explicit.

The current Agent Tool is deliberately model-scoped even though the Core Batch/Bulk contract can mix models. One AI Tool instance therefore exposes one Record Type and one operation, keeping the provider-facing contract narrow and reviewable. Cross-model orchestration remains an application/Agent composition concern rather than an unbounded Tool schema.
