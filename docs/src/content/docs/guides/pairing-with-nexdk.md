---
title: Pairing with nexdk
description: Use shamock next to a nexdk SDK for offline or test data.
---

shamock has no dependency on [nexdk](https://github.com/techmefr/nexdk). Nothing in nexdk calls shamock for you: mocking is an application choice.

Any nexdk resource declared with `defineResource` has a `schema`, so it already satisfies `MockableResource`.

## Validate fixtures

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

## Fake the network

The mock answers the lomkit REST shape: `POST /<resource>/search`, `POST /<resource>/mutate` and `DELETE /<resource>`. Install it before the SDK sends requests, with the SDK's absolute base URL:

```ts
import { installMock } from 'shamock'

const mock = await installMock({
  baseUrl: 'https://api.example.com',
  seed: { products: [{ id: 1, name: 'Demo product', price: 9.99 }] },
  resources: { products: product },
})

mock.restore()
```

While installed, requests under `baseUrl` never reach the network. See the [Mock API](/shamock/guides/mocking/) for routes and limits.
