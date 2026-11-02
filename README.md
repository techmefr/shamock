<p align="center">
  <a href="https://techmefr.github.io/shamock/"><img src="docs/public/banner.svg" alt="shamock" width="100%"></a>
</p>

<p align="center">
  <a href="https://github.com/techmefr/shamock/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/techmefr/shamock/ci.yml?branch=main&amp;style=flat-square"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-typed-3178c6?style=flat-square">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://techmefr.github.io/shamock/"><b>Documentation</b></a> ·
  <a href="https://techmefr.github.io/shamock/getting-started/">Quickstart</a> ·
  <a href="https://techmefr.github.io/shamock/reference/shamock/">API reference</a> ·
  <a href="#ecosystem">Ecosystem</a>
</p>

# shamock

**Real schemas. Ghost data.**

Schema-driven mock engine. Validate fixtures against any
[Standard Schema](https://standardschema.dev) validator (Zod, Valibot,
ArkType...), and serve them from an in-process mock API that answers
`fetch` calls. Zero dependencies.

> **Keywords** — `mock` · `mocking` · `fixtures` · `mock-data` · `schema-validation` · `standard-schema` · `typescript` · `zod` · `valibot` · `arktype` · `offline` · `fallback` · `testing`

## Why shamock

| Feature | What you get |
|---|---|
| **Real schemas** | Validate fixtures with any Standard Schema validator. |
| **Actionable errors** | `MockValidationError` reports issues, field paths and list indexes. |
| **Mock API over `fetch`** | `search`, `mutate` and `DELETE` routes served from seed data. |
| **Safe by default** | Atomic writes, bounded inputs, no dependency. |

## Install

```bash
pnpm add shamock
```

Add the validator of your choice, for example `zod`. Requires Node.js 22 or later.

## Validate fixtures

```ts
import { parseMock, parseMockList } from 'shamock'
import { z } from 'zod'

const product = { schema: z.object({ id: z.number(), name: z.string() }) }

await parseMock(product, { id: 1, name: 'A' })
await parseMockList(product, [{ id: 1, name: 'A' }])
```

## Mock the network

```ts
import { installMock } from 'shamock'

const mock = await installMock({
  baseUrl: 'https://api.example.com',
  seed: { products: [{ id: 1, name: 'A' }] },
  timing: 0,
})

const response = await fetch('https://api.example.com/products/search', {
  method: 'POST',
  body: '{}',
})
const { data } = await response.json()

mock.restore()
```

`installMock` replaces `globalThis.fetch`. Requests under `baseUrl` are
answered from the seed, every other request goes to the previous `fetch`.
`createMock` returns the same mock without touching the global.

## API

| Export | Role |
|---|---|
| `parseMock(resource, mock)` | Validate one value. |
| `parseMockList(resource, mock)` | Validate an array, or wrap one value in an array. |
| `MockValidationError` | Thrown on invalid data, with `issues` and `index`. |
| `createMock(config)` | Returns `{ handle, fetch, install }`. |
| `installMock(config)` | Installs the mock and returns it with `restore()`. |
| `MockConfig`, `MockSeed`, `MockResource`, `MockRelation`, `FailureRule`, `FetchLike`, `Mock`, `InstalledMock`, `MockableResource` | Types. |

Routes under `baseUrl`: `POST /<resource>/search`, `POST /<resource>/mutate`
and `DELETE /<resource>`. `search` answers the lomkit paginator (`data` plus `current_page`, `last_page`, `per_page`, `total`, `from`, `to` at the root, `meta: []`, 50 rows per page by default). `mutate` supports create and update only and answers `{ created: [ids], updated: [ids] }`. Failures
return `404`, `413` or `422` with `{ message, errors }`. XHR is not intercepted.

### Configuration

| Field | Notes |
|---|---|
| `baseUrl` | Absolute URL. Routes live under its path. |
| `seed` | `{ [resource]: object[] }`. Each key becomes a resource. |
| `resources[name].schema` | Standard Schema. Validates the seed and every written record. |
| `resources[name].unique` | Field names that must stay unique. |
| `resources[name].limits` | Accepted `limit` values for this resource. |
| `resources[name].searchable` | Fields read by `text` search. All string fields by default. |
| `resources[name].relations` | `{ [relation]: { type: 'belongsTo' \| 'hasMany', resource, foreignKey } }`, read by `includes`. |
| `limits` | Accepted `limit` values. Default `[10, 25, 50]`. |
| `likeEscape` | `false` reads a backslash in `like` and `text` literally, as SQLite and Lomkit do. Default `true`: a backslash escapes `%`, `_` and itself. |
| `maxNestingDepth` | Group levels allowed in `filters`, from `1` to `10`. Default `1`: a group cannot hold a group, like lomkit. |
| `failures` | Fault injection rules, see below. |
| `timing` | Delay in ms, `0` to `60000`. Default `300`. |

