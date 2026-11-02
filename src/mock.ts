import { createFailures, MAX_DELAY } from './failures.ts'
import type { FailureRule } from './failures.ts'
import { HttpError } from './http-error.ts'
import { installFetch } from './install.ts'
import type { FetchLike } from './install.ts'
import { idsToRemove, mutationsOf, parseJsonBody, readBody, toMutation } from './request-body.ts'
import { applySearch, DEFAULT_LIMITS, MAX_NESTING, searchOf } from './search.ts'
import type { SearchOptions, SearchRecord } from './search.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'
import { createStore } from './store.ts'
import type { Store } from './store.ts'
import { MockValidationError, parseMock, parseMockList } from './parse-mock.ts'

export type { FailureRule, FetchLike }

export interface MockSeed {
    [resourceName: string]: Record<string, unknown>[]
}

export interface MockRelation {
    type: 'belongsTo' | 'hasMany'
    resource: string
    foreignKey: string
}

export interface MockResource {
    schema?: StandardSchemaV1
    unique?: string[]
    limits?: number[]
    searchable?: string[]
    relations?: Record<string, MockRelation>
}

export interface MockConfig {
    baseUrl: string
    seed: MockSeed
    resources?: Record<string, MockResource>
    limits?: number[]
    likeEscape?: boolean
    maxNestingDepth?: number
    failures?: FailureRule[]
    timing?: number
}

export interface Mock {
    handle: (request: Request) => Promise<Response>
    fetch: FetchLike
    install: () => InstalledMock
}

export interface InstalledMock extends Mock {
    restore: () => void
}

type FieldErrors = Record<string, string[]>

interface AppliedMutation {
    kind: 'created' | 'updated'
    record: SearchRecord
    attributes: Record<string, unknown>
}

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mergeErrors(target: FieldErrors, source: FieldErrors): void {
    for (const [key, messages] of Object.entries(source)) target[key] = [...(target[key] ?? []), ...messages]
}

function schemaErrors(error: MockValidationError, prefix: string): FieldErrors {
    const errors: FieldErrors = {}
    for (const issue of error.issues) {
        const path = (issue.path ?? []).map(segment => String(typeof segment === 'object' ? segment.key : segment)).join('.')
        const key = path === '' ? prefix : `${prefix}.${path}`
        errors[key] = [...(errors[key] ?? []), issue.message]
    }
    return errors
}

async function validateRecord(resource: MockResource, record: SearchRecord, index: number): Promise<FieldErrors> {
    if (resource.schema === undefined) return {}
    try {
        await parseMock({ schema: resource.schema }, record)
        return {}
    } catch (error) {
        if (error instanceof MockValidationError) return schemaErrors(error, `mutate.${index}.attributes`)
        throw error
    }
}

function takenErrors(unique: string[], applied: AppliedMutation[], rows: SearchRecord[]): FieldErrors {
    const errors: FieldErrors = {}
    applied.forEach(({ record, attributes }, index) => {
        for (const field of unique) {
            const value = record[field]
            if (!Object.hasOwn(attributes, field) || value === undefined || value === null) continue
            if (rows.some(row => row['id'] !== record['id'] && row[field] === value)) {
                errors[`mutate.${index}.attributes.${field}`] = [`The ${field} has already been taken.`]
            }
        }
    })
    return errors
}

function invalidData(errors: FieldErrors): HttpError {
    return new HttpError(422, 'The given data was invalid.', errors)
}

const notFound = (): Response => json({ message: 'Not found', errors: {} }, 404)

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        const onAbort = (): void => {
            clearTimeout(timer)
            reject(signal.reason)
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        signal.addEventListener('abort', onAbort, { once: true })
    })

async function validatedSeed(config: MockConfig): Promise<Map<string, Record<string, unknown>[]>> {
    const resources = config.resources ?? {}
    for (const name of Object.keys(resources)) {
        if (!Object.hasOwn(config.seed, name)) throw new Error(`Resource "${name}" has no entry in seed`)
    }
    const seed = new Map<string, Record<string, unknown>[]>()
    for (const [name, items] of Object.entries(config.seed)) {
        const schema = Object.hasOwn(resources, name) ? resources[name]?.schema : undefined
        seed.set(name, schema ? ((await parseMockList({ schema }, items)) as Record<string, unknown>[]) : items)
    }
    return seed
}

