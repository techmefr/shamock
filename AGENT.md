# AGENT.md — shamock

## Role
shamock = interception of the real `fetch` that replays rather than interprets: JSON per slug (`routes`), CRUD by convention (`shamock/rest`), record and replay (`record`, `mock.recorded()`), named scenarios. The lomkit engine is an option. The core knows no protocol (the word "lomkit" must never appear in the `shamock/core` dist, check it after a build). An engine implements `Engine` (`match`, `handle`, optional `normalize`, `validate`) and lives behind its own export. Zero dependencies.
- Entries: `shamock/core` (no default engine, optional `engine`, `routes` for static JSON per route, usable with no engine at all), `shamock/rest` (generic REST engine), `shamock/lomkit` (search/mutate/delete engine and `profile: 'lomkit'`), `shamock` (core plus lomkit, which stays the default when `engine` is omitted, to keep existing code working), `shamock/enabled`. Recommended: `shamock/core` with an explicit `engine`. Do not add one entry per backend: document how to write an engine instead.
- Sizes (gzip, esbuild bundle not minified): core 6.0 kB, core + rest 6.9 kB, core + lomkit 12.8 kB, main 12.8 kB. Re-measure after a change to an engine or the core.
- `parseMock`, `parseMockList`, `MockValidationError`: async validation of `T | T[]` against a Standard Schema. They accept a minimal `MockableResource` (`{ schema }`), never a full nexdk `Resource`.
- `createMock(config)` returns `{ handle, fetch, install, reset, recorded }`. `installMock(config)` installs it on `globalThis.fetch` and returns the mock plus `restore()`.

- `isMockEnabled(env?, variable = 'SHAMOCK')` reads a switch variable (`1`, `true`, `on`, `yes`, any case). It lives in `src/enabled.ts`, exported from the index and from `shamock/enabled` so a bundle can import the switch without the core.
- `MockConfig.enabled: false` disables everything: `install()` is a no-op with a no-op `restore`, `mock.fetch` and `handle` call the real `fetch` (`config.fetch` or the captured `globalThis.fetch`). `resources[name].mock: false` sends that resource to the real `fetch` (no seed entry needed). `mock.reset()` rebuilds the stores from the seed and the failure counters.

## Layout
Core (no protocol):
- `src/core.ts` entry `shamock/core`. `src/create-mock.ts` `createMock`, `installMock`, `unhandled`, routing to the static routes then the engine.
- `src/route-table.ts` route keys (`METHOD /path`, `/path`, `METHOD /path #hash`), `bodyKey` (FNV-1a 32 bits hex of the JSON with sorted keys), `{ $status, $body }` values. `src/recorder.ts` `record` mode. `src/scenarios.ts` `scenarios` merge (routes and seed by key, failures replaced, unknown name throws).
- `src/engine.ts` the `Engine` contract and its types.
- `src/parse-mock.ts` validation and `MockValidationError`. `src/validation.ts` record validation helpers.
- `src/enabled.ts` `isMockEnabled`, separate build entry.
- `src/install.ts` `fetch` installation, nested installs restorable in any order.
- `src/store.ts` in-memory rows, ids, transactions (atomic writes).
- `src/failures.ts` fault injection rules and their call counters.
- `src/body.ts` bounded JSON body reading. `src/response.ts`, `src/http-error.ts`, `src/record.ts`, `src/standard-schema.ts` helpers.

Engines:
- `src/lomkit.ts` entry `shamock/lomkit`. `src/lomkit/engine.ts` routes, mutate, delete, options. `src/lomkit/search.ts` filters (SQL precedence), sorts, selects, includes, pagination, limits, bounds. `src/lomkit/dates.ts`, `src/lomkit/request-body.ts`.
- `src/rest.ts` entry `shamock/rest`: CRUD by convention, equality filters on every query parameter, `X-Total-Count`, `unique`, schema. No sort, no pagination, no option: do not add them back, a sorted or paged answer is a route.
- `src/mock.ts` main entry wrapper: the core with the lomkit engine as default. `src/search.ts` and `src/request-body.ts` only re-export, so existing imports keep working.

