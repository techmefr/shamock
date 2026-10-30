---
title: Pairing with nexdk
description: Using shamock alongside an nexdk SDK for offline or test fixture data.
---

`shamock` has **zero dependency on `nexdk`** — no driver or core function calls into it automatically. Mocking is an application-level choice, not something `nexdk` short-circuits into for you. If you want mock data, you validate and use it yourself, in your own code:

```ts
import { parseMockList } from 'shamock'
import { sdk } from './sdk'
import { product } from './resources'

async function getProducts(useMock = false) {
  if (useMock) {
    return parseMockList(product, [{ id: 1, name: 'Demo product', price: 9.99 }])
  }
  return sdk.lomkit.products.get({})
}
```

Because `parseMock`/`parseMockList` only need a `{ schema }` shape, any `nexdk` resource declared with `defineResource` already satisfies `MockableResource` — no adapter needed.

## Full network interception with MirageJS

For cases where you want to fake the network itself rather than branch in application code — e.g. a playground app with no real backend — `setupMirageMock` spins up a MirageJS server that answers the same lomkit REST shape (`POST /:resource/search`, `POST /:resource/mutate`, `DELETE /:resource`) a real `@nexdk/driver-lomkit` backend would, so the SDK doesn't need to know it isn't talking to a real server:

```ts
import { setupMirageMock } from 'shamock'

await setupMirageMock({
  baseUrl: 'https://api.example.com',
  seed: { products: [{ id: 1, name: 'Demo product', price: 9.99 }] },
})

// sdk.lomkit.products.get({}) now hits the Mirage server instead of the network
```

`miragejs` is an optional peer dependency — install it yourself if you use `setupMirageMock`.
