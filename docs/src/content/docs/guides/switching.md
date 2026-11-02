---
title: Mock or real backend
description: Switch shamock with a variable and mock only the resources that are not ready.
---

The code that calls your API is the same with the mock and with the real backend. A variable switches the mock on or off, and `resources[name].mock` leaves some resources to the real network. The state lives in memory and starts again from the seed on every reload.

## Activate with a variable

`isMockEnabled(env?, variable = 'SHAMOCK')` reads a variable. `1`, `true`, `on` and `yes` (any case) enable the mock. An absent variable or any other value disables it. Without `env`, it reads `globalThis.process?.env` when it exists.

```ts
import { isMockEnabled } from 'shamock'

isMockEnabled({ SHAMOCK: 'true' })
isMockEnabled({ VITE_SHAMOCK: '1' }, 'VITE_SHAMOCK')
```

`MockConfig.enabled` is the same switch inside the config. When the mock is disabled, `install()` does nothing and returns a no-op `restore`, `mock.fetch` and `mock.handle` call the real `fetch` (the `fetch` option, or the `globalThis.fetch` captured by `createMock`), and nothing is intercepted.

```ts
const mock = await installMock({
  baseUrl: 'https://api.example.com',
  seed,
  enabled: isMockEnabled({ SHAMOCK: import.meta.env.VITE_SHAMOCK }),
})
```

| Tool | Pass |
|---|---|
| Node, Bun | nothing, `process.env.SHAMOCK` is read |
| Vite, SvelteKit, Solid, Astro | `isMockEnabled({ SHAMOCK: import.meta.env.VITE_SHAMOCK })` (Astro: `PUBLIC_SHAMOCK`) |
| Nuxt | `isMockEnabled({ SHAMOCK: useRuntimeConfig().public.shamock })` |
| Next.js | `isMockEnabled({ SHAMOCK: process.env.NEXT_PUBLIC_SHAMOCK })` |
| Deno | `isMockEnabled({ SHAMOCK: Deno.env.get('SHAMOCK') })` |
| Cloudflare Workers | `isMockEnabled({ SHAMOCK: env.SHAMOCK })` with the binding |

## Keep shamock out of the production bundle

Import the mock dynamically behind the switch.

```ts
import { isMockEnabled } from 'shamock/enabled'

if (isMockEnabled({ SHAMOCK: import.meta.env.VITE_SHAMOCK })) {
  const { installMock } = await import('shamock')
  await installMock({ baseUrl: 'https://api.example.com', seed })
}
```

`shamock/enabled` holds only `isMockEnabled` (about 400 bytes). The `shamock` chunk is fetched only when the switch is on, so a production build with the variable off never loads it.

A bundler can remove the chunk altogether only when the condition is a compile-time constant. Put one in front, such as `import.meta.env.DEV`, or compare the variable to a literal:

```ts
if (import.meta.env.DEV && isMockEnabled({ SHAMOCK: import.meta.env.VITE_SHAMOCK })) {
  const { installMock } = await import('shamock')
  await installMock({ baseUrl: 'https://api.example.com', seed })
}
```

Measured with esbuild (minified, splitting), shamock is one chunk of about 18 kB, 7 kB gzipped. With `DEV` replaced by `false`, or `VITE_SHAMOCK === 'true'` replaced by a false literal, that chunk is not emitted. With `isMockEnabled` alone it is emitted but never loaded when the variable is off.

## Mock only what is not ready

`resources[name].mock` defaults to `true`. A resource set to `false` goes to the real `fetch`, the others are answered from the seed, in the same client. A resource set to `false` needs no seed entry.

```ts
await installMock({
  baseUrl: 'https://api.example.com',
  seed: { orders: [{ id: 1, total: 20 }] },
  resources: { users: { mock: false } },
})

await fetch('https://api.example.com/users/search', { method: 'POST', body: '{}' })
await fetch('https://api.example.com/orders/search', { method: 'POST', body: '{}' })
```

`users` reaches the real backend, `orders` is answered by the mock. When the backend is ready, set `orders` to `mock: false`, or switch the mock off: the calling code does not change. The switch works per resource, not per path.

## Reset between tests

`mock.reset()` puts every resource back to its seed and rewinds the `failures` counters. It is also on the value returned by `installMock`. A new `createMock` per test works too.

```ts
import { beforeEach, expect, it } from 'vitest'
import { createMock } from 'shamock'

const mock = await createMock({ baseUrl: 'https://api.example.com', timing: 0, seed })

beforeEach(() => mock.reset())

it('starts from the seed', async () => {
  const response = await mock.fetch('https://api.example.com/todos/search', { method: 'POST', body: '{}' })
  expect((await response.json()).data).toHaveLength(seed.todos.length)
})
```
