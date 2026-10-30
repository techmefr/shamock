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

Validates a single value against `resource.schema` (any [Standard Schema](https://standardschema.dev) validator) and returns the parsed result. Async because Standard Schema's `validate()` may return a `Promise`. Throws `MockValidationError` if validation fails. The error exposes the original `issues`, includes field paths in its message, and carries an `index` for an invalid list item.

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
| `POST /{baseUrl}/{resource}/search` | Applies filters and sorts, then optional `limit`/`page` pagination. Returns `{ data }`, plus pagination `meta` when a limit is supplied. |
| `POST /{baseUrl}/{resource}/mutate` | Accepts `{ mutate: [...] }` with Lomkit create/update operations (`operation`, `attributes`, and `key` for updates), or flat records with an optional `id`. |
| `DELETE /{baseUrl}/{resource}` | Accepts `{ resources: [id, ...] }` or `{ id }` and removes matching records. |

`config`:

| Field | Type | Notes |
|-------|------|-------|
| `baseUrl` | `string` | Used as Mirage's `urlPrefix`, so seeded routes match your driver's configured base URL. |
| `seed` | `MirageResourceSeed` (`{ [resourceName]: object[] }`) | Initial data per resource; also determines which resources get routes. |
| `resources` | `Record<string, MockableResource>` | Optional schemas for validating seed data before the server starts. |
| `timing` | `number` | Mock response delay in milliseconds; defaults to 300. |

## Types

| Type | Role |
|------|------|
| `MockableResource` | `{ schema: StandardSchemaV1 }` — the minimal shape `parseMock`/`parseMockList` accept. Any `nexdk` resource (from `defineResource`) already satisfies this. |
| `MirageResourceSeed` | `{ [resourceName: string]: Record<string, unknown>[] }` — the seed data shape `setupMirageMock` expects. |
| `MirageSdkConfig` | `{ baseUrl: string, seed: MirageResourceSeed, resources?: Record<string, MockableResource>, timing?: number }` — `setupMirageMock`'s config. |

## `MockValidationError`

Extends `Error` and exposes `issues` plus an optional zero-based list `index`. Use `instanceof MockValidationError` to distinguish fixture validation failures from other errors.
