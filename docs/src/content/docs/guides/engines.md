---
title: Engines
description: JSON per route, record and replay, scenarios, CRUD by convention with the rest engine, the optional lomkit engine, and how to write your own engine.
---

shamock replays rather than interprets. The **core** intercepts `fetch`, knows no protocol and answers JSON per route, recorded or written by hand, with named scenarios. An **engine** is an optional plug-in that gives the answers a state: `rest` for CRUD by convention, `lomkit` for that protocol, or your own.

| Entry | Contains | gzip |
|---|---|---|
| `shamock/core` | interception, switch, per-resource `mock`, `failures`, `timing`, `reset`, in-memory store and seed, static routes, record and replay, scenarios | 6.0 kB |
| `shamock/rest` | CRUD by convention | +0.9 kB (6.9 kB with the core) |
| `shamock/lomkit` | search / mutate / delete engine, `profile: 'lomkit'` | 12.8 kB with the core |
| `shamock` | the core and the lomkit engine, used when `engine` is omitted | 12.8 kB |

Recommended: import from `shamock/core` and pass `engine` explicitly. The main entry `shamock` keeps the lomkit engine as its default so that existing code keeps working.

## No engine: static JSON per route

The engine is a convenience for a mock with a state. Without it, shamock still intercepts the real `fetch` and answers a fixed JSON per route, with no state and no protocol.

```ts
import { installMock } from 'shamock/core'

const mock = await installMock({
  baseUrl: 'https://api.example.com',
  timing: 0,
  routes: {
    'GET /products': [{ id: 1, name: 'A' }],
    'POST /login': { token: 'abc' },
    '/ping': 'pong',
    'GET /me': () => new Response('{"message":"unauthorized"}', { status: 401 }),
  },
})
```

- A key is `METHOD /path` or `/path` (any method). Trailing slashes are ignored, the query string is not part of the key.
- `METHOD /path #<hash>` answers only the request whose body hashes to `<hash>`: `bodyKey(body)` from `shamock/core`, FNV-1a 32 bits in hex of the JSON with keys sorted at every level. A key with a hash wins over the same key without.
- A value is JSON, `{ "$status": number, "$body": json }` for another status (`$body` omitted for an empty body), or a function `(request, path) => value | Response`.
- Requests under `baseUrl` that match no route go to the real `fetch` (`unhandled: 'passthrough'`, the default). Through `mock.handle` they answer `404`. With an engine, a path it does not match answers `404` as before.
- `unhandled: 'error'` answers every request under `baseUrl` with no route and no engine match (or an engine resource missing from the seed) with `501` `{ "message": "No mock for METHOD /path" }`, through `fetch` and `handle`.
- `failures`, `timing`, `enabled`, `fetch` and `reset` apply to static routes too. `routes` is checked before the engine when both are given.

## Record and replay

```ts
import { createMock } from 'shamock/core'

const recorder = await createMock({ baseUrl: 'https://api.example.com', record: true })
await recorder.fetch('https://api.example.com/products')
const routes = recorder.recorded()

const replay = await createMock({ baseUrl: 'https://api.example.com', routes, unhandled: 'error' })
```

- With `record: true`, every request under `baseUrl` goes to the real `fetch` (`config.fetch`, or the previous global once installed) and its answer is returned untouched. No latency, no failures, no engine.
- `mock.recorded()` returns an object usable as `routes`: `METHOD /path`, with ` #<hash>` when the request has a body. A 2xx JSON answer is stored as is, any other status as `{ $status, $body }`, an empty body as `{ $status }`. A body that is not JSON is not recorded. The query string is not part of the key, the last answer wins.
- `reset()` clears the recordings. `mock.handle` does not record.

## Scenarios

```ts
await installMock({
  baseUrl: 'https://api.example.com',
  seed: { users: [{ id: 1, name: 'Ada' }] },
  engine: rest(),
  scenarios: {
    empty: { seed: { users: [] } },
    down: { failures: [{ status: 503 }] },
  },
  scenario: 'empty',
})
```

A scenario holds `routes`, `seed` and `failures`. The chosen one is merged over the config at creation: `routes` and `seed` key by key, `failures` replaced when the scenario gives them. An unknown scenario throws. `reset()` goes back to the merged seed.

