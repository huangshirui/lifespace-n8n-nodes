# n8n-nodes-lifespace

Official n8n community nodes for integrating workflows and AI agents with LifeSpace.

## Status

Initial scaffold. The package currently provides:

- a LifeSpace API credential for opaque `lsp_pat_*` Service API Tokens;
- a thin LifeSpace node with a generic Core API request operation;
- the official `n8n-node` development toolchain;
- CI for lint and build validation.

Domain-specific resources, actions, triggers and AI-tool surfaces will be added only against stable upstream LifeSpace contracts/discovery metadata.

## Architecture boundary

LifeSpace is the source of truth for identity, authorization, domain models, contracts and events. This repository is an n8n-specific adapter and must not become a second copy of LifeSpace business contracts.

LifeSpace does not depend on n8n. n8n is one optional orchestration and integration runtime that consumes LifeSpace APIs and events.

## Development

Requirements:

- Node.js 22.22.0 or newer;
- npm;
- a local n8n instance for interactive node testing.

Install and validate:

```bash
npm install
npm run lint
npm run build
```

Run the node in a local n8n development instance:

```bash
npm run dev
```

## Credentials

For owner-controlled n8n instances, use a LifeSpace Service API Token (`lsp_pat_*`). The node sends it to LifeSpace Core as a Bearer token.

Do not store real tokens in source code, workflow examples or repository files.

## Planned surfaces

- LifeSpace resource/action node backed by stable LifeSpace contracts and discovery metadata;
- LifeSpace Trigger backed by the platform event/subscription contract;
- n8n AI Tool support for approved LifeSpace actions;
- OAuth `client_credentials` support where required;
- npm publishing with GitHub Actions provenance.

## License

MIT
