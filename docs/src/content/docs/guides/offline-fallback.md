---
title: Offline fallback
description: Choose validated fixture data at the application boundary.
---

shamock does not replace failed requests by itself. Select mock data explicitly in your application.

```ts
import { parseMockList } from 'shamock'
import { z } from 'zod'

const product = {
  schema: z.object({ id: z.number(), name: z.string() }),
}
const fixtures = [{ id: 1, name: 'Offline sample' }]

async function loadProducts(useMockData: boolean) {
  if (useMockData) return parseMockList(product, fixtures)

  const response = await fetch('https://api.example.com/products')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

const products = await loadProducts(true)
```

Your application can pick the fixture mode for known network failures, while keeping authentication, authorization and validation errors.

To keep the same code path as production, install the [Mock API](/shamock/guides/mocking/) instead: your `fetch` calls stay unchanged and are answered from seed data.

For nexdk resources, see [pairing with nexdk](/shamock/guides/pairing-with-nexdk/).
