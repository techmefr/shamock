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

shamock intercepts the real `fetch` call and, instead of letting it reach the
backend, answers with the JSON you provide. On top of that interception, a small
engine (seed, search, mutate, delete) lets the answers follow your data, and any
[Standard Schema](https://standardschema.dev) validator (Zod, Valibot,
ArkType...) checks your fixtures. Zero dependencies.

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

## Activate with a variable

The calling code is the same with the mock and with the real backend. A variable switches the mock.

```ts
import { isMockEnabled } from 'shamock'

const mock = await installMock({
  baseUrl: 'https://api.example.com',
  seed,
  enabled: isMockEnabled({ SHAMOCK: import.meta.env.VITE_SHAMOCK }),
})
```

`isMockEnabled(env?, variable = 'SHAMOCK')` is true for `1`, `true`, `on`, `yes` (any case), false otherwise, and reads `process.env` without `env`. Pass `import.meta.env` values for Vite, SvelteKit, Solid and Astro, the runtime config or `NEXT_PUBLIC_` for Nuxt and Next, `Deno.env.get()` for Deno, a binding for Workers. When disabled, `install()` does nothing and `mock.fetch` calls the real `fetch`.

To keep shamock out of the production bundle, import it behind the switch (`shamock/enabled` holds only the switch, about 400 bytes):

```ts
import { isMockEnabled } from 'shamock/enabled'

if (import.meta.env.DEV && isMockEnabled({ SHAMOCK: import.meta.env.VITE_SHAMOCK })) {
  const { installMock } = await import('shamock')
  await installMock({ baseUrl: 'https://api.example.com', seed })
}
```

With a constant condition such as `import.meta.env.DEV`, the bundler drops the shamock chunk (about 7 kB gzipped). With `isMockEnabled` alone the chunk is emitted but never loaded when the variable is off.

## Mock only what is not ready

`resources[name].mock` is `true` by default. `false` sends that resource to the real `fetch`, the others stay mocked in the same client.

```ts
await installMock({
  baseUrl: 'https://api.example.com',
  seed: { orders: [{ id: 1, total: 20 }] },
  resources: { users: { mock: false } },
})
```

`users` reaches the real backend, `orders` comes from the seed. A resource set to `false` needs no seed entry.

In tests, `mock.reset()` puts everything back to the seed, for example in vitest:

```ts
const mock = await createMock({ baseUrl: 'https://api.example.com', timing: 0, seed })
beforeEach(() => mock.reset())
```

## API

| Export | Role |
|---|---|
| `parseMock(resource, mock)` | Validate one value. |
| `parseMockList(resource, mock)` | Validate an array, or wrap one value in an array. |
| `MockValidationError` | Thrown on invalid data, with `issues` and `index`. |
| `createMock(config)` | Returns `{ handle, fetch, install }`. |
| `installMock(config)` | Installs the mock and returns it with `restore()`. |
| `isMockEnabled(env?, variable?)` | Reads the switch variable. Also exported from `shamock/enabled`. |
| `mock.reset()` | Puts every resource back to its seed and rewinds `failures`. |
| `MockConfig`, `MockSeed`, `MockResource`, `MockRelation`, `FailureRule`, `FetchLike`, `Mock`, `InstalledMock`, `MockableResource` | Types. |

shamock answers a documented request protocol (search, mutate, delete), not a particular backend. Routes under `baseUrl`: `POST /<resource>/search`, `POST /<resource>/mutate`
and `DELETE /<resource>`. `search` answers a paginated envelope (`data` plus `current_page`, `last_page`, `per_page`, `total`, `from`, `to` at the root, `meta: []`, 50 rows per page by default). `mutate` supports create and update only and answers `{ created: [ids], updated: [ids] }`, the ids written. Failures
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
| `resources[name].links` | `{ [relation]: { type: 'belongsTo' \| 'hasMany', resource, foreignKey } }`, read by `includes` and `aggregates`. |
| `resources[name].scopes` | `{ [name]: (rows, params) => rows }`, applied by `scopes: [{ name, parameters }]`. |
| `resources[name].instructions` | `{ [name]: (rows, fields) => rows }`, applied by `instructions: [{ name, fields: [{ name, value }] }]`, `fields` being an object. |
| `resources[name].gates` | `{ view, update, delete, restore, forceDelete: (row) => boolean }`, answered for `gates: [...]`. |
| `profile` | `'lomkit'` opts in to the strict compatibility profile, see Behavior. Omitted: the mock follows the JSON you give it. |
| `limits` | Accepted `limit` values. Any positive `limit` by default, `[10, 25, 50]` with `profile: 'lomkit'`. |
| `likeEscape` | `true`: a backslash escapes `%`, `_` and itself. `false` reads it literally. Default `true`, `false` with `profile: 'lomkit'`. |
| `maxNestingDepth` | Group levels allowed in `filters`, from `1` to `10`. Default `10`, `1` with `profile: 'lomkit'`. |
| `failures` | Fault injection rules, see below. |
| `timing` | Delay in ms, `0` to `60000`. Default `300`. |
| `enabled` | `false` disables the mock: no interception, `mock.fetch` calls the real `fetch`. |
| `fetch` | `fetch` used for requests that are not mocked. Default `globalThis.fetch` at `createMock`. |
| `resources[name].mock` | `false` sends the resource to the real `fetch`. Default `true`. |