## Rules
- Never import `nexdk` or `beepr`. shamock only knows a `{ schema }` shape.
- No runtime dependency. `StandardSchemaV1` is a local copy of the contract; never add `zod` to type it.
- Routes under an absolute `baseUrl`: `POST /<r>/search`, `POST /<r>/mutate`, `DELETE /<r>`. `mutate` is create and update only (422 otherwise) and answers `{ created, updated }` (ids). This is a documented request protocol, not an imitation of a backend. `search` answers a paginated envelope at the root (`data`, `current_page`, `last_page`, `per_page`, `total`, `from`, `to`, `meta: []`), 50 rows per page by default. Writes are atomic.
- The default behavior is simple and data-driven, not a backend imitation: `and` before `or` (SQL precedence), any positive `limit`, errors keyed by field name, deleting an unknown id succeeds, `in []` matches nothing, dates kept as given, null last, Unicode case folding, groups up to 10 levels, unknown keys and undeclared `includes` relations ignored, `text` is a plain substring.
- `profile: 'lomkit'` is an opt-in compatibility convenience (flag `lomkit` in `SearchOptions` and `createStore`). It restricts `limit` to `[10, 25, 50]`, prefixes error keys `mutate.<index>.attributes.<field>`, answers 422 for unknown or missing delete ids and `in []`, stores dates as `Y-m-d H:i:s`, sorts null first ascending, folds ASCII only, reads a backslash literally, allows one group level, refuses unknown keys, `aggregates`, `scopes`, `instructions` and `gates` that are not declared (or name something unknown) and unknown relations, refuses `like` with `text`, and matches `text` as a `%value%` pattern. Do not push it further: it stays minimal and opt-in. The options `limits`, `maxNestingDepth`, `likeEscape`, `unique`, `searchable` and `failures` work without it.
- Fault injection is the `failures` config (`method`, `path`, `after`, `times`, `status`, `network`, `delay`). Keep it that small.
- `timing` defaults to 300 ms because a test asserts it. Do not change the default.
- `aggregates` (count, exists, sum, avg, min, max over `links`, alias `<relation_snake>_<type>[_<field>]`), `scopes` and `instructions` (functions `(rows, params|fields) => rows`) and `gates` (functions `(row) => boolean`, answered under `gates` with the `authorized_to_*` names) are declared per resource and read at the root of `search` only. Without a declaration they are ignored, or `422` under the lomkit profile. A `.keyword` suffix on a filter or sort field is stripped.
- Core resource options: `schema`, `unique`, `mock`. Lomkit resource options: `limits`, `searchable`, `links`, `scopes`, `instructions`, `gates`. A new option needs README, docs and tests. An engine passes the shared contract test `test/engine-contract.ts`.
- Errors are `{ message, errors }` with 404, 413 or 422. Keep the limits: body 1 MB in bytes, 1000 mutations or ids, 100 filters, like pattern 256 characters, 1000 values per array, 10 000 rows per resource, nesting 10 (`maxNestingDepth`, default 10, 1 with the lomkit profile).
- Requests outside `baseUrl` go to the previous `fetch`. XHR is not intercepted. Under `baseUrl`, `unhandled: 'passthrough'` (default) keeps the historical behavior (no engine: real `fetch`; engine: `404`), `'error'` answers `501` `{ message: 'No mock for METHOD /path' }`. `record: true` sends everything under `baseUrl` to the previous `fetch` and captures JSON answers (non-JSON bodies skipped, query string not in the key).
- Same calling code with the mock and with the real backend: the switch is the variable (`enabled`) or `resources[name].mock`, never a change in the callers. State is in memory and restarts from the seed, no persistence. Guard the install with a dynamic `import('shamock')` behind a compile-time constant to keep it out of production bundles.
- Docs live in `docs/` (Starlight). Keep README, docs and this file in sync with `src/`.
- No comments in code or code blocks.

## Build and test
`pnpm build` · `pnpm test` · `pnpm typecheck`. Docs: `pnpm --dir docs build`. Node.js >= 22. No workspace, no sibling packages.
