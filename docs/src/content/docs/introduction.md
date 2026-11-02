---
title: Introduction
description: Why shamock exists and what it does.
---

Test fixtures and offline mock data drift from the real shape over time. A field is renamed in the schema, the fixture is not, and nothing fails until a real request breaks.

shamock closes that gap with two tools:

- **Validation.** Check any mock value against the same [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType...) your app uses. A stale fixture fails loudly.
- **Mock API.** Serve seed data from an in-process REST API that answers `fetch` calls. No server needed.

shamock needs only a `{ schema }` object, not an SDK resource type. It has zero dependencies and requires Node.js 22 or later.

## Install

```bash
pnpm add shamock
```

## A minimal example

```ts
import { parseMock } from 'shamock'
import { z } from 'zod'

const user = { schema: z.object({ id: z.number(), name: z.string() }) }

await parseMock(user, { id: 1, name: 'Alice' })
```

It throws `MockValidationError` when the value does not match the schema.

From here:

- [Mock API](/shamock/guides/mocking/): serve seed data over `fetch`.
- [Pairing with nexdk](/shamock/guides/pairing-with-nexdk/): use shamock next to a nexdk SDK.
- [shamock API](/shamock/reference/shamock/): every runtime export.
