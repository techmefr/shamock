import { HttpError } from './http-error.ts'
import { isRecord, own } from './record.ts'
import { idsToRemove, mutationsOf, parseJsonBody, toMutation } from './request-body.ts'
import { applySearch, searchOf } from './search.ts'
import type { SearchRecord } from './search.ts'
import { parseMockList } from './parse-mock.ts'
import type { MockableResource } from './parse-mock.ts'

export interface MockSeed {
    [resourceName: string]: Record<string, unknown>[]
}

export interface MockConfig {
    baseUrl: string
    seed: MockSeed
    resources?: Record<string, MockableResource>
    timing?: number
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface Mock {
    handle: (request: Request) => Promise<Response>
    fetch: FetchLike
    install: () => InstalledMock
}

export interface InstalledMock extends Mock {
    restore: () => void
}

interface Installation {
    previous: FetchLike
    active: boolean
}

const installations: Installation[] = []

const INVALID_BODY = { message: 'Invalid JSON body', errors: {} }

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

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

const toId = (value: unknown): string => {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'string' && value !== '') return value
    throw new HttpError(422, 'Invalid id: expected a non-empty string or a number')
}

function createStore(items: Record<string, unknown>[]) {
    const rows = new Map<string, SearchRecord>()
    let nextId = 1

    const insert = (attributes: unknown): SearchRecord => {
        if (!isRecord(attributes)) throw new HttpError(422, 'Invalid record: expected an object')
        const given = own(attributes, 'id')
        let id: string
        if (given === undefined || given === null) {
            while (rows.has(String(nextId))) nextId++
            if (!Number.isSafeInteger(nextId)) throw new HttpError(422, 'No id available')
            id = String(nextId)
        } else {
            id = toId(given)
            if (rows.has(id)) throw new HttpError(422, `Record "${id}" already exists`)
        }
        const numeric = Number(id)
        if (Number.isSafeInteger(numeric) && String(numeric) === id && numeric >= nextId) nextId = numeric + 1
        const record = { ...attributes, id }
        rows.set(id, record)
        return { ...record }
    }

    items.forEach(item => insert(structuredClone(item)))

    return {
        all: (): SearchRecord[] => [...rows.values()].map(record => ({ ...record })),
        insert,
        update(key: unknown, attributes: Record<string, unknown>): SearchRecord | null {
            const id = toId(key)
            const current = rows.get(id)
            if (current === undefined) return null
            const record = { ...current, ...attributes, id }
            rows.set(id, record)
            return { ...record }
        },
        remove(key: unknown): void {
            rows.delete(toId(key))
        },
    }
}

async function validatedSeed(config: MockConfig): Promise<Map<string, Record<string, unknown>[]>> {
    const resources = config.resources
    const seed = new Map<string, Record<string, unknown>[]>()
    for (const [name, items] of Object.entries(config.seed)) {
        const resource = resources !== undefined && Object.hasOwn(resources, name) ? resources[name] : undefined
        seed.set(name, resource ? ((await parseMockList(resource, items)) as Record<string, unknown>[]) : items)
    }
    return seed
}

const decodeName = (segment: string): string => {
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

export async function createMock(config: MockConfig): Promise<Mock> {
    const seed = await validatedSeed(config)
    const stores = new Map([...seed].map(([name, items]) => [name, createStore(items)]))
    const base = new URL(config.baseUrl)
    const basePath = base.pathname.replace(/\/+$/, '')
    const timing = config.timing ?? 300

    const pathOf = (url: URL | undefined): string | undefined => {
        if (url === undefined || url.origin !== base.origin) return undefined
        if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return undefined
        return url.pathname.slice(basePath.length)
    }

    const route = async (method: string, path: string, request: Request): Promise<Response> => {
        const [, rawName = '', action, extra] = path.replace(/\/+$/, '').split('/')
        const store = stores.get(decodeName(rawName))
        if (store === undefined || extra !== undefined) return json({ message: 'Not found' }, 404)

        if (method === 'POST' && action === 'search') {
            const body = parseJsonBody(await request.text())
            return json(applySearch(store.all(), searchOf(body)))
        }

        if (method === 'POST' && action === 'mutate') {
            const body = parseJsonBody(await request.text())
            if (body === undefined) return json(INVALID_BODY, 422)
            const data = mutationsOf(body).map(operation => {
                const mutation = toMutation(operation)
                if (mutation.kind === 'create') return store.insert(mutation.attributes)
                return store.update(mutation.key, mutation.attributes)
            })
            return json({ data })
        }

        if (method === 'DELETE' && action === undefined) {
            const body = parseJsonBody(await request.text())
            if (body === undefined) return json(INVALID_BODY, 422)
            for (const id of idsToRemove(body)) store.remove(id)
            return json({ success: true })
        }

        return json({ message: 'Not found' }, 404)
    }

    const handle = async (request: Request): Promise<Response> => {
        const path = pathOf(urlOf(request.url))
        if (path === undefined) return json({ message: 'Not found' }, 404)
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
        const installation: Installation = { previous: globalThis.fetch, active: true }
        const served = serve(() => installation.previous)
        const mockFetch: FetchLike = (input, init) =>
            installation.active ? served(input, init) : installation.previous.call(globalThis, input, init)
        installations.push(installation)
        globalThis.fetch = mockFetch
        const restore = (): void => {
            const index = installations.indexOf(installation)
            if (index === -1) return
            installations.splice(index, 1)
            installation.active = false
            const above = installations.find(other => other.previous === mockFetch)
            if (above !== undefined) above.previous = installation.previous
            else if (globalThis.fetch === mockFetch) globalThis.fetch = installation.previous
        }
        return { handle, fetch: mockFetch, install, restore }
    }

    return { handle, fetch: serve(() => globalThis.fetch), install }
}

export async function installMock(config: MockConfig): Promise<InstalledMock> {
    return (await createMock(config)).install()
}
