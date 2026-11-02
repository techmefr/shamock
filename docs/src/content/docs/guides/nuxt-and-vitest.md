---
title: Nuxt, $fetch and Vitest
description: Intercept ofetch and $fetch, mock a Nuxt app on the client, and replace vi.mock of resources in composable tests.
---

shamock replaces `globalThis.fetch`. `$fetch` is `ofetch`, so it is intercepted as long as it reaches `globalThis.fetch` after the mock is installed. Two patterns cover every case.

## Two ways to reach the mock

`ofetch` reads `globalThis.fetch` on every call, so an install made after the client was created still works.

```ts
import { ofetch } from 'ofetch'
import { installMock } from 'shamock'

const api = ofetch.create({ baseURL: 'https://api.example.com' })
const mock = await installMock({ baseUrl: 'https://api.example.com', seed })

await api('/users/search', { method: 'POST', body: {} })
```

`ofetch.create(defaults, { fetch })` takes the `fetch` as its second argument. A client created with `{ fetch: globalThis.fetch }` keeps the real function it captured and is never intercepted by a later install. Give it the mock directly, or a function that resolves `globalThis.fetch` at call time:

```ts
import { createMock } from 'shamock'

const mock = await createMock({ baseUrl: 'https://api.example.com', seed })

const direct = ofetch.create({ baseURL: 'https://api.example.com' }, { fetch: mock.fetch })
const late = ofetch.create({ baseURL: 'https://api.example.com' }, { fetch: (...args) => globalThis.fetch(...args) })
```

`mock.fetch` needs no install and forwards foreign URLs to the `fetch` captured by `createMock`. Both patterns are covered by tests.

## Nuxt plugin

Install the mock in the browser only. On the server, `globalThis.fetch` is shared by every request of the process, so replacing it would change what all visitors get.

```ts
export default defineNuxtPlugin(async () => {
  if (!import.meta.client) return
  const { isMockEnabled } = await import('shamock/enabled')
  if (!isMockEnabled({ SHAMOCK: import.meta.env.VITE_SHAMOCK })) return
  const { installMock } = await import('shamock')
  const [users, orders] = await Promise.all([
    import('~/mocks/users.json'),
    import('~/mocks/orders.json'),
  ])
  await installMock({
    baseUrl: useRuntimeConfig().public.apiBase,
    seed: { users: users.default, orders: orders.default },
    timing: 150,
  })
})
```

Save it as `plugins/shamock.client.ts`. The `.client` suffix and the `import.meta.client` guard keep the server untouched, and the dynamic imports keep shamock out of a build where the variable is off (see [Mock or real backend](/shamock/guides/switching/)). Use a `VITE_` or `NUXT_PUBLIC_` variable so it reaches the browser.

To mock server-side rendering too, do not install: build a client from `mock.fetch` and use it for the calls made during SSR.

```ts
import { ofetch } from 'ofetch'

export default defineNuxtPlugin(async () => {
  if (!import.meta.server) return
  const { isMockEnabled } = await import('shamock/enabled')
  if (!isMockEnabled({ SHAMOCK: process.env.SHAMOCK })) return
  const { createMock } = await import('shamock')
  const users = await import('~/mocks/users.json')
  const mock = await createMock({ baseUrl: useRuntimeConfig().public.apiBase, seed: { users: users.default }, timing: 0 })
  return { provide: { api: ofetch.create({ baseURL: useRuntimeConfig().public.apiBase }, { fetch: mock.fetch }) } }
})
```

The server state and the browser state are two separate in-memory copies of the seed, so a record created in the browser is not in the server copy.

## Vitest

Install the mock in a setup file, and reset it between tests. This replaces a `vi.mock` of each resource module: the composable, the store and `$fetch` run as they do in production.

```ts
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'
import { ofetch } from 'ofetch'
import { installMock } from 'shamock'
import type { InstalledMock } from 'shamock'
import users from './mocks/users.json'

let mock: InstalledMock

beforeAll(async () => {
  vi.stubGlobal('$fetch', ofetch)
  mock = await installMock({ baseUrl: 'http://localhost:3000/api', seed: { users }, timing: 0 })
})

beforeEach(() => mock.reset())

afterAll(() => {
  mock.restore()
  vi.unstubAllGlobals()
})
```

Register it with `test.setupFiles` in `vitest.config.ts`. Under `@nuxt/test-utils` the `$fetch` global already exists, so drop the `vi.stubGlobal` line. A test then calls the composable and asserts on the result, and `failures` simulates an outage:

```ts
it('shows an error when the API is down', async () => {
  const down = await createMock({
    baseUrl: 'http://localhost:3000/api',
    seed: { users },
    timing: 0,
    failures: [{ method: 'POST', path: '/users/search', status: 503 }],
  })
  const api = ofetch.create({ baseURL: 'http://localhost:3000/api' }, { fetch: down.fetch })
  await expect(api('/users/search', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 503 })
})
```
