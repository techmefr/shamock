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
| `resources` | Optional `{ [resource]: options }`. A name missing from `seed` throws. |
| `resources[name].schema` | Standard Schema. Seeds are validated and replaced by the parsed output, and every record written by `mutate` is validated too. |
| `resources[name].unique` | Field names that must stay unique. |
| `resources[name].limits` | Accepted `limit` values for this resource. |
| `resources[name].searchable` | Fields read by `text` search. All string fields by default. |
| `resources[name].relations` | `{ [relation]: { type: 'belongsTo' \| 'hasMany', resource, foreignKey } }`, read by `includes`. |
| `limits` | Accepted `limit` values, a non-empty list of positive integers. Default `[10, 25, 50]`. |
| `likeEscape` | `false` reads a backslash in `like` and `text` literally, as SQLite and Lomkit do. Default `true`: a backslash escapes `%`, `_` and itself. |
| `maxNestingDepth` | Group levels allowed in `filters`, from `1` to `10`. Default `1`: a group cannot hold a group, like lomkit. |
| `failures` | Fault injection rules, see [Failure injection](#failure-injection). |
| `timing` | Delay in ms, from `0` to `60000`. Default `300`: pass `0` in tests. Out of range throws `RangeError`. |

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

- Supported keys: `filters`, `sorts`, `selects`, `includes`, `text`, `limit`, `page`. Refused with `422`: `aggregates`, `scopes`, `instructions` and `gates` (an empty array is accepted), any unknown search key, any unknown filter key.
- Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `not like`, `in`, `not in`. Any other operator returns `422` `Invalid search`. An empty `in` list returns `422`.
- `in` and `not in` never match a null value. `not in` a list holding `null` matches nothing.
- `like` folds ASCII letters only: `a` matches `A`, `é` does not match `É`. `%` matches any run, `_` one character. A backslash escapes `%`, `_` and the backslash itself, so `Jo\_el` matches the literal `Jo_el`. With `likeEscape: false` the backslash is literal, as in SQLite and Lomkit.
- `text: { value }` (next to `filters`, inside or outside `search`) keeps the records where a string field matches `%value%`, ASCII case-insensitively. The fields are the string fields of the record, or `resources[name].searchable`. Numbers, arrays and nested values are not searched, an empty text is ignored. A `like` filter combined with `text` returns `422`.
- Filters combine with SQL precedence: `and` binds tighter than `or`, so `a and b or c and d` is `(a and b) or (c and d)`. `or` goes in `type: 'or'`. A filter can hold `nested` filters, which count as one condition. A group nested in a group returns `422` unless `maxNestingDepth` is raised.
- Filters on `id` compare as text, so `1` and `'1'` match.
- Dates are stored and compared as `Y-m-d H:i:s` in UTC. `Date` objects and ISO strings (`2024-03-01T10:00:00Z`, `2024-03-01 10:00:00.000Z`) are converted when they enter the store, in seeds and in `mutate`, and in filter values. A date-only value such as `2024-03-01` is compared as text.
- Sorting puts null and missing values first ascending and last descending, like SQLite.
- `limit` must be one of `limits` (default `[10, 25, 50]`), otherwise `422` with `errors: { "search.limit": [...] }`. Without `limit`, a page holds 50 rows.
- `selects: [{ field }]` keeps only those fields.
- `includes: [{ relation, filters, sorts, selects, limit, includes }]` embeds a relation declared in `resources[name].relations`: `belongsTo` becomes an object or `null`, `hasMany` an array, with `limit` applied per parent. The `limit` of an include must be one of the `limits` of the related resource. An undeclared relation returns `422`.

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

When `resources[name]` exists, each created record and each updated record (after the merge) is validated with its schema. A failure returns `422` with `message` `The given data was invalid.` and `errors` keyed like Laravel: `mutate.<index>.attributes.<field>`, nested paths joined with dots, a root issue under `mutate.<index>.attributes`, the index being the position in the `mutate` array. Every invalid record is reported. The stored record is the one you sent, not the schema output.

Fields listed in `resources[name].unique` must stay unique: a duplicate, in the store or inside the request, returns `422` with `The <field> has already been taken.` on `mutate.<index>.attributes.<field>`. A null value is never a duplicate, and an update only checks the fields it sends.

Without a schema, nothing is validated.

All mutations of one request apply or none do. If one fails, the store is left unchanged. Writes are applied one request at a time.

### Delete

```ts
await fetch('https://api.example.com/products', {
  method: 'DELETE',
  body: JSON.stringify({ resources: [1, 2] }),
})
```

Accepts `{ resources: [id, ...] }` or `{ id }`. The response is `{ "success": true }`. An empty or missing list returns `422` (`errors.resources`), and so does any unknown id (`errors["resources.<index>"]`), in which case nothing is deleted. Deletion is atomic like mutate.

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
| `422` | Invalid JSON, invalid payload, unsupported operation, unsupported or unknown search key, unknown search operator, unknown relation, limit outside `limits`, schema or unique validation failure, duplicate or invalid id, delete of an unknown id or without ids. |

## Limits

| What | Max |
|---|---|
| Request body | 1 MB (bytes) |
| Mutations or ids per request | 1000 |
| Filters per search | 100 |
| `like` pattern | 256 characters |
| Values per array | 1000 |
| Rows per resource | 10 000 |
| Filter nesting | 10 (`maxNestingDepth`, default 1: a group cannot hold a group) |

## Failure injection

`failures` is a list of rules. A rule matches a method and a path (relative to `baseUrl`, such as `/users/search`), skips `after` matching calls, then fires `times` times, or on every call when `times` is omitted. The first rule that fires answers.

| Field | Notes |
|---|---|
| `method` | HTTP method, any when omitted. |
| `path` | Starts with `/`, any when omitted. |
| `after` | Matching calls to let through first. Default `0`. |
| `times` | Matching calls to fail. Default: all of them. |
| `status` | Integer from `400` to `599`. Answers `{ "message": "Injected failure", "errors": {} }`. |
| `network` | `true` rejects with a `TypeError`, like a failed `fetch`. Exclusive with `status`. |
| `delay` | Latency in ms, from `0` to `60000`, added before the answer. Alone, it only slows the call. |

A rule needs `status`, `network` or `delay`. An invalid rule throws from `createMock`.

```ts
const mock = await createMock({
  baseUrl: 'https://api.example.com',
  timing: 0,
  seed,
  failures: [
    { method: 'POST', path: '/users/mutate', status: 503, times: 2 },
    { path: '/users/search', network: true, after: 1, times: 1 },
    { delay: 200 },
  ],
})
```

## Timing and abort

Each request waits `timing` ms before it is served. Passing a `signal` to `fetch` aborts the wait and rejects with the signal's reason. Aborted writes are not applied.

## Scope

- Requests outside `baseUrl` (another origin or path) go to the previous `fetch`.
- XHR is not intercepted, only `fetch`.
- Several installs can be active at once and be restored in any order.
