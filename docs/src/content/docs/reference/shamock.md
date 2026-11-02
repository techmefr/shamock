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

Throws `MockValidationError` for invalid seeds, `RangeError` for an invalid `timing`, and an `Error` when `resources` names a resource missing from `seed`.

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
  resources?: Record<string, MockableResource>
  timing?: number
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

Defaults: `timing` is `300` ms, accepted range `0` to `60000`. `baseUrl` must be absolute.

Routes, payloads, errors and limits are described in the [Mock API guide](/shamock/guides/mocking/).
