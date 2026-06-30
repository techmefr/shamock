# chaff

Schema-driven mock / fallback engine. Validate fixtures against a Zod schema so
your offline and test data can't drift from the real shape. Optional MirageJS
server for full network interception.

## Install

```bash
pnpm add chaff zod
# optional, for the in-browser mock server:
pnpm add miragejs
```

## Usage

```ts
import { parseMock, parseMockList } from 'chaff'
import { z } from 'zod'

const product = { schema: z.object({ id: z.number(), name: z.string() }) }

parseMock(product, { id: 1, name: 'A' })          // → validated single item
parseMockList(product, [{ id: 1, name: 'A' }])    // → T[] (single object or array)
```

- **`parseMock(resource, mock)`** / **`parseMockList(resource, mock)`** —
  validate `T | T[]` against `resource.schema`. `resource` only needs a minimal
  `{ schema }` (a `MockableResource`), so there's no dependency on the SDK.
- **`setupMirageMock(config)`** — spin up a MirageJS server from resource seeds
  (peer dependency `miragejs`, optional).

Standalone fixture validation for tests, or the offline fallback layer for
[`nexdk`](https://www.npmjs.com/package/nexdk).

## License

MIT © techmefr
