# chaff

Schema-driven mock / fallback engine. Validate fixtures against any
[Standard Schema](https://standardschema.dev) validator (Zod, Valibot,
ArkType…) so your offline and test data can't drift from the real shape.
Optional MirageJS server for full network interception.

## Install

```bash
pnpm add chaff
# plus the validator of your choice, e.g. zod
# optional, for the in-browser mock server:
pnpm add miragejs
```

## Usage

```ts
import { parseMock, parseMockList } from 'chaff'
import { z } from 'zod'

const product = { schema: z.object({ id: z.number(), name: z.string() }) }

await parseMock(product, { id: 1, name: 'A' })          // → validated single item
await parseMockList(product, [{ id: 1, name: 'A' }])    // → T[] (single object or array)
```

- **`parseMock(resource, mock)`** / **`parseMockList(resource, mock)`** —
  validate `T | T[]` against `resource.schema` (async: Standard Schema's
  `validate` may return a Promise). `resource` only needs a minimal
  `{ schema }` (a `MockableResource`), so there's no dependency on the SDK.
- **`setupMirageMock({ baseUrl, seed })`** — spin up a MirageJS server backed
  by `seed` (a `{ [resourceName]: object[] }` map), serving `/:resource/search`,
  `/:resource/mutate` and `DELETE /:resource` in the lomkit REST shape (peer
  dependency `miragejs`, optional).

Standalone fixture validation for tests, or the offline fallback layer for
[`nexdk`](https://www.npmjs.com/package/nexdk).

## License

MIT © techmefr
