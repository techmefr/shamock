# AGENT.md — chaff (mock engine)

## Role
Schema-driven mock / fallback. Exposes `parseMock`, `parseMockList` (async —
validate `T | T[]` against any Standard Schema validator) and `setupMirageMock`.
Accepts a minimal `MockableResource` (`{ schema }`) — deliberately NOT the full
nexdk `Resource`.

## Hard rule — independent of the rest of the repo
- **Never import `nexdk` or `beepr`.** chaff only knows a `{ schema }` shape.
- `MockableResource.schema` is typed against `StandardSchemaV1`
  (`src/standard-schema.ts`, a local copy of the same tiny contract nexdk keeps
  in its own file — never add `zod` as a dependency to type it). `miragejs` is
  an optional peer (guard its use). No other dependency.
- `parseMock`/`parseMockList` are `async` because Standard Schema's `validate()`
  may return a `Promise` — callers (e.g. lomkit's mock short-circuit) must
  `await` them.

## Build/test
`pnpm --filter chaff build` · `pnpm --filter chaff test` (passes with nexdk/beepr
absent). Usable on its own for fixture validation in tests.
