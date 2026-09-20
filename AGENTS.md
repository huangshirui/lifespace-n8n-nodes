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

## Release workflow

Release ordering is a mandatory invariant. This repository has repeatedly failed publishes because a release tag was pushed before the package version metadata was bumped.

For every npm release:

1. update `package.json` and `package-lock.json` to the target version first; prefer `npm version <version> --no-git-tag-version` so both files move together;
2. verify these three values are identical before opening/merging the release change:
   - `package.json.version`
   - top-level `package-lock.json.version`
   - `package-lock.json.packages[""].version`;
3. merge the version bump to `main` and wait for the `main` CI run to pass;
4. only after that, create/push the matching release tag on the exact verified `main` commit;
5. the release tag and package version must be identical (for example, tag `0.1.19` requires package version `0.1.19`).

Never create or move a release tag as a substitute for the version bump. Re-running a failed Publish workflow cannot fix a tag whose commit still contains an older package version; fix and merge the package metadata first, then recreate/move the tag.

Before assisting with any publish/release request, re-read the current `main` package version and the target tag state instead of assuming the next version.

