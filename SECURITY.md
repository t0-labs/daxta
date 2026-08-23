# Security Policy

## Supported versions

Security fixes are applied to the latest published `@t0.labs/daxta` release.

## Reporting a vulnerability

Do not open a public issue for security reports.

Open a private GitHub security advisory on [t0-labs/daxta](https://github.com/t0-labs/daxta/security/advisories/new).

Please include:

- affected package version
- a minimal reproduction
- impact (what an attacker could do)

We will acknowledge the report and follow up with a fix or a reasoned decline.

## Publishing

Releases published from GitHub Actions include [npm provenance](https://docs.npmjs.com/generating-provenance-statements) (SLSA attestations). Verify a release with:

```bash
npm view @t0.labs/daxta dist.attestations
```
