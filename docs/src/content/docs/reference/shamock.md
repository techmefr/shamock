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

The config accepts `engine` (`rest()` from `shamock/rest`, `lomkit()` from `shamock/lomkit`, or your own), `routes` (static JSON per route, keys `METHOD /path`, `/path` or `METHOD /path #<bodyKey>`, values JSON, `{ $status, $body }` or a function), `unhandled` (`'passthrough'` or `'error'`, `501` for an unhandled call), `record` (capture real answers for `mock.recorded()`) and `scenarios` with `scenario` (named overrides of `routes`, `seed` and `failures`). Imported from `shamock/core`, `engine` is optional and there is no default: without it only `routes` answer. Imported from `shamock`, the lomkit engine is the default when `engine` is omitted, and its options (`profile`, `limits`, `likeEscape`, `maxNestingDepth`) sit at the root of the config. See [Engines](/shamock/guides/engines/).

Throws `MockValidationError` for invalid seeds, `RangeError` for an invalid `timing`, `limits` or failure `status`, `delay`, `after` or `times`, `TypeError` for an invalid failure rule, an `Error` when `resources` names a resource missing from `seed` or a relation targets one, or when `scenario` names an unknown scenario, and a `TypeError` for an invalid `unhandled` or route key.

## `installMock(config)`

```ts
function installMock(config: MockConfig): Promise<InstalledMock>
```

Same as `(await createMock(config)).install()`.

## `isMockEnabled(env?, variable?)`

```ts
function isMockEnabled(env?: Record<string, unknown>, variable = 'SHAMOCK'): boolean
```

`true` when the variable is `1`, `true`, `on` or `yes` (any case), `false` otherwise. `env` defaults to `globalThis.process?.env`. Also exported from `shamock/enabled`, a module that holds nothing else. See [Mock or real backend](/shamock/guides/switching/).

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
  enabled?: boolean
  fetch?: FetchLike
}

interface MockResource {
  schema?: StandardSchemaV1
  unique?: string[]
  limits?: number[]
  searchable?: string[]
  links?: Record<string, MockRelation>
  scopes?: Record<string, ScopeFn>
  instructions?: Record<string, InstructionFn>
  gates?: Partial<Record<GateName, GateFn>>
  mock?: boolean
}

type ScopeFn = (rows: Record<string, unknown>[], params: unknown[]) => Record<string, unknown>[]
type InstructionFn = (rows: Record<string, unknown>[], fields: Record<string, unknown>) => Record<string, unknown>[]
type GateName = 'view' | 'update' | 'delete' | 'restore' | 'forceDelete'
type GateFn = (row: Record<string, unknown>) => boolean

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
  reset: () => void
  recorded: () => Record<string, unknown>
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
| `reset` | Puts every resource back to its seed, rewinds the `failures` counters and clears the recordings. |
| `recorded` | With `record: true`, the captured answers as an object usable as `routes`. `{}` otherwise. |
| `install` | Replaces `globalThis.fetch` and returns the mock with `restore`. |
| `restore` | Removes this install. Safe to call twice, and in any order across nested installs. |

`enabled: false` makes `createMock` return a mock that calls the real `fetch` (the `fetch` option or the captured `globalThis.fetch`): `install()` changes nothing and returns a no-op `restore`. `resources[name].mock: false` sends that resource to the real `fetch`.

Defaults: `timing` is `300` ms (pass `0` in tests), accepted range `0` to `60000`; `limits` is unset (any positive `limit`), `[10, 25, 50]` with `profile: 'lomkit'`. `baseUrl` must be absolute.

Routes, payloads, errors and limits are described in the [Mock API guide](/shamock/guides/mocking/).
