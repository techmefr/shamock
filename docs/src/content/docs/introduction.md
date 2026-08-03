---
title: Introduction
description: Why chaff exists and what problem it solves.
---

Test fixtures and offline mock data drift from the real shape over time — a field gets renamed in the schema, the fixture doesn't, and nothing catches it until a real request breaks. `chaff` closes that gap: it validates any mock value against the exact same [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType…) your app already uses, so a stale fixture fails loudly instead of silently.

`chaff` only needs a minimal shape to do this — a `{ schema }` object, not a specific SDK's resource type. It has no dependency on any SDK, including [`nexdk`](https://github.com/techmefr/nexdk).

## Install

```bash
npm install chaff
# plus the validator of your choice, e.g. zod
```

## A minimal example

```ts
import { parseMock } from 'chaff'
import { z } from 'zod'

const userSchema = z.object({ id: z.number(), name: z.string() })

const user = await parseMock({ schema: userSchema }, { id: 1, name: 'Alice' })
// throws if the mock doesn't match userSchema — never a silently wrong fixture
```

From here:

- [Pairing with nexdk](/chaff/guides/pairing-with-nexdk/) — using `chaff` alongside an `nexdk` SDK for offline/mock data.
- [chaff API](/chaff/reference/chaff/) — every runtime export.
