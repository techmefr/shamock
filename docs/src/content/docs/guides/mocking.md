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

- `fetch` serves requests under `baseUrl` and forwards the rest to `globalThis.fetch`.
- `handle` takes a `Request` and always answers as the mock (`404` outside `baseUrl`).

## Configuration

| Field | Notes |
|---|---|
| `baseUrl` | Absolute URL. Routes live under its path. |
| `seed` | `{ [resource]: object[] }`. Each key becomes a resource. |
| `resources` | Optional `{ [resource]: { schema } }`. Seeds are validated and replaced by the parsed output. A name missing from `seed` throws. |
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

The `search` wrapper is optional: a flat body works too. The response is `{ data }`, plus `meta` (`current_page`, `last_page`, `per_page`, `total`) when `limit` is set.

- Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `not like`, `in`, `not in`. `like` is case-insensitive, `%` matches any run, `_` one character.
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

The response is `{ data }` with the written records. Only `create` and `update` exist: any other `operation` returns `422`. A flat record without `operation` is an update when it has an `id`, otherwise a create.

All mutations of one request apply or none do. If one fails, the store is left unchanged.

### Delete

```ts
await fetch('https://api.example.com/products', {
  method: 'DELETE',
  body: JSON.stringify({ resources: [1, 2] }),
})
```

Accepts `{ resources: [id, ...] }` or `{ id }`. The response is `{ "success": true }`. Unknown ids are ignored. Deletion is atomic like mutate.

## Ids

- A record keeps the type of the `id` you gave it, number or string.
- A record without `id` gets the next free integer as a string.
- A duplicate id returns `422`.
- Keys and filters on `id` are compared as text.

## Errors

Errors are `{ "message": "...", "errors": {} }`.

| Status | Cause |
|---|---|
| `404` | Unknown resource, route or method, or a URL outside `baseUrl` on `handle`. |
| `413` | Body larger than 1 MB, counted in bytes. |
| `422` | Invalid JSON, invalid payload, unsupported operation, duplicate or invalid id, limit exceeded. |

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

Each request waits `timing` ms before it is served. Passing a `signal` to `fetch` aborts the wait and rejects with the signal's reason. Aborted writes are not applied.

## Scope

- Requests outside `baseUrl` (another origin or path) go to the previous `fetch`.
- XHR is not intercepted, only `fetch`.
- Several installs can be active at once and be restored in any order.
