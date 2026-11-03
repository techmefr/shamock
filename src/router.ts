import type { Engine, EngineContext, MockResource, Route } from './engine.ts'
import { json, notFound } from './response.ts'
import { canonicalQuery, routeResponse, textKey } from './route-table.ts'
import type { RouteTable, StaticRoute } from './route-table.ts'
import type { State } from './state.ts'

export interface RouterSetup<TResource extends object> {
    engine: Engine<Route, TResource> | undefined
    resources: Record<string, MockResource & TResource>
    table: RouteTable
    unhandled: 'passthrough' | 'error' | undefined
    state: State
}

export interface Router {
    route: (method: string, path: string, request: Request) => Promise<Response>
    claims: (method: string, path: string, url: URL, request: () => Request) => Promise<boolean>
}

export function createRouter<TResource extends object>({ engine, resources, table: fixed, unhandled, state }: RouterSetup<TResource>): Router {
    const hashes = new WeakMap<Request, Promise<string | undefined>>()

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

    const unhandledFor = (method: string, path: string): Response =>
        unhandled === 'error' ? json({ message: `No mock for ${method} ${path === '' ? '/' : path}` }, 501) : notFound()

    const route = async (method: string, path: string, request: Request): Promise<Response> => {
        const found = await fixedFor(method, path, new URL(request.url), () => request)
        if (found !== undefined) return respond(found, request, path)
        const matched = engine?.match({ method, path })
        const store = matched === undefined ? undefined : state.storeOf(matched.resource)
        if (engine === undefined || matched === undefined || store === undefined) return unhandledFor(method, path)
        const context: EngineContext<Route, TResource> = {
            request,
            method,
            path,
            route: matched,
            store,
            resource: resourceOf(matched.resource) ?? {},
            storeOf: state.storeOf,
            resourceOf,
            exclusive: state.exclusive,
        }
        return engine.handle(context)
    }

    const claims = async (method: string, path: string, url: URL, request: () => Request): Promise<boolean> => {
        if ((await fixedFor(method, path, url, request)) !== undefined) return true
        if (engine === undefined) return unhandled === 'error'
        const matched = engine.match({ method, path })
        return matched === undefined || resourceOf(matched.resource)?.mock !== false
    }

    return { route, claims }
}
