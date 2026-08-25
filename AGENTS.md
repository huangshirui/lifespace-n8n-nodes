# LifeSpace n8n Nodes Agent Instructions

This repository contains the official n8n community-node adapter for LifeSpace.

## Source of truth

- LifeSpace platform contracts, domain models, authentication semantics, event schemas and discovery metadata are owned by `huangshirui/LifeSpace`.
- This repository must not redefine or fork LifeSpace domain contracts.
- Before implementing behavior that depends on LifeSpace semantics, read the relevant LifeSpace `AGENTS.md`, architecture/authentication docs, OpenAPI contract, event contract or discovery contract.

## Architecture boundary

- Keep this package a thin n8n-specific adapter.
- LifeSpace must never depend on n8n or on this repository.
- Prefer contract/discovery-driven operations over handwritten copies of model schemas.
- Keep workflow orchestration, retries between unrelated systems and business-specific branching in n8n workflows, not in the node package.
- Shared reusable LifeSpace client code may later move to an official SDK; do not prematurely create a second business-logic layer here.

## Authentication

- For owner-controlled n8n, prefer LifeSpace opaque Service API Tokens (`lsp_pat_*`) sent as `Authorization: Bearer ...` to Core.
- OAuth `client_credentials` may be added when required by third-party or policy-controlled integrations.
- Never commit credentials, tokens, workflow exports containing secrets, user data or production identifiers.

## n8n compatibility

- Follow the current official n8n community-node and verification guidelines.
- Use the official `@n8n/node-cli` / `n8n-node` toolchain.
- The npm package name is `n8n-nodes-lifespace`.
- Keep the package focused on the single LifeSpace service; a LifeSpace Trigger may live in the same package.
- Publishing must use GitHub Actions with npm provenance as required by current n8n verification rules.

## Change workflow

For behavior changes:

1. identify the upstream LifeSpace contract/revision being consumed;
2. implement only the n8n adapter behavior;
3. add or update tests/fixtures without real secrets or personal data;
4. run build and lint;
5. document compatibility and any pinned LifeSpace contract assumptions;
6. record important architecture decisions in the ALOHA & HomeMew engineering log when applicable.
