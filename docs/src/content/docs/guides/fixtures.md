---
title: Fixtures & validation
description: Keep mock values aligned with your application's Standard Schema validator.
---

## A mock has the real shape

```ts
import { parseMockList } from 'shamock'
import { z } from 'zod'

const product = {
  schema: z.object({ id: z.number(), name: z.string() }),
}
const fixtures = [{ id: 1, name: 'Sample' }]
const records = await parseMockList(product, fixtures)
```

Changing a required field in the schema makes stale fixtures fail validation. shamock validates supplied data; it does not generate realistic fixture values from a schema.

## Single values and lists

`parseMock` validates one value. `parseMockList` validates every item of an array, or wraps one validated value in an array. List items are validated concurrently.

## Validation errors

```ts
try {
  await parseMockList(product, [{ id: 'wrong type', name: 'Sample' }])
} catch (error) {
  if (error instanceof Error) console.error(error.message)
}
```

Validation issues are joined into one error message with `; ` separators. Async validators are supported, so always await parsing.

The current public return types are `Promise<unknown>` and `Promise<unknown[]>`. Runtime validation follows your schema, while the helpers do not expose its inferred output type yet.
