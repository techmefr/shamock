import type { Engine, EngineContext, MockResource, Route } from './engine.ts'
import { createFailures, MAX_DELAY } from './failures.ts'
import type { FailureRule } from './failures.ts'
import { HttpError } from './http-error.ts'
import { installFetch } from './install.ts'
import type { FetchLike } from './install.ts'
import { parseMockList } from './parse-mock.ts'
import { createRecorder } from './recorder.ts'
import { json, notFound } from './response.ts'
import { canonicalQuery, routeResponse, routeTable, textKey, trimmed } from './route-table.ts'
import type { StaticRoute } from './route-table.ts'
import { withScenario } from './scenarios.ts'
import type { MockScenario, MockSeed } from './scenarios.ts'
import { createStore } from './store.ts'
import type { Store } from './store.ts'

export type { FailureRule, FetchLike, MockScenario, MockSeed, StaticRoute }

export interface MockOptions<TResource extends object = object> {
    baseUrl: string
    seed?: MockSeed
    resources?: Record<string, MockResource & NoInfer<TResource>>
    routes?: Record<string, StaticRoute>
    failures?: FailureRule[]
    timing?: number
    enabled?: boolean
    fetch?: FetchLike
    unhandled?: 'passthrough' | 'error'
    record?: boolean
    scenarios?: Record<string, MockScenario>
    scenario?: string
}

export interface MockConfig<TResource extends object = object> extends MockOptions<TResource> {
    engine?: Engine<Route, TResource>
}

export interface Mock {
    handle: (request: Request) => Promise<Response>
    fetch: FetchLike
    install: () => InstalledMock
    reset: () => void
    recorded: () => Record<string, unknown>
}

export interface InstalledMock extends Mock {
    restore: () => void
}

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

