---
title: MirageJS mock server
description: Start the optional in-browser mock server from seed data.
---

Install the optional MirageJS peer when you need network interception:

```bash
pnpm add miragejs
```

```ts
import { parseMockList, setupMirageMock } from 'shamock'
import { z } from 'zod'

const product = {
  schema: z.object({ id: z.number(), name: z.string() }),
}
const products = [{ id: 1, name: 'Sample' }]

await parseMockList(product, products)
await setupMirageMock({
  baseUrl: '/api',
  seed: { products },
})
```

The seed is validated explicitly before the server starts. `setupMirageMock` does not receive schemas or validate seed data itself.

| Endpoint | Purpose |
|---|---|
| `POST /api/products/search` | Return seeded records in a Lomkit-style data envelope. |
| `POST /api/products/mutate` | Insert or update records from the mutation payload. |
| `DELETE /api/products` | Delete a record identified by the request body. |

MirageJS is imported dynamically when the setup helper is called. Keep server setup in your application's development or demo initialization.

See the [API reference](/shamock/reference/shamock/) for the route payloads and configuration.
