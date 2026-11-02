# AGENT.md — shamock

## Role
shamock intercepts the real `fetch` call and answers with the JSON it is given, instead of reaching the backend. The seed/search/mutate engine is a convenience layer on top, driven by the data. Zero dependencies.
- `parseMock`, `parseMockList`, `MockValidationError`: async validation of `T | T[]` against a Standard Schema. They accept a minimal `MockableResource` (`{ schema }`), never a full nexdk `Resource`.
- `createMock(config)` returns `{ handle, fetch, install }`. `installMock(config)` installs it on `globalThis.fetch` and returns the mock plus `restore()`.

- `isMockEnabled(env?, variable = 'SHAMOCK')` reads a switch variable (`1`, `true`, `on`, `yes`, any case). It lives in `src/enabled.ts`, exported from the index and from `shamock/enabled` so a bundle can import the switch without the core.
- `MockConfig.enabled: false` disables everything: `install()` is a no-op with a no-op `restore`, `mock.fetch` and `handle` call the real `fetch` (`config.fetch` or the captured `globalThis.fetch`). `resources[name].mock: false` sends that resource to the real `fetch` (no seed entry needed). `mock.reset()` rebuilds the stores from the seed and the failure counters.

## Layout
- `src/parse-mock.ts` validation and `MockValidationError`.
- `src/mock.ts` `createMock`, `installMock`, config and routing.
- `src/enabled.ts` `isMockEnabled`, separate build entry.
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
- Routes under an absolute `baseUrl`: `POST /<r>/search`, `POST /<r>/mutate`, `DELETE /<r>`. `mutate` is create and update only (422 otherwise) and answers `{ created, updated }` (ids). This is a documented request protocol, not an imitation of a backend. `search` answers a paginated envelope at the root (`data`, `current_page`, `last_page`, `per_page`, `total`, `from`, `to`, `meta: []`), 50 rows per page by default. Writes are atomic.
- The default behavior is simple and data-driven, not a backend imitation: `and` before `or` (SQL precedence), any positive `limit`, errors keyed by field name, deleting an unknown id succeeds, `in []` matches nothing, dates kept as given, null last, Unicode case folding, groups up to 10 levels, unknown keys and undeclared `includes` relations ignored, `text` is a plain substring.
- `profile: 'lomkit'` is an opt-in compatibility convenience (flag `lomkit` in `SearchOptions` and `createStore`). It restricts `limit` to `[10, 25, 50]`, prefixes error keys `mutate.<index>.attributes.<field>`, answers 422 for unknown or missing delete ids and `in []`, stores dates as `Y-m-d H:i:s`, sorts null first ascending, folds ASCII only, reads a backslash literally, allows one group level, refuses unknown keys, `aggregates`, `scopes`, `instructions` and `gates` that are not declared (or name something unknown) and unknown relations, refuses `like` with `text`, and matches `text` as a `%value%` pattern. Do not push it further: it stays minimal and opt-in. The options `limits`, `maxNestingDepth`, `likeEscape`, `unique`, `searchable` and `failures` work without it.
- Fault injection is the `failures` config (`method`, `path`, `after`, `times`, `status`, `network`, `delay`). Keep it that small.
- `timing` defaults to 300 ms because a test asserts it. Do not change the default.
- `aggregates` (count, exists, sum, avg, min, max over `links`, alias `<relation_snake>_<type>[_<field>]`), `scopes` and `instructions` (functions `(rows, params|fields) => rows`) and `gates` (functions `(row) => boolean`, answered under `gates` with the `authorized_to_*` names) are declared per resource and read at the root of `search` only. Without a declaration they are ignored, or `422` under the lomkit profile. A `.keyword` suffix on a filter or sort field is stripped.
- Resource options live in `MockResource` (`schema`, `unique`, `limits`, `searchable`, `links`, `scopes`, `instructions`, `gates`, `mock`). A new option needs README, docs and tests.
- Errors are `{ message, errors }` with 404, 413 or 422. Keep the limits: body 1 MB in bytes, 1000 mutations or ids, 100 filters, like pattern 256 characters, 1000 values per array, 10 000 rows per resource, nesting 10 (`maxNestingDepth`, default 10, 1 with the lomkit profile).
- Requests outside `baseUrl` go to the previous `fetch`. XHR is not intercepted.
- Same calling code with the mock and with the real backend: the switch is the variable (`enabled`) or `resources[name].mock`, never a change in the callers. State is in memory and restarts from the seed, no persistence. Guard the install with a dynamic `import('shamock')` behind a compile-time constant to keep it out of production bundles.
- Docs live in `docs/` (Starlight). Keep README, docs and this file in sync with `src/`.
- No comments in code or code blocks.

## Build and test
`pnpm build` · `pnpm test` · `pnpm typecheck`. Docs: `pnpm --dir docs build`. Node.js >= 22. No workspace, no sibling packages.
