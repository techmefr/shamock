import { idsToRemove, mutationsOf, parseJsonBody, toMutation } from './mirage-body.ts'
import { applySearch, searchOf } from './mirage-search.ts'
import type { SearchRecord } from './mirage-search.ts'
import { parseMockList } from './parse-mock.ts'
import type { MockableResource } from './parse-mock.ts'

export interface MirageResourceSeed {
    [resourceName: string]: Record<string, unknown>[]
}

export interface MirageSdkConfig {
    baseUrl: string
    seed: MirageResourceSeed
    resources?: Record<string, MockableResource>
    timing?: number
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface Mock {
    handle: (request: Request) => Promise<Response>
    fetch: FetchLike
    install: () => InstalledMock
}

export interface InstalledMock {
    handle: (request: Request) => Promise<Response>
    fetch: FetchLike
    restore: () => void
    shutdown: () => void
}

const INVALID_BODY = { message: 'Invalid JSON body', errors: {} }

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function createStore(items: Record<string, unknown>[]) {
    const rows = new Map<string, SearchRecord>()
    let nextId = 1

    const insert = (attributes: Record<string, unknown>): SearchRecord => {
        const given = attributes['id']
        const id = given === undefined || given === null ? String(nextId) : String(given)
        const numeric = Number(id)
        if (Number.isInteger(numeric) && numeric >= nextId) nextId = numeric + 1
        const record = { ...attributes, id }
        rows.set(id, record)
        return { ...record }
    }

    items.forEach(insert)

    return {
        all: (): SearchRecord[] => [...rows.values()].map(record => ({ ...record })),
        insert,
        update(key: unknown, attributes: Record<string, unknown>): SearchRecord | null {
            const id = String(key)
            const current = rows.get(id)
            if (current === undefined) return null
            const record = { ...current, ...attributes, id }
            rows.set(id, record)
            return { ...record }
        },
        remove(key: unknown): void {
            rows.delete(String(key))
        },
    }
}

async function validatedSeed(config: MirageSdkConfig): Promise<MirageResourceSeed> {
    const resources = config.resources
    if (resources === undefined) return config.seed
    const seed: MirageResourceSeed = {}
    for (const [name, items] of Object.entries(config.seed)) {
        const resource = resources[name]
        seed[name] = resource ? ((await parseMockList(resource, items)) as Record<string, unknown>[]) : items
    }
    return seed
}

export async function createMock(config: MirageSdkConfig): Promise<Mock> {
    const seed = await validatedSeed(config)
    const stores = new Map(Object.entries(seed).map(([name, items]) => [encodeURIComponent(name), createStore(items)]))
    const base = new URL(config.baseUrl)
    const basePath = base.pathname.replace(/\/+$/, '')
    const timing = config.timing ?? 300
    const original: FetchLike = globalThis.fetch?.bind(globalThis)

    const pathOf = (url: URL): string | undefined => {
        if (url.origin !== base.origin) return undefined
        if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return undefined
        return url.pathname.slice(basePath.length)
    }

    const route = async (method: string, path: string, request: Request): Promise<Response> => {
        const [, name = '', action] = path.split('/')
        const store = stores.get(name)
        if (store === undefined) return json({ message: 'Not found' }, 404)
        const body = parseJsonBody(await request.text())

        if (method === 'POST' && action === 'search') return json(applySearch(store.all(), searchOf(body)))

        if (method === 'POST' && action === 'mutate') {
            if (body === undefined) return json(INVALID_BODY, 422)
            const data = mutationsOf(body).map(operation => {
                const mutation = toMutation(operation)
                if (mutation.kind === 'create') return store.insert(mutation.attributes)
                return store.update(mutation.key, mutation.attributes)
            })
            return json({ data })
        }

        if (method === 'DELETE' && action === undefined) {
            if (body === undefined) return json(INVALID_BODY, 422)
            for (const id of idsToRemove(body)) store.remove(id)
            return json({ success: true })
        }

        return json({ message: 'Not found' }, 404)
    }

    const handle = async (request: Request): Promise<Response> => {
        const path = pathOf(new URL(request.url))
        if (path === undefined) return json({ message: 'Not found' }, 404)
        if (timing > 0) await wait(timing)
        return route(request.method.toUpperCase(), path, request)
    }

    const mockFetch: FetchLike = async (input, init) => {
        const request = new Request(input, init)
        if (pathOf(new URL(request.url)) === undefined) return original(input, init)
        return handle(request)
    }

    const install = (): InstalledMock => {
        const previous = globalThis.fetch
        globalThis.fetch = mockFetch
        const restore = (): void => {
            if (globalThis.fetch === mockFetch) globalThis.fetch = previous
        }
        return { handle, fetch: mockFetch, restore, shutdown: restore }
    }

    return { handle, fetch: mockFetch, install }
}

export async function installMock(config: MirageSdkConfig): Promise<InstalledMock> {
    return (await createMock(config)).install()
}

export const setupMirageMock = installMock
