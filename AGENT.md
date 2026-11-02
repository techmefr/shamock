# AGENT.md — shamock

## Role
shamock intercepts the real `fetch` call and answers with the JSON it is given, instead of reaching the backend. The seed/search/mutate engine is a convenience layer on top, driven by the data. Zero dependencies.
- `parseMock`, `parseMockList`, `MockValidationError`: async validation of `T | T[]` against a Standard Schema. They accept a minimal `MockableResource` (`{ schema }`), never a full nexdk `Resource`.
- `createMock(config)` returns `{ handle, fetch, install }`. `installMock(config)` installs it on `globalThis.fetch` and returns the mock plus `restore()`.

## Layout
- `src/parse-mock.ts` validation and `MockValidationError`.
- `src/mock.ts` `createMock`, `installMock`, config and routing.
- `src/install.ts` `fetch` installation, nested installs restorable in any order.
- `src/store.ts` in-memory rows, ids, transactions (atomic writes).
- `src/search.ts` filters (SQL precedence), sorts, selects, includes, pagination, limits, bounds.
- `src/failures.ts` fault injection rules and their call counters.
- `src/dates.ts` conversion of dates to `Y-m-d H:i:s`.
- `src/request-body.ts` body reading, `mutate` and delete payloads, bounds.
- `src/http-error.ts`, `src/record.ts`, `src/standard-schema.ts` helpers.

## Rules
- Never import `nexdk` or `beepr`. shamock only knows a `{ schema }` shape.
- No runtime dependency. `StandardSchemaV1` is a local copy of the contract; never add `zod` to type it.
- Routes under an absolute `baseUrl`: `POST /<r>/search`, `POST /<r>/mutate`, `DELETE /<r>`. `mutate` is create and update only (422 otherwise) and answers `{ created, updated }` (ids), like lomkit. `search` answers the paginator at the root (`data`, `current_page`, `last_page`, `per_page`, `total`, `from`, `to`, `meta: []`), 50 rows per page by default. Writes are atomic.
- The default behavior is simple and data-driven, not a backend imitation: `and` before `or` (SQL precedence), any positive `limit`, errors keyed by field name, deleting an unknown id succeeds, `in []` matches nothing, dates kept as given, null last, Unicode case folding, groups up to 10 levels, unknown keys and undeclared `includes` relations ignored, `text` is a plain substring.
- `profile: 'lomkit'` is an opt-in compatibility convenience (flag `lomkit` in `SearchOptions` and `createStore`). It restricts `limit` to `[10, 25, 50]`, prefixes error keys `mutate.<index>.attributes.<field>`, answers 422 for unknown or missing delete ids and `in []`, stores dates as `Y-m-d H:i:s`, sorts null first ascending, folds ASCII only, reads a backslash literally, allows one group level, refuses unknown and unsupported keys (`aggregates`, `scopes`, `instructions`, `gates`) and unknown relations, refuses `like` with `text`, and matches `text` as a `%value%` pattern. Do not push it further: it stays minimal and opt-in. The options `limits`, `maxNestingDepth`, `likeEscape`, `unique`, `searchable` and `failures` work without it.
- Fault injection is the `failures` config (`method`, `path`, `after`, `times`, `status`, `network`, `delay`). Keep it that small.
- `timing` defaults to 300 ms because a test asserts it. Do not change the default.
- Resource options live in `MockResource` (`schema`, `unique`, `limits`, `searchable`, `relations`). A new option needs README, docs and tests.
- Errors are `{ message, errors }` with 404, 413 or 422. Keep the limits: body 1 MB in bytes, 1000 mutations or ids, 100 filters, like pattern 256 characters, 1000 values per array, 10 000 rows per resource, nesting 10 (`maxNestingDepth`, default 10, 1 with the lomkit profile).
- Requests outside `baseUrl` go to the previous `fetch`. XHR is not intercepted.
- Docs live in `docs/` (Starlight). Keep README, docs and this file in sync with `src/`.
- No comments in code or code blocks.

## Build and test
`pnpm build` · `pnpm test` · `pnpm typecheck`. Docs: `pnpm --dir docs build`. Node.js >= 22. No workspace, no sibling packages.
