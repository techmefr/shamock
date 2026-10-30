---
title: Installation & quickstart
description: Install shamock and validate fixtures against the real schema.
---

Install shamock and a Standard Schema validator:

```bash
pnpm add shamock zod
```

Describe the data once and validate your stand-in values against that shape:

```ts
import { parseMock, parseMockList } from 'shamock'
import { z } from 'zod'

const product = {
  schema: z.object({ id: z.number(), name: z.string() }),
}

const item = await parseMock(product, { id: 1, name: 'Sample' })
const items = await parseMockList(product, [{ id: 1, name: 'Sample' }])
```

The resource only needs a `schema` property. No SDK, framework or network server is required. Use Zod, Valibot, ArkType or another validator implementing Standard Schema.

Both helpers return promises. Continue with [fixtures and validation](/shamock/guides/fixtures/), [offline fallback](/shamock/guides/offline-fallback/) or the optional [MirageJS server](/shamock/guides/mirage/).
