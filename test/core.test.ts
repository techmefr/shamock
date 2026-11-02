import { afterEach, describe, expect, it } from 'vitest'
import { createMock, HttpError, installMock } from '../src/core.ts'
import type { Engine, FetchLike, InstalledMock } from '../src/core.ts'
import { echoEngine } from './engine-contract.ts'

const BASE = 'http://api.test'

const origin: FetchLike = async () => new Response('real', { status: 200 })

describe('core with a custom engine', () => {
    it('hands the context to the engine and serves its response', async () => {
        const mock = await createMock({ baseUrl: BASE, seed: { users: [{ id: 1, name: 'Ada' }] }, engine: echoEngine(), timing: 0 })
        const created = await mock.fetch(`${BASE}/users`, { method: 'POST', body: JSON.stringify({ name: 'Grace' }) })
        expect(created.status).toBe(201)
        expect(await created.json()).toEqual({ name: 'Grace', id: 2 })
        expect(await (await mock.fetch(`${BASE}/users`)).json()).toHaveLength(2)
    })

    it('reports a resource without a seed entry', async () => {
        await expect(createMock({ baseUrl: BASE, seed: {}, engine: echoEngine(), resources: { users: {} } })).rejects.toThrow('no entry in seed')
    })

    it('calls validate and normalize from the engine', async () => {
        const seen: string[][] = []
        const engine: Engine = { ...echoEngine(), validate: ({ names }) => void seen.push(names), normalize: attributes => ({ ...attributes, seen: true }) }
        const mock = await createMock({ baseUrl: BASE, seed: { users: [{ id: 1 }] }, engine, timing: 0 })
        expect(seen).toEqual([['users']])
        expect(await (await mock.fetch(`${BASE}/users`)).json()).toEqual([{ id: 1, seen: true }])
    })

    it('answers an HttpError thrown by the engine as json', async () => {
        const engine: Engine = {
            match: () => ({ resource: 'users' }),
            handle: () => {
                throw new HttpError(409, 'conflict', { name: ['taken'] })
            },
        }
        const mock = await createMock({ baseUrl: BASE, seed: { users: [] }, engine, timing: 0 })
        const response = await mock.fetch(`${BASE}/users`)
        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({ message: 'conflict', errors: { name: ['taken'] } })
    })
})

describe('core without any engine', () => {
    let installed: InstalledMock | undefined
    const real = globalThis.fetch

    afterEach(() => {
        installed?.restore()
        installed = undefined
        expect(globalThis.fetch).toBe(real)
    })

    it('answers static json per route with no state and no protocol', async () => {
        const mock = await createMock({
            baseUrl: `${BASE}/api`,
            timing: 0,
            fetch: origin,
            routes: { 'GET /users': [{ id: 1 }], 'POST /login': { token: 'abc' }, '/ping': 'pong' },
        })
        expect(await (await mock.fetch(`${BASE}/api/users`)).json()).toEqual([{ id: 1 }])
        expect(await (await mock.fetch(`${BASE}/api/login`, { method: 'POST' })).json()).toEqual({ token: 'abc' })
        expect(await (await mock.fetch(`${BASE}/api/ping`, { method: 'DELETE' })).json()).toBe('pong')
        expect(await (await mock.fetch(`${BASE}/api/users/`)).json()).toEqual([{ id: 1 }])
    })

    it('lets a function build the response, status included', async () => {
        const mock = await createMock({
            baseUrl: BASE,
            timing: 0,
            routes: {
                '/echo': async (request: Request, path: string) => ({ method: request.method, path }),
                'GET /gone': () => new Response('{"message":"gone"}', { status: 410 }),
            },
        })
        expect(await (await mock.fetch(`${BASE}/echo`, { method: 'PUT' })).json()).toEqual({ method: 'PUT', path: '/echo' })
        expect((await mock.fetch(`${BASE}/gone`)).status).toBe(410)
    })

    it('sends unmatched requests to the real fetch and answers 404 through handle', async () => {
        const mock = await createMock({ baseUrl: BASE, timing: 0, fetch: origin, routes: { 'GET /users': [] } })
        expect(await (await mock.fetch(`${BASE}/orders`)).text()).toBe('real')
        expect(await (await mock.fetch(`${BASE}/users`, { method: 'POST' })).text()).toBe('real')
        expect((await mock.handle(new Request(`${BASE}/orders`))).status).toBe(404)
    })

    it('applies failures to static routes', async () => {
        const mock = await createMock({ baseUrl: BASE, timing: 0, routes: { '/users': [] }, failures: [{ path: '/users', times: 1, status: 500 }] })
        expect((await mock.fetch(`${BASE}/users`)).status).toBe(500)
        expect((await mock.fetch(`${BASE}/users`)).status).toBe(200)
    })

    it('installs on the global fetch and restores it', async () => {
        installed = await installMock({ baseUrl: BASE, timing: 0, routes: { '/health': { ok: true } } })
        expect(await (await fetch(`${BASE}/health`)).json()).toEqual({ ok: true })
    })

    it('is inert when disabled', async () => {
        const mock = await createMock({ baseUrl: BASE, enabled: false, fetch: origin, routes: { '/users': [] } })
        expect(await (await mock.fetch(`${BASE}/users`)).text()).toBe('real')
    })

    it('rejects a malformed route key', async () => {
        await expect(createMock({ baseUrl: BASE, routes: { users: [] } })).rejects.toThrow('Invalid route')
    })
})
