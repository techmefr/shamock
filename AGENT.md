# AGENT.md — chaff (mock engine)

## Role
Schema-driven mock / fallback. Exposes `parseMock`, `parseMockList` (validate
`T | T[]` against a Zod schema) and `setupMirageMock`. Accepts a minimal
`MockableResource` (`{ schema }`) — deliberately NOT the full nexdk `Resource`.

## Hard rule — independent of the rest of the repo
- **Never import `nexdk` or `beepr`.** chaff only knows a `{ schema }` shape.
- `zod` is a `peerDependency`; `miragejs` is an optional peer (guard its use).
- No other runtime dependency.

## Build/test
`pnpm --filter chaff build` · `pnpm --filter chaff test` (passes with nexdk/beepr
absent). Usable on its own for fixture validation in tests.
