import { HttpError } from './http-error.ts'
import { installFetch } from './install.ts'
import type { FetchLike } from './install.ts'
import { idsToRemove, mutationsOf, parseJsonBody, readBody, toMutation } from './request-body.ts'
import { applySearch, searchOf } from './search.ts'
import { createStore } from './store.ts'
import { MockValidationError, parseMock, parseMockList } from './parse-mock.ts'
import type { MockableResource } from './parse-mock.ts'

export type { FetchLike }

export interface MockSeed {
    [resourceName: string]: Record<string, unknown>[]
}

export interface MockConfig {
    baseUrl: string
    seed: MockSeed
    resources?: Record<string, MockableResource>
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

const MAX_TIMING = 60_000

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const invalidData = (error: MockValidationError): HttpError => {
    const errors: Record<string, string[]> = {}
    for (const issue of error.issues) {
        const path = (issue.path ?? []).map(segment => String(typeof segment === 'object' ? segment.key : segment)).join('.')
        const key = path === '' ? 'record' : path
        errors[key] = [...(errors[key] ?? []), issue.message]
    }
    return new HttpError(422, 'The given data was invalid.', errors)
}

async function validateRecord(resource: MockableResource, record: Record<string, unknown>): Promise<void> {
    try {
        await parseMock(resource, record)
    } catch (error) {
        if (error instanceof MockValidationError) throw invalidData(error)
        throw error
    }
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
        const resource = Object.hasOwn(resources, name) ? resources[name] : undefined
        seed.set(name, resource ? ((await parseMockList(resource, items)) as Record<string, unknown>[]) : items)
    }
    return seed
}

function validatedTiming(timing: number | undefined): number {
    if (timing === undefined) return 300
    if (!Number.isFinite(timing) || timing < 0 || timing > MAX_TIMING) {
        throw new RangeError(`Invalid timing: expected a number between 0 and ${MAX_TIMING}`)
    }
    return timing
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
    const seed = await validatedSeed(config)
    const stores = new Map([...seed].map(([name, items]) => [name, createStore(items)]))
    const base = new URL(config.baseUrl)
    const origin = globalThis.fetch
    const resources = config.resources ?? {}
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

    const route = async (method: string, path: string, request: Request): Promise<Response> => {
        const [, rawName = '', rawAction, extra] = path.replace(/\/+$/, '').split('/')
        const name = decode(rawName)
        const store = stores.get(name)
        const action = rawAction === undefined ? undefined : decode(rawAction)
        if (store === undefined || extra !== undefined) return notFound()

        if (method === 'POST' && action === 'search') {
            return json(applySearch(store.all(), searchOf(await bodyOf(request))))
        }

        if (method === 'POST' && action === 'mutate') {
            const mutations = mutationsOf(await requiredBodyOf(request)).map(toMutation)
            request.signal.throwIfAborted()
            const resource = Object.hasOwn(resources, name) ? resources[name] : undefined
            const apply = (): Record<string, unknown>[] =>
                mutations.map(mutation => {
                    if (mutation.kind === 'create') return store.insert(mutation.attributes)
                    const updated = store.update(mutation.key, mutation.attributes)
                    if (updated === null) throw new HttpError(404, 'Not found')
                    return updated
                })
            return exclusive(async () => {
                if (resource !== undefined) {
                    for (const record of store.preview(apply)) await validateRecord(resource, record)
                }
                request.signal.throwIfAborted()
                return json({ data: store.transaction(apply) })
            })
        }

        if (method === 'DELETE' && action === undefined) {
            const ids = idsToRemove(await requiredBodyOf(request))
            request.signal.throwIfAborted()
            return exclusive(async () => {
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
            return await route(request.method.toUpperCase(), path, request)
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
