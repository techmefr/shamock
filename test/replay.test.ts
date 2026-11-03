import { describe, expect, it } from 'vitest'
import { bodyKey, createMock } from '../src/core.ts'
import type { FetchLike } from '../src/core.ts'
import { rest } from '../src/rest.ts'

const BASE = 'http://api.test/api'

const origin: FetchLike = async () => new Response('real', { status: 200 })

const post = (fetch: FetchLike, path: string, body: unknown): Promise<Response> =>
    fetch(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body) })

describe('unhandled calls', () => {
    it('passes unknown calls through by default', async () => {
        const mock = await createMock({ baseUrl: BASE, timing: 0, fetch: origin, routes: { '/users': [] } })
        expect(await (await mock.fetch(`${BASE}/orders`)).text()).toBe('real')
    })

    it('answers 501 with the method and path when set to error', async () => {
        const mock = await createMock({ baseUrl: BASE, timing: 0, fetch: origin, unhandled: 'error', routes: { '/users': [] } })
        const response = await mock.fetch(`${BASE}/orders`, { method: 'DELETE' })
        expect(response.status).toBe(501)
        expect(await response.json()).toEqual({ message: 'No mock for DELETE /orders' })
        expect((await mock.handle(new Request(`${BASE}/orders`))).status).toBe(501)
        expect(await (await mock.fetch('http://other.test/orders')).text()).toBe('real')
    })

    it('answers 501 for a resource the engine matches but the seed lacks', async () => {
        const mock = await createMock({ baseUrl: BASE, timing: 0, unhandled: 'error', engine: rest(), seed: { users: [] } })
        expect((await mock.fetch(`${BASE}/ghosts`)).status).toBe(501)
        expect((await mock.fetch(`${BASE}/users/1`)).status).toBe(404)
    })

    it('rejects an unknown policy', async () => {
        await expect(createMock({ baseUrl: BASE, unhandled: 'ignore' as 'error' })).rejects.toThrow('Invalid unhandled')
    })
})