function validatedTiming(timing: number | undefined): number {
    if (timing === undefined) return 300
    if (!Number.isFinite(timing) || timing < 0 || timing > MAX_DELAY) {
        throw new RangeError(`Invalid timing: expected a number between 0 and ${MAX_DELAY}`)
    }
    return timing
}

function validatedLimits(limits: number[] | undefined): number[] | undefined {
    if (limits === undefined) return undefined
    if (!Array.isArray(limits) || limits.length === 0 || !limits.every(limit => Number.isInteger(limit) && limit > 0)) {
        throw new RangeError('Invalid limits: expected a non-empty list of positive integers')
    }
    return limits
}

function validatedNesting(depth: number | undefined): number | undefined {
    if (depth === undefined) return undefined
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_NESTING) {
        throw new RangeError(`Invalid maxNestingDepth: expected an integer between 1 and ${MAX_NESTING}`)
    }
    return depth
}

function validatedRelations(resources: Record<string, MockResource>, seed: Map<string, unknown>): void {
    for (const [name, resource] of Object.entries(resources)) {
        for (const [relation, link] of Object.entries(resource.relations ?? {})) {
            if (link.type !== 'belongsTo' && link.type !== 'hasMany') throw new Error(`Relation "${name}.${relation}" has an unknown type`)
            if (!seed.has(link.resource)) throw new Error(`Relation "${name}.${relation}" targets unknown resource "${link.resource}"`)
        }
    }
}

const decode = (segment: string): string => {
    try {
        return decodeURIComponent(segment)
    } catch {
        return segment
    }
}

