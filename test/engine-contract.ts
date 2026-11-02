import { describe, expect, it } from 'vitest'
import { createMock, json } from '../src/core.ts'
import type { Engine, FetchLike, Route } from '../src/core.ts'

export const echoEngine = (): Engine => ({
    match: ({ method, path }) => {
        const [, resource, extra] = path.split('/')
        return resource !== undefined && resource !== '' && extra === undefined && (method === 'GET' || method === 'POST') ? { resource } : undefined
    },
    handle: async ({ method, request, store }) => {
        if (method === 'POST') return json(store.insert(await request.json()), 201)
        return json(store.all())
    },
})

export interface ContractCase {
    name: string
    engine: () => Engine<Route, object>
    list: { method: string; path: string; body?: unknown }
    create: { method: string; path: string; body: unknown }
    rows: (body: unknown) => unknown[]
}

const BASE = 'http://api.test/v1'

const send = (fetch: FetchLike, spec: { method: string; path: string; body?: unknown }): Promise<Response> =>
    fetch(`${BASE}${spec.path}`, {
        method: spec.method,
        headers: { 'Content-Type': 'application/json' },
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
    })

export function engineContract(contract: ContractCase): void {
    const seed = { users: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }] }
    const origin: FetchLike = async () => new Response('real', { status: 200 })
    const mocked = (extra: object = {}): ReturnType<typeof createMock> =>
        createMock({ baseUrl: BASE, seed, engine: contract.engine(), timing: 0, fetch: origin, ...extra })

    describe(`engine contract: ${contract.name}`, () => {
        it('matches its own routes with a resource name and ignores foreign paths', () => {
            const engine = contract.engine()
            const route = engine.match({ method: contract.list.method, path: contract.list.path })
            expect(route?.resource).toBe('users')
            expect(engine.match({ method: 'GET', path: '' })).toBeUndefined()
        })

        it('answers a list request through the core', async () => {
            const mock = await mocked()
            const response = await send(mock.fetch, contract.list)
            expect(response.status).toBe(200)
            expect(contract.rows(await response.json())).toHaveLength(2)
        })

        it('keeps state between requests and restores the seed on reset', async () => {
            const mock = await mocked()
            expect((await send(mock.fetch, contract.create)).status).toBeLessThan(300)
            expect(contract.rows(await (await send(mock.fetch, contract.list)).json())).toHaveLength(3)
            mock.reset()
            expect(contract.rows(await (await send(mock.fetch, contract.list)).json())).toHaveLength(2)
        })

        it('answers 404 for an unknown resource', async () => {
            const mock = await mocked()
            const response = await send(mock.fetch, { ...contract.list, path: contract.list.path.replace('users', 'ghosts') })
            expect(response.status).toBe(404)
        })

        it('sends a resource flagged mock: false to the real fetch', async () => {
            const mock = await mocked({ resources: { users: { mock: false } } })
            const response = await send(mock.fetch, contract.list)
            expect(await response.text()).toBe('real')
        })

        it('sends requests outside the base url to the real fetch', async () => {
            const mock = await mocked()
            expect(await (await mock.fetch('http://other.test/users')).text()).toBe('real')
        })

        it('applies injected failures before the engine runs', async () => {
            const mock = await mocked({ failures: [{ status: 503 }] })
            expect((await send(mock.fetch, contract.list)).status).toBe(503)
        })

        it('passes everything to the real fetch when disabled', async () => {
            const mock = await mocked({ enabled: false })
            expect(await (await send(mock.fetch, contract.list)).text()).toBe('real')
        })
    })
}