```ts
const mock = await createMock({
  baseUrl: 'https://api.example.com',
  seed: { users: [{ id: 1, name: 'Ann', email: 'a@x.test', manager_id: null }] },
  resources: {
    users: {
      unique: ['email'],
      relations: { manager: { type: 'belongsTo', resource: 'users', foreignKey: 'manager_id' } },
    },
  },
  failures: [{ method: 'POST', path: '/users/mutate', status: 503, times: 2 }],
  timing: 0,
})
```

### Behavior

The mock follows the answers measured on a real Laravel + `lomkit/laravel-rest-api` backend on SQLite.

- `and` binds tighter than `or`, as in SQL: `a and b or c and d` is `(a and b) or (c and d)`. A group (`nested`) counts as one condition and cannot hold another group (`422`) unless `maxNestingDepth` is raised.
- Supported in `search`: `filters`, `sorts`, `selects`, `includes`, `text`, `limit`, `page`. Refused with `422`: `aggregates`, `scopes`, `instructions`, `gates` (empty arrays are accepted), any unknown search key, any unknown filter key, an unknown operator, an unknown relation, a `like` filter combined with `text`, an empty `in` list.
- `limit` must be one of `limits` (default `[10, 25, 50]`, per resource with `resources[name].limits`), otherwise `422` with `errors: { 'search.limit': [...] }`. Without `limit`, a page holds 50 rows.
- `selects` keeps the listed fields. `includes` embeds relations declared in `resources[name].relations` (`belongsTo` as an object or `null`, `hasMany` as an array), with their own `filters`, `sorts`, `selects`, `limit` and nested `includes`.
- `like` folds ASCII letters only (`é` and `É` differ), `%` and `_` are wildcards, a backslash escapes them. `in` and `not in` never match a null value, and `not in` a list holding `null` matches nothing.
- Null sorts first ascending and last descending, as in SQLite.
- Dates (`Date` objects and ISO strings in seeds, mutations and filter values) are stored and compared as `Y-m-d H:i:s` in UTC. A date-only string compares as text.
- `text: { value }` matches `%value%` on the string fields (all of them, or `resources[name].searchable`).
- With `resources[name].schema`, created and updated records are validated: `422` with errors keyed like Laravel, `mutate.<index>.attributes.<field>`. `resources[name].unique` lists unique fields: a duplicate is a `422` on `mutate.<index>.attributes.<field>`.
- Updating an unknown id returns `404`. Deleting an unknown id, or deleting without `resources`, returns `422` (`resources.<index>`, `resources`).
- Generated ids are numbers when the seed ids are numbers, strings otherwise.
- `failures` injects faults, rule by rule: `{ method?, path?, after?, times?, status?, network?, delay? }`. A rule matches a method and a path such as `/users/search`, skips `after` matching calls, then fires `times` times (every call when omitted). It answers `status` (400 to 599, body `{ message: 'Injected failure', errors: {} }`), rejects with a `TypeError` for `network: true`, and waits `delay` ms first. The first rule that fires wins.
- `timing` defaults to 300 ms per call. Pass `timing: 0` in tests.
- `mock.fetch` forwards foreign URLs to the `fetch` captured at `createMock`.

Not supported: aggregates, scopes, instructions, gates, text search sorts and filters limited to a scout field list, field name validation, policies, soft deletes, restore and force delete, `mutate` operations other than `create` and `update`, relation mutations, validation without a schema. A backslash in a `like` pattern is an escape unless `likeEscape: false`, whereas SQLite and Lomkit read it literally.

Full details in the [documentation](https://techmefr.github.io/shamock/).

## Ecosystem

| Project | Role |
|---|---|
| [nexdk](https://github.com/techmefr/nexdk) | One resource grammar for REST, GraphQL and WebSocket backends. |
| [beepr](https://github.com/techmefr/beepr) | Typed events and notification adapters. |
| [dialectr](https://github.com/techmefr/dialectr) | One query builder that compiles to lomkit, Strapi and PocketBase. |

Each library works on its own. None is published to npm yet.

## License

MIT © techmefr
