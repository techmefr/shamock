import type { Engine, MockResource, Route } from './engine.ts'
import { createFailures } from './failures.ts'
import type { FailureRule } from './failures.ts'
import { HttpError } from './http-error.ts'
import { installFetch } from './install.ts'
import type { FetchLike } from './install.ts'
import { createRecorder } from './recorder.ts'
import { json, notFound } from './response.ts'
import { routeTable } from './route-table.ts'
import type { StaticRoute } from './route-table.ts'
import { createRouter } from './router.ts'
import { withScenario } from './scenarios.ts'
import type { MockScenario, MockSeed } from './scenarios.ts'
import { createState } from './state.ts'
import { methodOf, scopeOf, urlOf } from './target.ts'
import { validatedSeed, validatedTiming, validatedUnhandled } from './validate-config.ts'

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
    const table = routeTable(config.routes)
    const state = createState(seed, engine?.normalize)
    const router = createRouter({ engine, resources, table, unhandled: config.unhandled, state })
    const recorder = createRecorder()
    const pathOf = scopeOf(config.baseUrl)
    const origin = config.fetch ?? globalThis.fetch

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
            return await router.route(method, path, request)
        } catch (error) {
            if (error instanceof HttpError) return json({ message: error.message, errors: error.errors }, error.status)
            throw error
        }
    }

    const reset = (): void => {
        state.reset()
        failureFor = createFailures(config.failures)
        recorder.clear()
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
            if (await router.claims(method, path, url, built)) return handle(built())
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