async function validatedSeed(
    seedConfig: MockSeed,
    resources: Record<string, MockResource>,
): Promise<Map<string, Record<string, unknown>[]>> {
    for (const name of Object.keys(resources)) {
        if (resources[name]?.mock !== false && !Object.hasOwn(seedConfig, name)) throw new Error(`Resource "${name}" has no entry in seed`)
    }
    const seed = new Map<string, Record<string, unknown>[]>()
    for (const [name, items] of Object.entries(seedConfig)) {
        const schema = Object.hasOwn(resources, name) ? resources[name]?.schema : undefined
        seed.set(name, schema ? ((await parseMockList({ schema }, items)) as Record<string, unknown>[]) : (items as Record<string, unknown>[]))
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

const urlOf = (input: RequestInfo | URL): URL | undefined => {
    if (input instanceof URL) return input
    try {
        return new URL(typeof input === 'string' ? input : input.url)
    } catch {
        return undefined
    }
}

const methodOf = (input: RequestInfo | URL, init: RequestInit | undefined): string =>
    (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

const disabledMock = (config: { fetch?: FetchLike }): Mock => {
    const passthrough = config.fetch ?? globalThis.fetch
    const mock: Mock = {
        handle: request => passthrough.call(globalThis, request),
        fetch: (input, init) => passthrough.call(globalThis, input, init),
        install: () => ({ ...mock, restore: () => undefined }),
        reset: () => undefined,
        recorded: () => ({}),
    }
    return mock
}

function validatedUnhandled(unhandled: unknown): void {
    if (unhandled !== undefined && unhandled !== 'passthrough' && unhandled !== 'error') {
        throw new TypeError('Invalid unhandled: expected "passthrough" or "error"')
    }
}

export async function createMock<TResource extends object = object>(options: MockConfig<TResource>): Promise<Mock> {
    if (options.enabled === false) return disabledMock(options)
    const config = withScenario(options)
    validatedUnhandled(config.unhandled)
    const timing = validatedTiming(config.timing)
    const engine = config.engine
    let failureFor = createFailures(config.failures)
    const resources = config.resources ?? {}
    const seed = await validatedSeed(config.seed ?? {}, resources)
    engine?.validate?.({ resources, names: [...seed.keys()] })
    const fixed = routeTable(config.routes)
    const recorder = createRecorder()
    const hashes = new WeakMap<Request, Promise<string | undefined>>()
    const storesFromSeed = (): Map<string, Store> =>
        new Map<string, Store>([...seed].map(([name, items]) => [name, createStore(items, engine?.normalize)]))
    let stores = storesFromSeed()
    const base = new URL(config.baseUrl)
    const origin = config.fetch ?? globalThis.fetch
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
        return trimmed(url.pathname.slice(basePath.length))
    }

    const resourceOf = (name: string): (MockResource & Partial<TResource>) | undefined =>
        Object.hasOwn(resources, name) ? resources[name] : undefined

    const hashOf = (request: Request): Promise<string | undefined> => {
        const hash = hashes.get(request) ?? request.clone().text().then(textKey)
        hashes.set(request, hash)
        return hash
    }

    const fixedFor = async (method: string, path: string, url: URL, request: () => Request): Promise<{ value: StaticRoute } | undefined> =>
        fixed.find(method, path, canonicalQuery(url.searchParams), fixed.hashed(method, path) ? await hashOf(request()) : undefined)

    const respond = async (found: { value: StaticRoute }, request: Request, path: string): Promise<Response> =>
        routeResponse(typeof found.value === 'function' ? await (found.value as (request: Request, path: string) => unknown)(request, path) : found.value)

    const unhandled = (method: string, path: string): Response =>
        config.unhandled === 'error' ? json({ message: `No mock for ${method} ${path === '' ? '/' : path}` }, 501) : notFound()

    const route = async (method: string, path: string, request: Request): Promise<Response> => {
        const found = await fixedFor(method, path, new URL(request.url), () => request)
        if (found !== undefined) return respond(found, request, path)
        const matched = engine?.match({ method, path })
        const store = matched === undefined ? undefined : stores.get(matched.resource)
        if (engine === undefined || matched === undefined || store === undefined) return unhandled(method, path)
        const context: EngineContext<Route, TResource> = {
            request,
            method,
            path,
            route: matched,
            store,
            resource: resourceOf(matched.resource) ?? {},
            storeOf: name => stores.get(name),
            resourceOf,
            exclusive,
        }
        return engine.handle(context)
    }

    const handle = async (request: Request): Promise<Response> => {
        const path = pathOf(urlOf(request.url))
        if (path === undefined) return notFound()
        try {
            request.signal.throwIfAborted()
            if (timing > 0) await wait(timing, request.signal)
            const method = request.method.toUpperCase()
            const failure = failureFor(method, path)
            if (failure?.delay !== undefined) await wait(failure.delay, request.signal)
            if (failure?.network === true) throw new TypeError('fetch failed')
            if (failure?.status !== undefined) throw new HttpError(failure.status, 'Injected failure')
            return await route(method, path, request)
        } catch (error) {
            if (error instanceof HttpError) return json({ message: error.message, errors: error.errors }, error.status)
            throw error
        }
    }

    const reset = (): void => {
        stores = storesFromSeed()
        failureFor = createFailures(config.failures)
        recorder.clear()
    }

    const isMocked = async (method: string, path: string, url: URL, request: () => Request): Promise<boolean> => {
        if ((await fixedFor(method, path, url, request)) !== undefined) return true
        if (engine === undefined) return config.unhandled === 'error'
        const matched = engine.match({ method, path })
        return matched === undefined || resourceOf(matched.resource)?.mock !== false
    }

    const serve = (next: () => FetchLike): FetchLike => {
        return async (input, init) => {
            const url = urlOf(input)
            const path = pathOf(url)
            if (url === undefined || path === undefined) return next().call(globalThis, input, init)
            const method = methodOf(input, init)
            let request: Request | undefined
            const built = (): Request => (request ??= new Request(input, init))
            if (config.record === true) return recorder.capture(built(), method, path, next())
            if (await isMocked(method, path, url, built)) return handle(built())
            return request === undefined ? next().call(globalThis, input, init) : next().call(globalThis, request)
        }
    }

    const recorded = recorder.recorded

    const install = (): InstalledMock => {
        const { fetch, restore } = installFetch(serve)
        return { handle, fetch, install, reset, restore, recorded }
    }

    return { handle, fetch: serve(() => origin), install, reset, recorded }
}

export async function installMock<TResource extends object = object>(config: MockConfig<TResource>): Promise<InstalledMock> {
    return (await createMock(config)).install()
}