```ts
const mock = await createMock({
  baseUrl: 'https://api.example.com',
  seed: { users: [{ id: 1, name: 'Ann', email: 'a@x.test', manager_id: null }] },
  resources: {
    users: {
      unique: ['email'],
      links: { manager: { type: 'belongsTo', resource: 'users', foreignKey: 'manager_id' } },
    },
  },
  failures: [{ method: 'POST', path: '/users/mutate', status: 503, times: 2 }],
  timing: 0,
})
```

### Behavior

The mock answers from the JSON you provide. Its default behavior is simple and data-driven.

- `and` binds tighter than `or`, as in SQL: `a and b or c and d` is `(a and b) or (c and d)`. A group (`nested`) counts as one condition.
- Supported in `search`: `filters`, `sorts`, `selects`, `includes`, `text`, `limit`, `page`, and `aggregates`, `scopes`, `instructions`, `gates` once declared. Unknown keys are ignored. An unknown operator answers `422`. An `includes` entry naming an undeclared relation is ignored, so data embedded in your JSON stays as is.
- Any positive `limit` is accepted. Without `limit`, a page holds 50 rows. `limits` (and `resources[name].limits`) restrict the accepted values: anything else is a `422` with `errors: { 'search.limit': [...] }`.
- `selects` keeps the listed fields. `includes` embeds relations declared in `resources[name].links` (`belongsTo` as an object or `null`, `hasMany` as an array), with their own `filters`, `sorts`, `selects`, `limit` and nested `includes`.
- `like` is case-insensitive, `%` and `_` are wildcards, a backslash escapes them unless `likeEscape: false`. `in []` matches nothing.
- `aggregates: [{ relation, type, field, filters, alias }]` computes `count`, `exists`, `sum`, `avg`, `min` or `max` over a relation declared in `resources[name].links` and adds the value to each row under `alias`, or `<relation in snake_case>_<type>[_<field>]` (`posts_count`, `posts_sum_score`). `field` is required for `sum`, `avg`, `min` and `max`. `count` is `0` and `exists` is `false` without related rows, the others are `null`. `filters` select the related rows.
- `scopes` and `instructions` are functions you declare per resource. They receive the rows and return the rows to keep, before `filters`, `sorts` and pagination, so `total` follows.
- `gates: ['view', 'update', ...]` adds `gates: { authorized_to_view: true, ... }` to each row, as lomkit does (names `authorized_to_view`, `authorized_to_update`, `authorized_to_delete`, `authorized_to_restore`, `authorized_to_force_delete`), from the functions declared in `resources[name].gates`. `create` and `viewAny` are accepted and add nothing.
- A field ending in `.keyword` (the Elasticsearch suffix used by Scout) filters and sorts as the field without the suffix.
- Null sorts last in both directions. Dates are kept as given.
- `text: { value }` keeps the records where a string field contains the value, case-insensitively (all string fields, or `resources[name].searchable`).
- With `resources[name].schema`, created and updated records are validated: `422` with errors keyed by field name (`record` for a root issue). `resources[name].unique` lists unique fields: a duplicate is a `422` keyed by the field.
- Updating an unknown id returns `404`. Deleting an unknown id succeeds, so a delete can be repeated.
- Generated ids are numbers when the seed ids are numbers, strings otherwise.
- `failures` injects faults, rule by rule: `{ method?, path?, after?, times?, status?, network?, delay? }`. A rule matches a method and a path such as `/users/search`, skips `after` matching calls, then fires `times` times (every call when omitted). It answers `status` (400 to 599, body `{ message: 'Injected failure', errors: {} }`), rejects with a `TypeError` for `network: true`, and waits `delay` ms first. The first rule that fires wins.
- `timing` defaults to 300 ms per call. Pass `timing: 0` in tests.
- `mock.fetch` forwards foreign URLs to the `fetch` captured at `createMock`.
- `ofetch` and Nuxt `$fetch` read `globalThis.fetch` at each call, so `installMock` intercepts them. `ofetch.create(defaults, { fetch })` needs `mock.fetch` (or a function resolving `globalThis.fetch` at call time) as `fetch`. A Nuxt plugin and a Vitest setup are in the documentation (Nuxt, $fetch and Vitest).

#### Compatibility profile

`profile: 'lomkit'` is an optional convenience for code that talks to `lomkit/laravel-rest-api`. It is opt-in and changes only these points:

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
| Unknown search or filter keys | ignored | `422` |
| `aggregates`, `scopes`, `instructions`, `gates` without a declaration, an unknown relation, scope, instruction or gate name | ignored | `422` (empty arrays accepted) |
| `includes` of an undeclared relation | ignored | `422` |
| `like` filter with `text` | allowed | `422` |
| `text` | plain substring | `%value%` pattern, `%` and `_` are wildcards |

`limits`, `maxNestingDepth`, `likeEscape`, `unique`, `searchable` and `failures` work with or without the profile, and an explicit option wins over the profile.

Not supported: aggregates on nested relation paths, text search sorts and filters limited to a scout field list, field name validation, policies, soft deletes, restore and force delete, `mutate` operations other than `create` and `update`, relation mutations, validation without a schema.

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