describe('body keyed routes', () => {
    it('hashes the canonical json whatever the key order', () => {
        expect(bodyKey({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(bodyKey({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }))
        expect(bodyKey({ a: 1 })).toMatch(/^[0-9a-f]{8}$/)
        expect(bodyKey({ a: 1 })).not.toBe(bodyKey({ a: 2 }))
        expect(bodyKey({})).toBe('5465b825')
    })

    it('prefers the route with the body hash and falls back to the route without', async () => {
        const mock = await createMock({
            baseUrl: BASE,
            timing: 0,
            routes: {
                [`POST /search #${bodyKey({ q: 'ada', page: 1 })}`]: [{ id: 1 }],
                'POST /search': [],
            },
        })
        expect(await (await post(mock.fetch, '/search', { page: 1, q: 'ada' })).json()).toEqual([{ id: 1 }])
        expect(await (await post(mock.fetch, '/search', { q: 'grace' })).json()).toEqual([])
    })

    it('passes a body without its hash route through, or answers 501 under error', async () => {
        const routes = { [`POST /search #${bodyKey({ q: 'ada' })}`]: [{ id: 1 }] }
        const passing = await createMock({ baseUrl: BASE, timing: 0, fetch: origin, routes })
        expect(await (await post(passing.fetch, '/search', { q: 'ada' })).json()).toEqual([{ id: 1 }])
        expect(await (await post(passing.fetch, '/search', { q: 'linus' })).text()).toBe('real')
        const strict = await createMock({ baseUrl: BASE, timing: 0, fetch: origin, routes, unhandled: 'error' })
        expect((await post(strict.fetch, '/search', { q: 'linus' })).status).toBe(501)
    })

    it('answers a status and a body from the serializable form', async () => {
        const mock = await createMock({
            baseUrl: BASE,
            timing: 0,
            routes: {
                'POST /login': { $status: 401, $body: { message: 'Unauthenticated.' } },
                'DELETE /users/1': { $status: 204 },
                '/fn': () => ({ $status: 418, $body: 'teapot' }),
            },
        })
        const login = await mock.fetch(`${BASE}/login`, { method: 'POST' })
        expect(login.status).toBe(401)
        expect(await login.json()).toEqual({ message: 'Unauthenticated.' })
        const removed = await mock.fetch(`${BASE}/users/1`, { method: 'DELETE' })
        expect(removed.status).toBe(204)
        expect(await removed.text()).toBe('')
        expect((await mock.fetch(`${BASE}/fn`)).status).toBe(418)
    })

    it('matches the query whatever the parameter order and falls back to the key without query', async () => {
        const mock = await createMock({
            baseUrl: BASE,
            timing: 0,
            routes: {
                'GET /users?team=a&role=x&role=b': [{ id: 1 }],
                'GET /users?team=b': [{ id: 2 }],
                'GET /users': [],
                [`POST /search?page=2 #${bodyKey({ q: 'ada' })}`]: ['page two'],
                [`POST /search #${bodyKey({ q: 'ada' })}`]: ['any page'],
                'POST /search?page=2': ['no body match'],
            },
        })
        expect(await (await mock.fetch(`${BASE}/users?role=b&team=a&role=x`)).json()).toEqual([{ id: 1 }])
        expect(await (await mock.fetch(`${BASE}/users?team=b`)).json()).toEqual([{ id: 2 }])
        expect(await (await mock.fetch(`${BASE}/users?team=c`)).json()).toEqual([])
        expect(await (await mock.fetch(`${BASE}/users?role=x&team=a`)).json()).toEqual([])
        expect(await (await post(mock.fetch, '/search?page=2', { q: 'ada' })).json()).toEqual(['page two'])
        expect(await (await post(mock.fetch, '/search?page=3', { q: 'ada' })).json()).toEqual(['any page'])
        expect(await (await post(mock.fetch, '/search?page=2', { q: 'other' })).json()).toEqual(['no body match'])
    })

    it('rejects a malformed hash key', async () => {
        await expect(createMock({ baseUrl: BASE, routes: { 'POST /search #zz': [] } })).rejects.toThrow('Invalid route')
    })
})

describe('record and replay', () => {
    const backend = (): { fetch: FetchLike; calls: string[] } => {
        const calls: string[] = []
        const fetch: FetchLike = async (input, init) => {
            const request = new Request(input, init)
            const path = new URL(request.url).pathname
            calls.push(`${request.method} ${path}`)
            if (path === '/api/users') return Response.json([{ id: 1, name: 'Ada' }])
            if (path === '/api/search') return Response.json({ hits: [(await request.json()) as unknown] })
            if (path === '/api/missing') return Response.json({ message: 'Not found' }, { status: 404 })
            if (path === '/api/users/1') return new Response(null, { status: 204 })
            return new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })
        }
        return { fetch, calls }
    }

    it('records real answers, then replays them without the origin', async () => {
        const real = backend()
        const recorder = await createMock({ baseUrl: BASE, fetch: real.fetch, record: true, timing: 0 })
        const users = await recorder.fetch(`${BASE}/users`)
        expect(await users.json()).toEqual([{ id: 1, name: 'Ada' }])
        expect(await (await post(recorder.fetch, '/search', { q: 'ada', page: 1 })).json()).toEqual({ hits: [{ q: 'ada', page: 1 }] })
        expect((await recorder.fetch(`${BASE}/missing`)).status).toBe(404)
        expect((await recorder.fetch(`${BASE}/users/1`, { method: 'DELETE' })).status).toBe(204)
        expect(await (await recorder.fetch(`${BASE}/page`)).text()).toBe('<html></html>')
        expect(real.calls).toHaveLength(5)

        const recorded = recorder.recorded()
        expect(recorded).toEqual({
            'GET /users': [{ id: 1, name: 'Ada' }],
            [`POST /search #${bodyKey({ page: 1, q: 'ada' })}`]: { hits: [{ q: 'ada', page: 1 }] },
            'GET /missing': { $status: 404, $body: { message: 'Not found' } },
            'DELETE /users/1': { $status: 204 },
        })

        const replayed = backend()
        const mock = await createMock({ baseUrl: BASE, fetch: replayed.fetch, routes: JSON.parse(JSON.stringify(recorded)), unhandled: 'error', timing: 0 })
        expect(await (await mock.fetch(`${BASE}/users`)).json()).toEqual([{ id: 1, name: 'Ada' }])
        expect(await (await post(mock.fetch, '/search', { page: 1, q: 'ada' })).json()).toEqual({ hits: [{ q: 'ada', page: 1 }] })
        const missing = await mock.fetch(`${BASE}/missing`)
        expect(missing.status).toBe(404)
        expect(await missing.json()).toEqual({ message: 'Not found' })
        expect((await mock.fetch(`${BASE}/users/1`, { method: 'DELETE' })).status).toBe(204)
        expect((await post(mock.fetch, '/search', { q: 'other' })).status).toBe(501)
        expect(replayed.calls).toEqual([])
    })

    it('records and replays each query string apart', async () => {
        const teams: FetchLike = async input => Response.json([{ team: new URL(String(input instanceof Request ? input.url : input)).searchParams.get('team') }])
        const recorder = await createMock({ baseUrl: BASE, fetch: teams, record: true, timing: 0 })
        await recorder.fetch(`${BASE}/users?team=a&page=1`)
        await recorder.fetch(`${BASE}/users?team=b`)
        expect(recorder.recorded()).toEqual({ 'GET /users?page=1&team=a': [{ team: 'a' }], 'GET /users?team=b': [{ team: 'b' }] })
        const mock = await createMock({ baseUrl: BASE, fetch: origin, routes: recorder.recorded(), unhandled: 'error', timing: 0 })
        expect(await (await mock.fetch(`${BASE}/users?page=1&team=a`)).json()).toEqual([{ team: 'a' }])
        expect(await (await mock.fetch(`${BASE}/users?team=b`)).json()).toEqual([{ team: 'b' }])
        expect((await mock.fetch(`${BASE}/users?team=c`)).status).toBe(501)
    })

    it('sends calls outside the base url to the origin without recording them', async () => {
        const real = backend()
        const recorder = await createMock({ baseUrl: BASE, fetch: real.fetch, record: true, timing: 0 })
        await recorder.fetch('http://other.test/api/users')
        expect(real.calls).toEqual(['GET /api/users'])
        expect(recorder.recorded()).toEqual({})
    })

    it('forgets the recordings on reset', async () => {
        const recorder = await createMock({ baseUrl: BASE, fetch: backend().fetch, record: true, timing: 0 })
        await recorder.fetch(`${BASE}/users`)
        expect(Object.keys(recorder.recorded())).toEqual(['GET /users'])
        recorder.reset()
        expect(recorder.recorded()).toEqual({})
    })
})

describe('scenarios', () => {
    const config = {
        baseUrl: BASE,
        timing: 0,
        engine: rest(),
        seed: { users: [{ id: 1, name: 'Ada' }], tags: [{ id: 1, label: 'a' }] },
        routes: { 'GET /me': { id: 1 }, 'GET /health': { ok: true } },
        failures: [{ path: '/tags', status: 500 }],
        scenarios: {
            empty: { seed: { users: [] }, routes: { 'GET /me': { $status: 401, $body: { message: 'Unauthenticated.' } } }, failures: [] },
            routesOnly: { routes: { 'GET /health': { ok: false } } },
        },
    }

    it('merges the chosen scenario over the base config', async () => {
        const mock = await createMock({ ...config, scenario: 'empty' })
        expect(await (await mock.fetch(`${BASE}/users`)).json()).toEqual([])
        expect(await (await mock.fetch(`${BASE}/tags`)).json()).toEqual([{ id: 1, label: 'a' }])
        expect((await mock.fetch(`${BASE}/me`)).status).toBe(401)
        expect(await (await mock.fetch(`${BASE}/health`)).json()).toEqual({ ok: true })
        mock.reset()
        expect(await (await mock.fetch(`${BASE}/users`)).json()).toEqual([])
    })

    it('keeps the base failures when the scenario gives none', async () => {
        const mock = await createMock({ ...config, scenario: 'routesOnly' })
        expect(await (await mock.fetch(`${BASE}/health`)).json()).toEqual({ ok: false })
        expect((await mock.fetch(`${BASE}/tags`)).status).toBe(500)
        expect(await (await mock.fetch(`${BASE}/users`)).json()).toEqual([{ id: 1, name: 'Ada' }])
    })

    it('uses the base config without a scenario', async () => {
        const mock = await createMock(config)
        expect(await (await mock.fetch(`${BASE}/me`)).json()).toEqual({ id: 1 })
    })

    it('refuses an unknown scenario at creation', async () => {
        await expect(createMock({ ...config, scenario: 'nope' })).rejects.toThrow('Unknown scenario "nope"')
        await expect(createMock({ baseUrl: BASE, scenario: 'toString' })).rejects.toThrow('Unknown scenario "toString"')
    })
})
