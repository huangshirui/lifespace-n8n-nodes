# LifeSpace Trigger Eventing Compatibility

The LifeSpace Trigger consumes the platform-owned Integration/Eventing contract rather than defining its own event semantics.

## Record-event output

The Trigger exposes ordinary record events to n8n workflows:

- `record.created`
- `record.updated`
- `record.deleted`

It verifies the endpoint HMAC signature first, then applies the configured Space, Record Type, and Event Type filters.

## Aggregated transport envelopes

LifeSpace may aggregate record-event delivery for explicit grouped mutations without changing the underlying Domain Event semantics:

- non-atomic Runtime Bulk: `bulk.completed`
- atomic Runtime Batch / ChangeSet: `change_set.committed`

These are transport envelopes, not additional Record Event filters in the n8n UI. The Trigger automatically unwraps `events[]`, filters each contained record event using the same configured Space / Record Type / Event Type rules, and emits one n8n item per matching record event.

For correlation, emitted items also contain:

- `bulkId` when received through `bulk.completed`;
- `changeSetId` when received through `change_set.committed`.

This keeps batch transport optimization transparent to downstream n8n workflows while preserving the LifeSpace correlation identifier.

## Endpoint test

A correctly signed `endpoint.test` payload bypasses Record Type and Event Type filtering so it can be used to verify endpoint transport and signing end to end.
