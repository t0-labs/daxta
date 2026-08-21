# @t0.labs/daxta

DAxTA — NestJS integration-test traffic → API docs, DTO required/optional, terminal Try-it, and app `/docs`.

## Install (one command)

```bash
pnpm dlx @t0.labs/daxta install
# or
npx @t0.labs/daxta install
```

Install attaches DAxTA as a **Jest plugin** (setup + reporter) on your existing jest config.  
Your `test:integration` (or whatever you pick) stays the entrypoint — DAxTA does **not** wrap the process.

```ts
import { apiDocs } from '@t0.labs/daxta';
apiDocs(app); // needs DAXTA_DOCS
```

## Required env

```bash
DAXTA_DOCS=true    # enable /docs on the app port
DAXTA_DOCS=false   # disable (must be set)
```

## Usage

```bash
pnpm run test:integration    # your script — Docs ready prints when Jest finishes
daxta migrate                # force upgrade after package bump
daxta serve                  # standalone viewer (optional)
```

## API

```ts
import { apiDocs, apiDocsHandler, serveApiDocs } from '@t0.labs/daxta';

apiDocs(app);
app.use(apiDocsHandler());
serveApiDocs({ port: 5199 });
```