const urlOf = (input: RequestInfo | URL): URL | undefined => {
    if (input instanceof URL) return input
    try {
        return new URL(typeof input === 'string' ? input : input.url)
    } catch {
        return undefined
    }
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | undefined> {
    const raw = await readBody(request)
    const body = parseJsonBody(raw)
    if (body === undefined && raw !== '') throw new HttpError(422, 'Invalid JSON body')
    return body
}

async function requiredBodyOf(request: Request): Promise<Record<string, unknown>> {
    const body = await bodyOf(request)
    if (body === undefined) throw new HttpError(422, 'Invalid JSON body')
    return body
}

export async function createMock(config: MockConfig): Promise<Mock> {
    const timing = validatedTiming(config.timing)
    const limits = validatedLimits(config.limits) ?? DEFAULT_LIMITS
    const nesting = validatedNesting(config.maxNestingDepth)
    const failureFor = createFailures(config.failures)
    const seed = await validatedSeed(config)
    const resources = config.resources ?? {}
    validatedRelations(resources, seed)
    const stores = new Map<string, Store>([...seed].map(([name, items]) => [name, createStore(items)]))
    const base = new URL(config.baseUrl)
    const origin = globalThis.fetch
    let writes: Promise<unknown> = Promise.resolve()

    const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
        const run = writes.then(task)
        writes = run.catch(() => undefined)
        return run
    }
    const basePath = base.pathname.replace(/\/+$/, '')

    const pathOf = (url: URL | undefined): string | undefined => {
        if (url === undefined || url.origin !== base.origin) return undefined
        if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return undefined
        return url.pathname.slice(basePath.length)
    }

    const resourceOf = (name: string): MockResource | undefined => (Object.hasOwn(resources, name) ? resources[name] : undefined)

    const searchOptions = (name: string): SearchOptions => {
        const resource = resourceOf(name)
        const relations = Object.entries(resource?.relations ?? {}).map(([relation, link]) => [
            relation,
            {
                type: link.type,
                foreignKey: link.foreignKey,
                records: () => (stores.get(link.resource) as Store).all(),
                options: () => searchOptions(link.resource),
            },
        ])
        return { limits: resource?.limits ?? limits, searchable: resource?.searchable, likeEscape: config.likeEscape, maxNestingDepth: nesting, relations: Object.fromEntries(relations) }
    }

    const route = async (method: string, path: string, request: Request): Promise<Response> => {
        const [, rawName = '', rawAction, extra] = path.replace(/\/+$/, '').split('/')
        const name = decode(rawName)
        const store = stores.get(name)
        const action = rawAction === undefined ? undefined : decode(rawAction)
        if (store === undefined || extra !== undefined) return notFound()

        if (method === 'POST' && action === 'search') {
            return json(applySearch(store.all(), searchOf(await bodyOf(request)), searchOptions(name)))
        }

        if (method === 'POST' && action === 'mutate') {
            const mutations = mutationsOf(await requiredBodyOf(request)).map(toMutation)
            request.signal.throwIfAborted()
            const resource = resourceOf(name)
            const apply = (): AppliedMutation[] =>
                mutations.map(mutation => {
                    if (mutation.kind === 'create') {
                        return { kind: 'created', record: store.insert(mutation.attributes), attributes: mutation.attributes }
                    }
                    const updated = store.update(mutation.key, mutation.attributes)
                    if (updated === null) throw new HttpError(404, 'Not found')
                    return { kind: 'updated', record: updated, attributes: mutation.attributes }
                })
            return exclusive(async () => {
                const previewed = store.preview(() => {
                    const done = apply()
                    return { done, taken: takenErrors(resource?.unique ?? [], done, store.all()) }
                })
                const errors: FieldErrors = {}
                mergeErrors(errors, previewed.taken)
                if (resource !== undefined) {
                    for (const [index, { record }] of previewed.done.entries()) mergeErrors(errors, await validateRecord(resource, record, index))
                }
                if (Object.keys(errors).length > 0) throw invalidData(errors)
                request.signal.throwIfAborted()
                const applied = store.transaction(apply)
                const idsOf = (kind: AppliedMutation['kind']): unknown[] =>
                    applied.filter(entry => entry.kind === kind).map(entry => entry.record['id'])
                return json({ created: idsOf('created'), updated: idsOf('updated') })
            })
        }

        if (method === 'DELETE' && action === undefined) {
            const ids = idsToRemove(await requiredBodyOf(request))
            request.signal.throwIfAborted()
            if (ids.length === 0) {
                const message = 'The resources field is required.'
                throw new HttpError(422, message, { resources: [message] })
            }
            return exclusive(async () => {
                const errors: FieldErrors = {}
                ids.forEach((id, index) => {
                    if (!store.has(id)) errors[`resources.${index}`] = [`The selected resources.${index} is invalid.`]
                })
                if (Object.keys(errors).length > 0) throw new HttpError(422, Object.values(errors)[0]?.[0] ?? 'Invalid ids', errors)
                store.transaction(() => ids.forEach(id => store.remove(id)))
                return json({ success: true })
            })
        }

        return notFound()
    }

    const handle = async (request: Request): Promise<Response> => {
        const path = pathOf(urlOf(request.url))
        if (path === undefined) return notFound()
        try {
            request.signal.throwIfAborted()
            if (timing > 0) await wait(timing, request.signal)
            const method = request.method.toUpperCase()
            const failure = failureFor(method, path.replace(/\/+$/, ''))
            if (failure?.delay !== undefined) await wait(failure.delay, request.signal)
            if (failure?.network === true) throw new TypeError('fetch failed')
            if (failure?.status !== undefined) throw new HttpError(failure.status, 'Injected failure')
            return await route(method, path, request)
        } catch (error) {
            if (error instanceof HttpError) return json({ message: error.message, errors: error.errors }, error.status)
            throw error
        }
    }

    const serve = (next: () => FetchLike): FetchLike => {
        return (input, init) => {
            if (pathOf(urlOf(input)) === undefined) return next().call(globalThis, input, init)
            return handle(new Request(input, init))
        }
    }

    const install = (): InstalledMock => {
        const { fetch, restore } = installFetch(serve)
        return { handle, fetch, install, restore }
    }

    return { handle, fetch: serve(() => origin), install }
}

export async function installMock(config: MockConfig): Promise<InstalledMock> {
    return (await createMock(config)).install()
}
