# Contributing

## Setup

```bash
npm install
npm test
```

`npm test` compiles TypeScript and runs the Node test runner.

## Pull requests

- Keep the public API literal (`generateApiDocs`, `apiDocs`, `serveApiDocs`).
- Do not add install-time scripts (`preinstall` / `postinstall`).
- Pin production dependencies to exact versions.

## Release

1. Bump `version` in `package.json`.
2. Push a git tag `vX.Y.Z`.
3. GitHub Actions publishes to npm with `--provenance`.
