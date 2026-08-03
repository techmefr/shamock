---
title: chaff API reference
description: Every runtime export of the chaff package.
---

## `parseMock(resource, mock)`

```ts
function parseMock<TResource extends MockableResource>(
  resource: TResource,
  mock: unknown,
): Promise<unknown>
```

Validates a single value against `resource.schema` (any [Standard Schema](https://standardschema.dev) validator) and returns the parsed result. Async because Standard Schema's `validate()` may return a `Promise`. Throws (joining every issue's `message` with `; `) if the value fails validation.

## `parseMockList(resource, mock)`

```ts
function parseMockList<TResource extends MockableResource>(
  resource: TResource,
  mock: unknown,
): Promise<unknown[]>
```

Same validation as `parseMock`, but always returns an array: if `mock` is already an array, every item is validated (in parallel); otherwise the single value is validated and wrapped in a one-element array.

## `setupMirageMock(config)`

```ts
function setupMirageMock(config: MirageSdkConfig): Promise<unknown>
```

Spins up a [MirageJS](https://miragejs.com) server (dynamically imported — `miragejs` is an optional peer dependency, only required if you call this) backed by `config.seed`, serving three routes per resource name in the lomkit REST shape:

| Route | Behavior |
|-------|----------|
| `POST /{baseUrl}/{resource}/search` | Returns `{ data: <all seeded records>, meta: null }`. |
| `POST /{baseUrl}/{resource}/mutate` | Reads `{ mutate: [...] }` from the body; inserts records with no `id`, updates+returns records that have one. |
| `DELETE /{baseUrl}/{resource}` | Reads `{ id }` from the body and removes that record. |

`config`:

| Field | Type | Notes |
|-------|------|-------|
| `baseUrl` | `string` | Used as Mirage's `urlPrefix`, so seeded routes match your driver's configured base URL. |
| `seed` | `MirageResourceSeed` (`{ [resourceName]: object[] }`) | Initial data per resource; also determines which resources get routes. |

## Types

| Type | Role |
|------|------|
| `MockableResource` | `{ schema: StandardSchemaV1 }` — the minimal shape `parseMock`/`parseMockList` accept. Any `nexdk` resource (from `defineResource`) already satisfies this. |
| `MirageResourceSeed` | `{ [resourceName: string]: Record<string, unknown>[] }` — the seed data shape `setupMirageMock` expects. |
| `MirageSdkConfig` | `{ baseUrl: string, seed: MirageResourceSeed }` — `setupMirageMock`'s config. |
