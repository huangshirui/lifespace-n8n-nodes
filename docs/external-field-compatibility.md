# External field compatibility

This package consumes the LifeSpace External Field contract defined by LifeSpace #376 and the provider-neutral Canonical collection field types in the LifeSpace Model Definition contract.

## Boundary

- n8n consumes the public stable LifeSpace Field `key` from Runtime Discovery.
- n8n does **not** consume or expose Provider `sourceFieldId`; Provider field identity reconciliation remains owned by LifeSpace Core and the Provider Adapter.
- Provider renames may change `title` / `description` while the public `key` remains stable; saved workflows continue to address the stable key.
- External schemas remain dynamic and Space-local. n8n never derives a second field identity or schema from Provider-native metadata.

## Collection types

### `enum_list`

Canonical value is a unique array of declared enum strings. Agent Tool mutation schemas expose it as an array whose items come from Discovery `values`. When an External Provider advertises canonical `contains`, the query operand is one declared enum string, not an array.

### `file_ref_list`

Canonical value is a references-only array of at most 100 entries:

```json
[
  {
    "name": "report.pdf",
    "url": "https://provider.example/report.pdf",
    "expiresAt": "2026-10-17T12:30:00Z"
  }
]
```

`expiresAt` is optional. n8n does not download, mirror, upload, refresh, or persist file bytes on behalf of LifeSpace. Provider-hosted file lifecycle remains Provider-owned. A Provider may expose this type read-only; read-only fields do not appear in Create/Update Resource Mapper inputs.

## Compatibility rule

LifeSpace is the source of truth for field type, writable/read-only state, query operators, stable key, and value constraints. This package projects those semantics into n8n UI and Agent Tool schemas and must not fork them.

### Upload capability

External `file_ref_list` remains read-only in ordinary Record mutation. When Runtime Discovery exposes `field.upload = { supported: true, maxBytes }`, the Workflow node may use the LifeSpace Upload Session. It never turns the field into a writable array and never contains Provider-specific Notion logic. The signed R2 URL is used without the LifeSpace Authorization header. Native `file` / `file_list` fields carry stable `fil_*` references; binary upload is a separate operation that returns the reference for later Record mutation.
