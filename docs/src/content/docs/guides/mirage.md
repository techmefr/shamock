---
title: MirageJS mock server
description: Start the optional in-browser mock server from seed data.
---

Install the optional MirageJS peer when you need network interception:

```bash
pnpm add miragejs
```

```ts
import { setupMirageMock } from 'shamock'
import { z } from 'zod'

const product = {
  schema: z.object({ id: z.number(), name: z.string() }),
}
const products = [{ id: 1, name: 'Sample' }]

await setupMirageMock({
  baseUrl: '/api',
  seed: { products },
  resources: { products: product },
  timing: 150,
})
```

The optional `resources` map validates seed data against its matching schemas before the server starts. Without a matching schema, that resource's seed is loaded unchanged. Set `timing` to control the response delay.

| Endpoint | Purpose |
|---|---|
| `POST /api/products/search` | Return seeded records in a Lomkit-style data envelope. |
| `POST /api/products/mutate` | Insert or update records from the mutation payload. |
| `DELETE /api/products` | Delete a record identified by the request body. |

MirageJS is imported dynamically when the setup helper is called. Keep server setup in your application's development or demo initialization.

See the [API reference](/shamock/reference/shamock/) for the route payloads and configuration.
