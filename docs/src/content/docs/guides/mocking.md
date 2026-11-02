---
title: Mock API
description: Answer fetch calls from seed data with createMock and installMock.
---

shamock serves a small REST API from seed data, in process. No server, no dependency.

## Install the mock

```ts
import { installMock } from 'shamock'
import { z } from 'zod'

const product = { schema: z.object({ id: z.number(), name: z.string() }) }

const mock = await installMock({
  baseUrl: 'https://api.example.com',
  seed: { products: [{ id: 1, name: 'A' }] },
  resources: { products: product },
  timing: 0,
})

const response = await fetch('https://api.example.com/products/search', {
  method: 'POST',
  body: '{}',
})
const { data } = await response.json()

mock.restore()
```

`installMock` replaces `globalThis.fetch` and returns the mock with a `restore()` method.

## Without touching the global

`createMock` returns `{ handle, fetch, install }` and changes nothing until you call `install()`.

```ts
import { createMock } from 'shamock'

const mock = await createMock({
  baseUrl: 'https://api.example.com',
  seed: { products: [{ id: 1, name: 'A' }] },
  timing: 0,
})

const response = await mock.fetch('https://api.example.com/products/search', {
  method: 'POST',
  body: '{}',
})
const direct = await mock.handle(new Request('https://api.example.com/products/search', { method: 'POST' }))
```

- `fetch` serves requests under `baseUrl` and forwards the rest to the `fetch` that existed when `createMock` was called. Assigning `mock.fetch` to `globalThis.fetch` is therefore safe.
- `handle` takes a `Request` and always answers as the mock (`404` outside `baseUrl`).

## Configuration

| Field | Notes |
|---|---|
| `baseUrl` | Absolute URL. Routes live under its path. |
| `seed` | `{ [resource]: object[] }`. Each key becomes a resource. |
| `resources` | Optional `{ [resource]: { schema } }`. Seeds are validated and replaced by the parsed output, and every record written by `mutate` is validated too. A name missing from `seed` throws. |
| `timing` | Delay in ms, from `0` to `60000`. Default `300`. Out of range throws `RangeError`. |

Invalid seed data throws `MockValidationError` from `createMock`.

## Routes

| Route | Purpose |
|---|---|
| `POST /<resource>/search` | Filter, sort and paginate. |
| `POST /<resource>/mutate` | Create or update records. |
| `DELETE /<resource>` | Delete records. |

An unknown resource, route or method returns `404`.

### Search

```ts
await fetch('https://api.example.com/products/search', {
  method: 'POST',
  body: JSON.stringify({
    search: {
      filters: [{ field: 'name', operator: 'like', value: 'A%' }],
      sorts: [{ field: 'name', direction: 'desc' }],
      limit: 10,
      page: 1,
    },
  }),
})
```

The `search` wrapper is optional: a flat body works too. The response is the Laravel paginator shape of lomkit: `data` and, at the root, `current_page`, `last_page`, `per_page`, `total`, `from` and `to` (`null` on an empty page), with `meta: []`. Without `limit`, a page holds 50 rows, like lomkit.

- Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `not like`, `in`, `not in`. Any other operator returns `422` `Invalid search`.
- `like` is case-insensitive, `%` matches any run, `_` one character. A backslash escapes `%`, `_` and ``, so `Jo_el` matches the literal `Jo_el`.
- `text: { value }` (next to `filters`, inside or outside `search`) keeps the records where at least one top-level string value contains the text, case-insensitively. Numbers, arrays and nested values are not searched, an empty text is ignored, and it combines with `filters` using `and`.
- Filters combine from left to right with `and`, or `or` through `type: 'or'`. A filter can hold `nested` filters.
- Filters on `id` compare as text, so `1` and `'1'` match.

### Mutate

```ts
await fetch('https://api.example.com/products/mutate', {
  method: 'POST',
  body: JSON.stringify({
    mutate: [
      { operation: 'create', attributes: { name: 'B' } },
      { operation: 'update', key: 1, attributes: { name: 'A2' } },
    ],
  }),
})
```

The response is `{ "created": [ids], "updated": [ids] }`, like lomkit: the ids of the records written, in request order. Read the records back with `search`. Only `create` and `update` exist: any other `operation` returns `422`. A flat record without `operation` is an update when it has an `id`, otherwise a create.

An `update` of an unknown id returns `404` `{ "message": "Not found", "errors": {} }`.

When `resources[name]` exists, each created record and each updated record (after the merge) is validated with its schema. A failure returns `422` with `message` `The given data was invalid.` and `errors` as `{ field: [messages] }`, nested paths joined with dots and a root issue under `record`. Only the first invalid record is reported. The stored record is the one you sent, not the schema output.

All mutations of one request apply or none do. If one fails, the store is left unchanged. Writes are applied one request at a time.

### Delete

```ts
await fetch('https://api.example.com/products', {
  method: 'DELETE',
  body: JSON.stringify({ resources: [1, 2] }),
})
```

Accepts `{ resources: [id, ...] }` or `{ id }`. The response is `{ "success": true }`. Deleting an unknown id is a success (idempotent), unlike updating one. Deletion is atomic like mutate.

## Ids

- A record keeps the type of the `id` you gave it, number or string.
- A record without `id` gets the next free integer: a number when the seed of the resource is not empty and all its ids are numbers, otherwise a string.
- A duplicate id returns `422`.
- Keys and filters on `id` are compared as text.

## Errors

Errors are `{ "message": "...", "errors": {} }`.

| Status | Cause |
|---|---|
| `404` | Unknown resource, route or method, a URL outside `baseUrl` on `handle`, or an update of an unknown id. |
| `413` | Body larger than 1 MB, counted in bytes. |
| `422` | Invalid JSON, invalid payload, unsupported operation, unknown search operator, schema validation failure, duplicate or invalid id, limit exceeded. |

## Limits

| What | Max |
|---|---|
| Request body | 1 MB (bytes) |
| Mutations or ids per request | 1000 |
| Filters per search | 100 |
| `like` pattern | 256 characters |
| Values per array | 1000 |
| Rows per resource | 10 000 |
| Filter nesting | 10 |

## Timing and abort

Injecting a failure: `mock.fetch` is a plain function, so wrap it to answer a 5xx or to fail like the network. There is no failure option in the config.

```ts
const mock = await createMock({ baseUrl: 'https://api.example.com', timing: 0, seed })
const flaky: typeof fetch = (input, init) => {
  if (shouldFail()) return Promise.resolve(new Response('{}', { status: 503 }))
  return mock.fetch(input, init)
}
```

Throw (or return a rejected promise) in the wrapper for a network failure. Pass the wrapper to the client, for example the `fetch` option of a nexdk driver.

Each request waits `timing` ms before it is served. Passing a `signal` to `fetch` aborts the wait and rejects with the signal's reason. Aborted writes are not applied.

## Scope

- Requests outside `baseUrl` (another origin or path) go to the previous `fetch`.
- XHR is not intercepted, only `fetch`.
- Several installs can be active at once and be restored in any order.
