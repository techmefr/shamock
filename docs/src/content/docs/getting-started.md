---
title: Installation & quickstart
description: Install shamock, validate fixtures and mock a REST API.
---

Requires Node.js 22 or later. Install shamock and a Standard Schema validator:

```bash
pnpm add shamock zod
```

## Validate fixtures

```ts
import { parseMock, parseMockList } from 'shamock'
import { z } from 'zod'

const product = {
  schema: z.object({ id: z.number(), name: z.string() }),
}

const item = await parseMock(product, { id: 1, name: 'Sample' })
const items = await parseMockList(product, [{ id: 1, name: 'Sample' }])
```

The resource only needs a `schema` property. Both helpers return promises.

## Mock the network

```ts
import { installMock } from 'shamock'

const mock = await installMock({
  baseUrl: 'https://api.example.com',
  seed: { products: [{ id: 1, name: 'Sample' }] },
  timing: 0,
})

const response = await fetch('https://api.example.com/products/search', {
  method: 'POST',
  body: '{}',
})
const { data } = await response.json()

mock.restore()
```

Next: [fixtures and validation](/shamock/guides/fixtures/), [offline fallback](/shamock/guides/offline-fallback/) and the [Mock API](/shamock/guides/mocking/).
