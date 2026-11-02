import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { isMockEnabled } from '../src/enabled.ts'
import { createMock, installMock } from '../src/mock.ts'

const original = globalThis.fetch

afterEach(() => {
    globalThis.fetch = original
})

const search = (client: typeof fetch, url: string): Promise<Response> => client(url, { method: 'POST', body: '{}' })

const rows = async (response: Response): Promise<unknown[]> => ((await response.json()) as { data: unknown[] }).data

const listen = (handler: Parameters<typeof createServer>[1]): Promise<Server> =>
    new Promise(resolve => {
        const server = createServer(handler)
        server.listen(0, '127.0.0.1', () => resolve(server))
    })

const close = (server: Server): Promise<void> => new Promise(resolve => server.close(() => resolve()))

const originOf = (server: Server): string => `http://127.0.0.1:${(server.address() as AddressInfo).port}`

describe('isMockEnabled', () => {
    it.each(['1', 'true', 'TRUE', 'On', 'yes', ' YES '])('reads %s as true', value => {
        expect(isMockEnabled({ SHAMOCK: value })).toBe(true)
    })

    it.each(['0', 'false', 'off', 'no', '', 'maybe', undefined, null, {}])('reads %s as false', value => {
        expect(isMockEnabled({ SHAMOCK: value })).toBe(false)
    })

    it('accepts booleans', () => {
        expect(isMockEnabled({ SHAMOCK: true })).toBe(true)
        expect(isMockEnabled({ SHAMOCK: false })).toBe(false)
    })

    it('is false when the variable is absent', () => {
        expect(isMockEnabled({})).toBe(false)
    })

    it('reads a custom variable', () => {
        expect(isMockEnabled({ VITE_SHAMOCK: 'true' }, 'VITE_SHAMOCK')).toBe(true)
        expect(isMockEnabled({ VITE_SHAMOCK: 'true' })).toBe(false)
    })

    it('falls back to process.env', () => {
        process.env['SHAMOCK_TEST_SWITCH'] = 'yes'
        try {
            expect(isMockEnabled(undefined, 'SHAMOCK_TEST_SWITCH')).toBe(true)
            expect(isMockEnabled(undefined, 'SHAMOCK_TEST_MISSING')).toBe(false)
        } finally {
            delete process.env['SHAMOCK_TEST_SWITCH']
        }
    })
})

describe('enabled: false', () => {
    const config = { baseUrl: 'http://a.test', timing: 0, seed: { users: [{ id: 1 }] } }

    it('does not touch the global fetch on install', async () => {
        const mock = await installMock({ ...config, enabled: false })
        expect(globalThis.fetch).toBe(original)
        expect(() => mock.restore()).not.toThrow()
        expect(globalThis.fetch).toBe(original)
    })

    it('delegates mock.fetch to the passthrough fetch', async () => {
        const calls: string[] = []
        const passthrough = (async (input: RequestInfo | URL) => {
            calls.push(String(input))
            return new Response('real')
        }) as typeof fetch
        const mock = await createMock({ ...config, enabled: false, fetch: passthrough })
        expect(await (await search(mock.fetch, 'http://a.test/users/search')).text()).toBe('real')
        expect(calls).toEqual(['http://a.test/users/search'])
    })

    it('delegates to the captured globalThis.fetch by default', async () => {
        const calls: string[] = []
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            calls.push(String(input))
            return new Response('captured')
        }) as typeof fetch
        const mock = await createMock({ ...config, enabled: false })
        expect(await (await search(mock.fetch, 'http://a.test/users/search')).text()).toBe('captured')
        expect(calls).toHaveLength(1)
    })

    it('answers handle with the real fetch', async () => {
        const mock = await createMock({
            ...config,
            enabled: false,
            fetch: (async () => new Response('real', { status: 202 })) as typeof fetch,
        })
        const response = await mock.handle(new Request('http://a.test/users/search', { method: 'POST' }))
        expect(response.status).toBe(202)
    })

    it('keeps reset as a no-op', async () => {
        const mock = await createMock({ ...config, enabled: false })
        expect(() => mock.reset()).not.toThrow()
    })

    it('mocks when enabled is true or omitted', async () => {
        for (const enabled of [true, undefined]) {
            const mock = await createMock({ ...config, enabled })
            expect(await rows(await search(mock.fetch, 'http://a.test/users/search'))).toEqual([{ id: 1 }])
        }
    })
})

