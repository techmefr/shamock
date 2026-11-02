---
title: Mock API
description: Answer fetch calls from seed data with createMock and installMock.
---

shamock intercepts the real `fetch` call and answers with the JSON you provide instead of reaching the backend. A small engine (search, mutate, delete) serves your seed data, in process. No server, no dependency.

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
| `resources[name].links` | `{ [relation]: { type: 'belongsTo' \| 'hasMany', resource, foreignKey } }`, read by `includes`. |
| `profile` | `'lomkit'` opts in to the strict compatibility profile, see [Compatibility profile](#compatibility-profile). Omitted: the mock follows the JSON you give it. |
| `limits` | Accepted `limit` values, a non-empty list of positive integers. Any positive `limit` by default, `[10, 25, 50]` with `profile: 'lomkit'`. |
| `likeEscape` | `true`: a backslash escapes `%`, `_` and itself. `false` reads it literally. Default `true`, `false` with `profile: 'lomkit'`. |
| `maxNestingDepth` | Group levels allowed in `filters`, from `1` to `10`. Default `10`, `1` with `profile: 'lomkit'`. |
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

The `search` wrapper is optional: a flat body works too. The response is a Laravel-style paginator: `data` and, at the root, `current_page`, `last_page`, `per_page`, `total`, `from` and `to` (`null` on an empty page), with `meta: []`. Without `limit`, a page holds 50 rows.

- Supported keys: `filters`, `sorts`, `selects`, `includes`, `text`, `limit`, `page`. Other keys are ignored (the lomkit profile answers `422`).
- Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `not like`, `in`, `not in`. Any other operator returns `422` `Invalid search`. An empty `in` list matches no row.
- `like` is case-insensitive. `%` matches any run, `_` one character. A backslash escapes `%`, `_` and the backslash itself, so `Jo\_el` matches the literal `Jo_el`. With `likeEscape: false` the backslash is literal.
- `text: { value }` (next to `filters`, inside or outside `search`) keeps the records where a string field contains the value, case-insensitively. The fields are the string fields of the record, or `resources[name].searchable`. Numbers, arrays and nested values are not searched, an empty text is ignored.
- Filters combine with SQL precedence: `and` binds tighter than `or`, so `a and b or c and d` is `(a and b) or (c and d)`. `or` goes in `type: 'or'`. A filter can hold `nested` filters, which count as one condition. Groups can nest up to `maxNestingDepth` levels (default 10).
- Filters on `id` compare as text, so `1` and `'1'` match.
- Dates are kept as given and compared as values (the lomkit profile normalizes them).
- Sorting puts null and missing values last in both directions.
- Any positive `limit` is accepted. When `limits` is set, `limit` must be one of them, otherwise `422` with `errors: { "search.limit": [...] }`. Without `limit`, a page holds 50 rows.
- `selects: [{ field }]` keeps only those fields.
- `includes: [{ relation, filters, sorts, selects, limit, includes }]` embeds a relation declared in `resources[name].links`: `belongsTo` becomes an object or `null`, `hasMany` an array, with `limit` applied per parent. The `limit` of an include must be one of the `limits` of the related resource. An undeclared relation is ignored, so data embedded in your JSON stays as is (the lomkit profile answers `422`).

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

The response is `{ "created": [ids], "updated": [ids] }`, the ids of the records written, in request order. Read the records back with `search`. Only `create` and `update` exist: any other `operation` returns `422`. A flat record without `operation` is an update when it has an `id`, otherwise a create.

An `update` of an unknown id returns `404` `{ "message": "Not found", "errors": {} }`.

When `resources[name]` exists, each created record and each updated record (after the merge) is validated with its schema. A failure returns `422` with `message` `The given data was invalid.` and `errors` keyed by field name, nested paths joined with dots, a root issue under `record`. Every invalid record is reported. The stored record is the one you sent, not the schema output.

Fields listed in `resources[name].unique` must stay unique: a duplicate, in the store or inside the request, returns `422` with `The <field> has already been taken.` keyed by the field. A null value is never a duplicate, and an update only checks the fields it sends.

Without a schema, nothing is validated.

All mutations of one request apply or none do. If one fails, the store is left unchanged. Writes are applied one request at a time.

### Delete

```ts
await fetch('https://api.example.com/products', {
  method: 'DELETE',
  body: JSON.stringify({ resources: [1, 2] }),
})
```

Accepts `{ resources: [id, ...] }` or `{ id }`. The response is `{ "success": true }`. An unknown id is ignored, so a delete can be repeated. Deletion is atomic like mutate.

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
| `422` | Invalid JSON, invalid payload, unsupported operation, unknown search operator, limit outside `limits`, schema or unique validation failure, duplicate or invalid id. The lomkit profile adds unsupported or unknown search keys, an unknown relation, an empty `in`, and delete of an unknown id or without ids. |

## Limits

| What | Max |
|---|---|
| Request body | 1 MB (bytes) |
| Mutations or ids per request | 1000 |
| Filters per search | 100 |
| `like` pattern | 256 characters |
| Values per array | 1000 |
| Rows per resource | 10 000 |
| Filter nesting | 10 (`maxNestingDepth`, default 10, 1 with the lomkit profile) |

## Compatibility profile

`profile: 'lomkit'` is an optional convenience for code that talks to `lomkit/laravel-rest-api`. It is opt-in and minimal. Without it the mock follows the JSON you give it.

| Topic | Default | `profile: 'lomkit'` |
|---|---|---|
| `limit` | any positive integer | one of `[10, 25, 50]`, else `422` (option `limits`) |
| Mutation error keys | field name | `mutate.<index>.attributes.<field>` |
| Delete of an unknown id or without ids | success | `422` (`resources.<index>`, `resources`), nothing deleted |
| `in []` | no row | `422` |
| `in` and `not in` with null | plain comparison | a null value never matches, a list holding `null` matches nothing in `not in` |
| Dates | kept as given | stored and compared as `Y-m-d H:i:s` in UTC |
| Null sorting | last in both directions | first ascending, last descending |
| `like` case folding | Unicode lowercase | ASCII letters only |
| Backslash in `like` | escape (`likeEscape: true`) | literal (`likeEscape: false`) |
| Group in a group | up to 10 levels (option `maxNestingDepth`) | `422` (1 level) |
| Unknown search or filter keys, `aggregates`, `scopes`, `instructions`, `gates` | ignored | `422` (empty arrays accepted) |
| `includes` of an undeclared relation | ignored | `422` |
| `like` filter with `text` | allowed | `422` |
| `text` | plain substring | `%value%` pattern, `%` and `_` are wildcards |

`limits`, `maxNestingDepth`, `likeEscape`, `unique`, `searchable` and `failures` work with or without the profile, and an explicit option wins over the profile.

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
