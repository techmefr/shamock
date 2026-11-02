---
title: shamock API reference
description: Every runtime export of the shamock package.
---

## `parseMock(resource, mock)`

```ts
function parseMock<TResource extends MockableResource>(
  resource: TResource,
  mock: unknown,
): Promise<unknown>
```

Validates one value against `resource.schema` and returns the parsed result. Throws `MockValidationError` on failure.

## `parseMockList(resource, mock)`

```ts
function parseMockList<TResource extends MockableResource>(
  resource: TResource,
  mock: unknown,
): Promise<unknown[]>
```

Validates every item of an array, or wraps one validated value in an array. Items are validated concurrently.

## `MockValidationError`

Extends `Error`. Exposes `issues` (the original Standard Schema issues) and `index` (zero-based, set for invalid list items). The message holds field paths and the index.

## `createMock(config)`

```ts
function createMock(config: MockConfig): Promise<Mock>
```

Validates the config and seeds, then returns a mock. Nothing is installed.

Throws `MockValidationError` for invalid seeds, `RangeError` for an invalid `timing`, `limits` or failure `status`, `delay`, `after` or `times`, `TypeError` for an invalid failure rule, and an `Error` when `resources` names a resource missing from `seed` or a relation targets one.

## `installMock(config)`

```ts
function installMock(config: MockConfig): Promise<InstalledMock>
```

Same as `(await createMock(config)).install()`.

## Types

```ts
interface MockConfig {
  baseUrl: string
  seed: MockSeed
  resources?: Record<string, MockResource>
  profile?: 'lomkit'
  limits?: number[]
  likeEscape?: boolean
  maxNestingDepth?: number
  failures?: FailureRule[]
  timing?: number
}

interface MockResource {
  schema?: StandardSchemaV1
  unique?: string[]
  limits?: number[]
  searchable?: string[]
  relations?: Record<string, MockRelation>
}

interface MockRelation {
  type: 'belongsTo' | 'hasMany'
  resource: string
  foreignKey: string
}

interface FailureRule {
  method?: string
  path?: string
  after?: number
  times?: number
  status?: number
  network?: boolean
  delay?: number
}

interface MockSeed {
  [resourceName: string]: Record<string, unknown>[]
}

interface Mock {
  handle: (request: Request) => Promise<Response>
  fetch: FetchLike
  install: () => InstalledMock
}

interface InstalledMock extends Mock {
  restore: () => void
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface MockableResource {
  schema: StandardSchemaV1
}
```

| Member | Behavior |
|---|---|
| `handle` | Answers a `Request` as the mock. `404` outside `baseUrl`. |
| `fetch` | Serves requests under `baseUrl`, forwards the rest to the `fetch` captured when `createMock` was called. |
| `install` | Replaces `globalThis.fetch` and returns the mock with `restore`. |
| `restore` | Removes this install. Safe to call twice, and in any order across nested installs. |

Defaults: `timing` is `300` ms (pass `0` in tests), accepted range `0` to `60000`; `limits` is unset (any positive `limit`), `[10, 25, 50]` with `profile: 'lomkit'`. `baseUrl` must be absolute.

Routes, payloads, errors and limits are described in the [Mock API guide](/shamock/guides/mocking/).
