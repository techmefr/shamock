# AGENT.md — chaff (mock engine)

## Role
Schema-driven mock / fallback. Exposes `parseMock`, `parseMockList` (async —
validate `T | T[]` against any Standard Schema validator) and `setupMirageMock`.
Accepts a minimal `MockableResource` (`{ schema }`) — deliberately NOT the full
nexdk `Resource`.

## Hard rule — independent of nexdk and beepr
- **Never import `nexdk` or `beepr`.** chaff lives in its own repo now, but the
  rule predates that: it only knows a `{ schema }` shape.
- `MockableResource.schema` is typed against `StandardSchemaV1`
  (`src/standard-schema.ts`, a local copy of the same tiny contract nexdk keeps
  in its own file — never add `zod` as a dependency to type it). `miragejs` is
  an optional peer (guard its use). No other dependency.
- `parseMock`/`parseMockList` are `async` because Standard Schema's `validate()`
  may return a `Promise` — no driver calls these automatically anymore
  (mocking is an application-level choice, not something nexdk's core or any
  driver short-circuits into), so any caller must `await` them itself.

## Build/test
`pnpm build` · `pnpm test`. No workspace, no sibling packages — this repo only
ever builds/tests itself.
