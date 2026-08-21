# DAxTA

**Document API × Test API** — NestJS integration tests already hit your real endpoints. DAxTA records that traffic and turns it into living OpenAPI docs on your app port (`/docs`), with DTO required/optional fields and a Try-it workbench.

Swagger asks you to decorate controllers. DAxTA learns from what your tests actually call.

DAxTA docs — recorded request, response, Try-it

## What you get


| After tests                           | On the app                                               |
| ------------------------------------- | -------------------------------------------------------- |
| OpenAPI + HTML from real hits         | `/docs` on the same port as Nest                         |
| Success / validation / auth scenarios | Send + Copy cURL from recorded calls                     |
| DTO field map (required vs optional)  | `DAXTA_DOCS=true|false` gate (like Swagger’s prod check) |


Jest finishes — Docs ready on /docs

## How it works

```text
  your Jest suite
       │  supertest / superagent hits
       ▼
  DAxTA records hits to disk
       │  (no OpenAPI rebuild mid-run)
       ▼
  onRunComplete → one full build
       │
       ▼
  Docs ready → http://localhost:3000/docs
```

1. **Install** attaches DAxTA as a Jest plugin (`setupFilesAfterEnv` + reporter). Your existing `test:integration` stays the entrypoint — DAxTA does not wrap the process.
2. **During the run** only traffic is recorded (disk flush). OpenAPI/HTML is built once when Jest finishes.
3. `apiDocs(app)` in `main.ts` serves the generated viewer when `DAXTA_DOCS=true`.



## Install

```bash
pnpm dlx @t0.labs/daxta install
# or
npx @t0.labs/daxta install
```

Wires `apiDocs(app)` into your Nest entry and hooks Jest. Then:

```ts
import { apiDocs } from '@t0.labs/daxta';

apiDocs(app); // requires DAXTA_DOCS in the environment
```

```bash
pnpm run test:integration          # Docs ready when Jest finishes
DAXTA_DOCS=true pnpm start:dev     # open /docs on the app port
```



## Docs UI

Recorded scenarios (success, validation, missing auth) stay tied to the request that produced them — headers included. Empty auth on a 401 scenario stays empty; env tokens only override keys that were actually recorded.

Scenario picker — success, validation, auth

Field metadata comes from class-validator / class-transformer DTOs plus observed traffic:

Required vs optional DTO fields

## `DAXTA_DOCS` (required)

Same idea as Nest Swagger’s “don’t call `setup` in prod”:

```bash
DAXTA_DOCS=true    # mount /docs
DAXTA_DOCS=false   # no-op (must still be set)
# unset / empty → throws — make the choice explicit
```

`false` does not remove `@t0.labs/daxta` from the Node image; it only skips mounting `/docs`.

## Commands

```bash
daxta install     # one-shot setup (+ sidebar layout prompts)
daxta migrate     # after a package bump (+ same sidebar prompts)
daxta build       # rebuild OpenAPI/HTML from recorded hits
daxta serve       # optional standalone viewer (prefer apiDocs on the app)
daxta tree        # re-run sidebar folder prompts anytime
daxta fields …    # export field map for an operation
daxta call …      # CLI Try-it
```

### Sidebar order (`daxta tree`)

Pick a path and how it should nest under `/docs`:

```text
/v1/admin/baskets
  1) URL order        v1 › admin › baskets
  2) Resource-first   v1 › baskets › admin
  3) Custom           …
```

Saves `treeLayout` / `treePathOverrides` in `daxta.config.ts`. Then `daxta build`.



## API

```ts
import { apiDocs, apiDocsHandler, serveApiDocs } from '@t0.labs/daxta';

apiDocs(app);                 // preferred — same origin as the API
app.use(apiDocsHandler());    // Express-style mount
serveApiDocs({ port: 5199 }); // standalone (CLI / rare)
```

