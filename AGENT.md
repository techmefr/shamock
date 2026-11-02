# AGENT.md — shamock

## Role
Schema-driven mock engine, zero dependencies.
- `parseMock`, `parseMockList`, `MockValidationError`: async validation of `T | T[]` against a Standard Schema. They accept a minimal `MockableResource` (`{ schema }`), never a full nexdk `Resource`.
- `createMock(config)` returns `{ handle, fetch, install }`. `installMock(config)` installs it on `globalThis.fetch` and returns the mock plus `restore()`.

## Layout
- `src/parse-mock.ts` validation and `MockValidationError`.
- `src/mock.ts` `createMock`, `installMock`, config and routing.
- `src/install.ts` `fetch` installation, nested installs restorable in any order.
- `src/store.ts` in-memory rows, ids, transactions (atomic writes).
- `src/search.ts` filters, sorts, pagination, bounds.
- `src/request-body.ts` body reading, `mutate` and delete payloads, bounds.
- `src/http-error.ts`, `src/record.ts`, `src/standard-schema.ts` helpers.

## Rules
- Never import `nexdk` or `beepr`. shamock only knows a `{ schema }` shape.
- No runtime dependency. `StandardSchemaV1` is a local copy of the contract; never add `zod` to type it.
- Routes under an absolute `baseUrl`: `POST /<r>/search`, `POST /<r>/mutate`, `DELETE /<r>`. `mutate` is create and update only (422 otherwise) and answers `{ created, updated }` (ids), like lomkit. `search` answers the paginator at the root (`data`, `current_page`, `last_page`, `per_page`, `total`, `from`, `to`, `meta: []`), 50 rows per page by default. Writes are atomic.
- Failure injection is not a config option: callers wrap `mock.fetch`.
- Errors are `{ message, errors }` with 404, 413 or 422. Keep the limits: body 1 MB in bytes, 1000 mutations or ids, 100 filters, like pattern 256 characters, 1000 values per array, 10 000 rows per resource, nesting 10.
- Requests outside `baseUrl` go to the previous `fetch`. XHR is not intercepted.
- Docs live in `docs/` (Starlight). Keep README, docs and this file in sync with `src/`.
- No comments in code or code blocks.

## Build and test
`pnpm build` · `pnpm test` · `pnpm typecheck`. Docs: `pnpm --dir docs build`. Node.js >= 22. No workspace, no sibling packages.
