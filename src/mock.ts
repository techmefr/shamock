import { HttpError } from './http-error.ts'
import { installFetch } from './install.ts'
import type { FetchLike } from './install.ts'
import { idsToRemove, mutationsOf, parseJsonBody, readBody, toMutation } from './request-body.ts'
import { applySearch, searchOf } from './search.ts'
import { createStore } from './store.ts'
import { parseMockList } from './parse-mock.ts'
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
    const basePath = base.pathname.replace(/\/+$/, '')

    const pathOf = (url: URL | undefined): string | undefined => {
        if (url === undefined || url.origin !== base.origin) return undefined
        if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return undefined
        return url.pathname.slice(basePath.length)
    }

    const route = async (method: string, path: string, request: Request): Promise<Response> => {
        const [, rawName = '', rawAction, extra] = path.replace(/\/+$/, '').split('/')
        const store = stores.get(decode(rawName))
        const action = rawAction === undefined ? undefined : decode(rawAction)
        if (store === undefined || extra !== undefined) return notFound()

        if (method === 'POST' && action === 'search') {
            return json(applySearch(store.all(), searchOf(await bodyOf(request))))
        }

        if (method === 'POST' && action === 'mutate') {
            const mutations = mutationsOf(await requiredBodyOf(request)).map(toMutation)
            request.signal.throwIfAborted()
            const data = store.transaction(() =>
                mutations.map(mutation =>
                    mutation.kind === 'create'
                        ? store.insert(mutation.attributes)
                        : store.update(mutation.key, mutation.attributes),
                ),
            )
            return json({ data })
        }

        if (method === 'DELETE' && action === undefined) {
            const ids = idsToRemove(await requiredBodyOf(request))
            request.signal.throwIfAborted()
            store.transaction(() => ids.forEach(id => store.remove(id)))
            return json({ success: true })
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
            if (error instanceof HttpError) return json({ message: error.message, errors: {} }, error.status)
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

    return { handle, fetch: serve(() => globalThis.fetch), install }
}

export async function installMock(config: MockConfig): Promise<InstalledMock> {
    return (await createMock(config)).install()
}
