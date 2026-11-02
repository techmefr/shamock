---
title: Engines
description: The agnostic core, the rest and lomkit engines, static routes without an engine, and how to write your own engine.
---

shamock is two layers. The **core** intercepts `fetch` and knows no protocol. An **engine** is an optional plug-in that gives the answers a state and a request protocol.

| Entry | Contains | gzip |
|---|---|---|
| `shamock/core` | interception, switch, per-resource `mock`, `failures`, `timing`, `reset`, in-memory store and seed, static routes | 5.0 kB |
| `shamock/rest` | generic REST engine | +1.3 kB (6.4 kB with the core) |
| `shamock/lomkit` | search / mutate / delete engine, `profile: 'lomkit'` | 11.8 kB with the core |
| `shamock` | the core and the lomkit engine, used when `engine` is omitted | 11.9 kB |

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

- A key is `METHOD /path` or `/path` (any method). Trailing slashes are ignored.
- A value is JSON, or a function `(request, path) => json | Response`.
- Requests under `baseUrl` that match no route go to the real `fetch`. Through `mock.handle` they answer `404`.
- `failures`, `timing`, `enabled`, `fetch` and `reset` apply to static routes too. `routes` is checked before the engine when both are given.

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
| `GET /<r>` | An array. Query `page`, `perPage` or `limit`, `sort=name,-age`, every other parameter is an equality filter. Header `X-Total-Count`. |
| `GET /<r>/:id` | The record, or `404`. |
| `POST /<r>` | `201` with the record. |
| `PATCH` or `PUT /<r>/:id` | `200` with the merged record, `404` for an unknown id. |
| `DELETE /<r>/:id` | `204`, `404` for an unknown id. |

Errors are `{ message, errors }` with `404` or `422`. `resources[name].schema` (Standard Schema) validates every written record, `resources[name].unique` keeps fields unique, and numeric or string ids are kept as given. `rest({ collection })` shapes the list body, for example a hydra envelope. `rest({ defaultPerPage })` sets the page size when only `page` is given (default 25).

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

To imitate another backend (PocketBase, Strapi, Hydra), write that engine in your own code from this contract. `rest` is a good starting point: its source is the model, and `collection` already changes the list envelope.

Any engine can be checked with the shared contract test of the repository (`test/engine-contract.ts`): matching, state and `reset`, unknown resource, `mock: false`, outside `baseUrl`, `failures`, `enabled: false`.
