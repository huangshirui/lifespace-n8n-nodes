# Development dependency security baseline

Baseline date: 2026-09-09.

This repository publishes an n8n community-node package with no runtime `dependencies`. `n8n-workflow` is a host-provided peer dependency. The packages audited here are therefore development/release tooling and their transitive graph, not libraries bundled into the published LifeSpace node runtime.

## Reviewed changes

- Removed unused `release-it`; releases use the official `n8n-node release` workflow.
- Upgraded the official stable `@n8n/node-cli` from `0.44.5` to `0.46.4`.
- Upgraded Prettier within its current major from `3.8.3` to `3.9.6`.
- Kept ESLint `9.39.4` and TypeScript `5.9.3`; unrelated major-version upgrades are not required to resolve the reviewed high-severity findings.
- Development, CI and release builds use Node.js `24.20.0` LTS because the current stable n8n development toolchain includes `isolated-vm@7`, which declares Node.js `>=24`. The published package runtime compatibility remains `>=22.22.0` because these development dependencies are not shipped with the package.

## Audit result

Before this baseline, `npm audit` reported 17 findings: 8 moderate and 9 high.

After the reviewed changes, `npm audit` reports 10 moderate findings and zero high or critical findings. The remaining findings are transitive through the official `@n8n/node-cli` / n8n development stack (`@langchain/*`, `@n8n/ai-*`, `@n8n/backend-*`, `qs`, `stream-json`, and `uuid`). npm currently proposes downgrading `@n8n/node-cli` to `0.20.0` as the aggregate fix path; that would be a destructive toolchain regression and is not accepted.

These residual moderate findings are accepted as upstream development-tooling risk for this baseline because:

- they are not runtime dependencies of the published `n8n-nodes-lifespace` package;
- no high or critical finding remains after moving to the latest stable compatible n8n CLI;
- lint, all repository tests, and build pass on the pinned development/release environment;
- no runtime dependency or adapter workaround is introduced merely to suppress audit output.

Re-run this review when `@n8n/node-cli` publishes a newer stable release that removes the remaining transitive findings, or sooner if a high/critical advisory affects the development/release path.