## The rest engine

```ts
import { installMock } from 'shamock/core'
import { rest } from 'shamock/rest'

const mock = await installMock({
  baseUrl: 'https://api.example.com',
  seed: { products: [{ id: 1, name: 'A' }] },
  engine: rest(),
  timing: 0,
})
```

| Request | Answer |
|---|---|
| `GET /<r>` | An array. Every query parameter is an equality filter. Header `X-Total-Count`. |
| `GET /<r>/:id` | The record, or `404`. |
| `POST /<r>` | `201` with the record. |
| `PATCH` or `PUT /<r>/:id` | `200` with the merged record, `404` for an unknown id. |
| `DELETE /<r>/:id` | `204`, `404` for an unknown id. |

Errors are `{ message, errors }` with `404` or `422`. `resources[name].schema` (Standard Schema) validates every written record, `resources[name].unique` keeps fields unique, and numeric or string ids are kept as given. There is no sorting and no pagination: `sort` or `page` filter like any other parameter. A sorted or paged answer goes in `routes`, written or recorded.

The plain array and the plain record it answers are read as is by the nexdk `nest` and `symfony` drivers.

## The lomkit engine

`lomkit(options)` is the former built-in engine, unchanged: `POST /<r>/search`, `POST /<r>/mutate`, `DELETE /<r>`, the options `profile`, `limits`, `likeEscape`, `maxNestingDepth`, and the per-resource `links`, `scopes`, `instructions`, `gates`, `limits`, `searchable`. See [Mock API](/shamock/guides/mocking/).

```ts
import { installMock } from 'shamock/core'
import { lomkit } from 'shamock/lomkit'

await installMock({ baseUrl: 'https://api.example.com', seed, engine: lomkit({ profile: 'lomkit' }) })
```

## Write an engine

An engine is two functions. The core handles the base URL, `enabled`, `mock: false`, latency, `failures`, the serialization of writes, the in-memory store and `reset`.

```ts
interface Engine<TRoute extends Route = Route, TResource extends object = object> {
  match(request: { method: string; path: string }): TRoute | undefined
  handle(context: EngineContext<TRoute, TResource>): Response | Promise<Response>
  normalize?: (attributes: Record<string, unknown>) => Record<string, unknown>
  validate?(setup: { resources: Record<string, MockResource & TResource>; names: string[] }): void
}
```

- `match` gets the method and the path under `baseUrl` (leading `/`, no trailing slash). It returns a route, an object with the `resource` name and anything you need, or `undefined` for a `404`. A route whose resource has `mock: false` goes to the real `fetch`.
- `handle` gets `{ request, method, path, route, store, resource, storeOf, resourceOf, exclusive }`. `store` is the in-memory store of the resource (`all`, `get`, `insert`, `update`, `has`, `remove`, `transaction`, `preview`) and `resource` its config. Wrap writes in `exclusive`. Throw `HttpError(status, message, errors)` to answer `{ message, errors }`.
- `normalize` runs on each stored record, `validate` runs once at creation to reject an invalid config.
- Your own per-resource options are the type parameter `TResource`.
- `shamock/core` exports the helpers `HttpError`, `json`, `notFound`, `readJson`, `readRequiredJson`, `validateRecord` and `invalidData`.

```ts
import { createMock, json } from 'shamock/core'
import type { Engine } from 'shamock/core'

const lists: Engine = {
  match: ({ method, path }) => {
    const [, resource, extra] = path.split('/')
    return resource && !extra && (method === 'GET' || method === 'POST') ? { resource } : undefined
  },
  handle: async ({ method, request, store }) =>
    method === 'POST' ? json(store.insert(await request.json()), 201) : json(store.all()),
}

await createMock({ baseUrl: 'https://api.example.com', seed: { users: [] }, engine: lists })
```

To imitate another backend (PocketBase, Strapi, Hydra), write that engine in your own code from this contract. `rest` is a good starting point: its source is the model. Often recording the real backend and replaying it is enough.

Any engine can be checked with the shared contract test of the repository (`test/engine-contract.ts`): matching, state and `reset`, unknown resource, `mock: false`, outside `baseUrl`, `failures`, `enabled: false`.
