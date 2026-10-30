---
title: Offline fallback
description: Choose validated fixture data at the application boundary.
---

shamock does not intercept neXdk calls or automatically replace failed requests. Select mock data explicitly in your application.

```ts
import { parseMockList } from 'shamock'
import { z } from 'zod'

const product = {
  schema: z.object({ id: z.number(), name: z.string() }),
}
const fixtures = [{ id: 1, name: 'Offline sample' }]

async function loadProducts(useMockData: boolean) {
  if (useMockData) return parseMockList(product, fixtures)

  const response = await fetch('/api/products')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

const products = await loadProducts(true)
```

The example deliberately selects a fixture mode. Your application can instead choose it for known network failures, while preserving authentication, authorization and validation errors.

The real endpoint's response shape is your application's contract. Validate and normalize it separately when necessary.

For neXdk resources, the existing `schema` already satisfies shamock's minimal contract. See [pairing with neXdk](/shamock/guides/pairing-with-nexdk/).