describe('resources[name].mock', () => {
    it('sends a resource set to false to the real network and mocks the others in the same client', async () => {
        const seen: string[] = []
        const server = await listen((request, response) => {
            seen.push(`${request.method} ${request.url}`)
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ data: [{ id: 99, from: 'server' }] }))
        })
        try {
            const base = originOf(server)
            await installMock({
                baseUrl: base,
                timing: 0,
                seed: { orders: [{ id: 1, from: 'seed' }], users: [] },
                resources: { users: { mock: false } },
            })
            expect(await rows(await search(fetch, `${base}/orders/search`))).toEqual([{ id: 1, from: 'seed' }])
            expect(await rows(await search(fetch, `${base}/users/search`))).toEqual([{ id: 99, from: 'server' }])
            expect(seen).toEqual(['POST /users/search'])
        } finally {
            await close(server)
        }
    })

    it('does not need a seed entry for a resource set to false', async () => {
        const mock = await createMock({
            baseUrl: 'http://a.test',
            timing: 0,
            seed: { orders: [{ id: 1 }] },
            resources: { users: { mock: false } },
        })
        const calls: string[] = []
        const passthrough = (async (input: RequestInfo | URL) => {
            calls.push(String(input))
            return new Response('real')
        }) as typeof fetch
        const forwarded = await createMock({
            baseUrl: 'http://a.test',
            timing: 0,
            seed: { orders: [{ id: 1 }] },
            resources: { users: { mock: false } },
            fetch: passthrough,
        })
        expect(await (await search(forwarded.fetch, 'http://a.test/users/search')).text()).toBe('real')
        expect(await rows(await search(mock.fetch, 'http://a.test/orders/search'))).toEqual([{ id: 1 }])
        expect(calls).toEqual(['http://a.test/users/search'])
    })

    it('still throws for a mocked resource missing from the seed', async () => {
        await expect(
            createMock({ baseUrl: 'http://a.test', seed: {}, resources: { users: { mock: true } } }),
        ).rejects.toThrow('Resource "users" has no entry in seed')
    })

    it('mocks a resource set to true like the default', async () => {
        const mock = await createMock({
            baseUrl: 'http://a.test',
            timing: 0,
            seed: { users: [{ id: 1 }] },
            resources: { users: { mock: true } },
        })
        expect(await rows(await search(mock.fetch, 'http://a.test/users/search'))).toEqual([{ id: 1 }])
    })

    it('restores cleanly after a mixed run', async () => {
        const mock = await installMock({
            baseUrl: 'http://a.test',
            timing: 0,
            seed: { users: [] },
            resources: { users: { mock: false } },
        })
        mock.restore()
        expect(globalThis.fetch).toBe(original)
    })
})

describe('reset', () => {
    const config = {
        baseUrl: 'http://a.test',
        timing: 0,
        seed: { users: [{ id: 1, name: 'Ann' }] },
        failures: [{ path: '/users/search', status: 503, times: 1 }],
    }

    const mutate = (client: typeof fetch, body: unknown): Promise<Response> =>
        client('http://a.test/users/mutate', { method: 'POST', body: JSON.stringify(body) })

    it('restores the seed after writes and deletes', async () => {
        const mock = await createMock({ baseUrl: config.baseUrl, timing: 0, seed: config.seed })
        await mutate(mock.fetch, { mutate: [{ operation: 'create', attributes: { name: 'Bob' } }] })
        await mock.fetch('http://a.test/users', { method: 'DELETE', body: JSON.stringify({ resources: [1] }) })
        expect(await rows(await search(mock.fetch, 'http://a.test/users/search'))).toEqual([{ id: 2, name: 'Bob' }])
        mock.reset()
        expect(await rows(await search(mock.fetch, 'http://a.test/users/search'))).toEqual([{ id: 1, name: 'Ann' }])
    })

    it('rewinds failure counters', async () => {
        const mock = await createMock(config)
        expect((await search(mock.fetch, 'http://a.test/users/search')).status).toBe(503)
        expect((await search(mock.fetch, 'http://a.test/users/search')).status).toBe(200)
        mock.reset()
        expect((await search(mock.fetch, 'http://a.test/users/search')).status).toBe(503)
    })

    it('is available on an installed mock', async () => {
        const mock = await installMock({ baseUrl: config.baseUrl, timing: 0, seed: config.seed })
        await mutate(fetch, { mutate: [{ operation: 'update', key: 1, attributes: { name: 'Zed' } }] })
        mock.reset()
        expect(await rows(await search(fetch, 'http://a.test/users/search'))).toEqual([{ id: 1, name: 'Ann' }])
        mock.restore()
    })

    it('does not leak the seed objects between resets', async () => {
        const seed = { users: [{ id: 1, name: 'Ann' }] }
        const mock = await createMock({ baseUrl: 'http://a.test', timing: 0, seed })
        await mutate(mock.fetch, { mutate: [{ operation: 'update', key: 1, attributes: { name: 'Zed' } }] })
        mock.reset()
        mock.reset()
        expect(await rows(await search(mock.fetch, 'http://a.test/users/search'))).toEqual([{ id: 1, name: 'Ann' }])
        expect(seed.users).toEqual([{ id: 1, name: 'Ann' }])
    })
})

describe('isolation between tests', () => {
    const seed = { todos: [{ id: 1, title: 'seed' }] }
    const shared = createMock({ baseUrl: 'http://a.test', timing: 0, seed })

    const titles = async (client: typeof fetch): Promise<unknown[]> =>
        (await rows(await search(client, 'http://a.test/todos/search'))).map(row => (row as { title: string }).title)

    const add = (client: typeof fetch): Promise<Response> =>
        client('http://a.test/todos/mutate', {
            method: 'POST',
            body: JSON.stringify({ mutate: [{ operation: 'create', attributes: { title: 'extra' } }] }),
        })

    it('writes in a first test', async () => {
        const mock = await shared
        mock.reset()
        await add(mock.fetch)
        expect(await titles(mock.fetch)).toEqual(['seed', 'extra'])
    })

    it('sees the seed again after reset in a second test', async () => {
        const mock = await shared
        mock.reset()
        expect(await titles(mock.fetch)).toEqual(['seed'])
    })

    it('gets a fresh instance per test with createMock', async () => {
        const first = await createMock({ baseUrl: 'http://a.test', timing: 0, seed })
        await add(first.fetch)
        const second = await createMock({ baseUrl: 'http://a.test', timing: 0, seed })
        expect(await titles(second.fetch)).toEqual(['seed'])
    })
})
