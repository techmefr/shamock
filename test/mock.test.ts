import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createMock, installMock, setupMirageMock } from '../src/mock.ts'
import type { InstalledMock } from '../src/mock.ts'

const installed: InstalledMock[] = []

afterEach(() => {
    while (installed.length > 0) installed.pop()?.restore()
})

async function start(config: Parameters<typeof setupMirageMock>[0]): Promise<InstalledMock> {
    const server = await setupMirageMock(config)
    installed.push(server)
    return server
}

function send(method: string, url: string, body: unknown): Promise<Response> {
    return fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    })
}

const base = { baseUrl: 'http://api.test', timing: 0 }

describe('setupMirageMock', () => {
    it('serves search, mutate and delete under the url prefix', async () => {
        await start({
            baseUrl: 'http://api.test',
            timing: 0,
            seed: { users: [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bob' }] },
        })
        const search = await send('POST', 'http://api.test/users/search', {
            search: { filters: [{ field: 'name', operator: 'like', value: 'a%' }] },
        })
        expect(search.ok).toBe(true)
        expect(((await search.json()) as { data: unknown[] }).data).toEqual([{ id: '1', name: 'Ann' }])

        const created = await send('POST', 'http://api.test/users/mutate', {
            mutate: [{ operation: 'create', attributes: { id: 3, name: 'Cleo' } }],
        })
        expect(((await created.json()) as { data: unknown[] }).data[0]).toMatchObject({ name: 'Cleo' })

        expect((await send('DELETE', 'http://api.test/users', { resources: ['1'] })).ok).toBe(true)
        const after = await send('POST', 'http://api.test/users/search', {})
        expect(((await after.json()) as { data: { id: string }[] }).data.map(user => user.id)).toEqual(['2', '3'])
    })

    it('returns 422 on an invalid body', async () => {
        await start({ baseUrl: 'http://api.test', timing: 0, seed: { users: [] } })
        const response = await send('POST', 'http://api.test/users/mutate', 'not json')
        expect(response.status).toBe(422)
        expect(await response.json()).toEqual({ message: 'Invalid JSON body', errors: {} })
        expect((await send('DELETE', 'http://api.test/users', 'not json')).status).toBe(422)
    })

    it('does not pollute Object.prototype through a __proto__ key', async () => {
        await start({ baseUrl: 'http://api.test', timing: 0, seed: { users: [] } })
        await send(
            'POST',
            'http://api.test/users/mutate',
            '{"mutate":[{"operation":"create","attributes":{"__proto__":{"polluted":true},"name":"x"}}]}',
        )
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    })

    it('validates the seed through resources', async () => {
        const resources = { users: { schema: z.object({ id: z.number(), name: z.string() }) } }
        await expect(
            setupMirageMock({ baseUrl: 'http://api.test', timing: 0, resources, seed: { users: [{ id: 'x', name: 1 }] } }),
        ).rejects.toThrow()
        await start({ baseUrl: 'http://api.test', timing: 0, resources, seed: { users: [{ id: 1, name: 'A' }] } })
    })
})

describe('installMock', () => {
    it('restore puts the original fetch back', async () => {
        const before = globalThis.fetch
        const mock = await installMock({ ...base, seed: { users: [] } })
        expect(globalThis.fetch).not.toBe(before)
        mock.restore()
        expect(globalThis.fetch).toBe(before)
    })

    it('shutdown is an alias of restore', async () => {
        const before = globalThis.fetch
        const mock = await setupMirageMock({ ...base, seed: { users: [] } })
        mock.shutdown()
        expect(globalThis.fetch).toBe(before)
    })

    it('forwards requests outside baseUrl to the original fetch', async () => {
        const calls: string[] = []
        const before = globalThis.fetch
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            calls.push(String(input))
            return new Response('real')
        }) as typeof fetch
        try {
            const mock = await installMock({ ...base, seed: { users: [] } })
            const response = await fetch('http://other.test/ping')
            expect(await response.text()).toBe('real')
            expect(calls).toEqual(['http://other.test/ping'])
            mock.restore()
        } finally {
            globalThis.fetch = before
        }
    })

    it('two successive installs do not leak state', async () => {
        const before = globalThis.fetch
        const first = await installMock({ ...base, seed: { users: [{ name: 'A' }] } })
        await send('POST', 'http://api.test/users/mutate', { mutate: [{ operation: 'create', attributes: { name: 'B' } }] })
        first.restore()
        const second = await installMock({ ...base, seed: { users: [{ name: 'Z' }] } })
        const list = await send('POST', 'http://api.test/users/search', {})
        expect(((await list.json()) as { data: { name: string }[] }).data.map(user => user.name)).toEqual(['Z'])
        second.restore()
        expect(globalThis.fetch).toBe(before)
    })
})

describe('createMock', () => {
    it('provides a mocked fetch without touching the global', async () => {
        const before = globalThis.fetch
        const mock = await createMock({ ...base, seed: { users: [{ id: 1, name: 'Ann' }] } })
        expect(globalThis.fetch).toBe(before)
        const response = await mock.fetch('http://api.test/users/search', { method: 'POST', body: '{}' })
        expect(((await response.json()) as { data: unknown[] }).data).toEqual([{ id: '1', name: 'Ann' }])
    })

    it('handle takes a Request directly', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const response = await mock.handle(new Request('http://api.test/users/search', { method: 'POST', body: '{}' }))
        expect(response.status).toBe(200)
    })

    it('mutate creates with auto ids then updates by key', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1, name: 'Ann' }] } })
        const post = async (path: string, body: unknown): Promise<{ data: Record<string, unknown>[] }> => {
            const response = await mock.fetch(`http://api.test/users/${path}`, { method: 'POST', body: JSON.stringify(body) })
            return (await response.json()) as { data: Record<string, unknown>[] }
        }
        const created = await post('mutate', { mutate: [{ operation: 'create', attributes: { name: 'Bob' } }] })
        expect(created.data[0]).toEqual({ id: '2', name: 'Bob' })
        const updated = await post('mutate', { mutate: [{ operation: 'update', key: 2, attributes: { name: 'Bobby' } }] })
        expect(updated.data[0]).toEqual({ id: '2', name: 'Bobby' })
        expect((await post('search', {})).data).toHaveLength(2)
    })

    it('deletes by id and returns 404 for unknown resources', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }, { id: 2 }] } })
        const del = await mock.fetch('http://api.test/users', { method: 'DELETE', body: JSON.stringify({ resources: [1] }) })
        expect(del.status).toBe(200)
        const list = await mock.fetch('http://api.test/users/search', { method: 'POST', body: '{}' })
        expect(((await list.json()) as { data: unknown[] }).data).toEqual([{ id: '2' }])
        expect((await mock.fetch('http://api.test/nope/search', { method: 'POST', body: '{}' })).status).toBe(404)
    })

    it('paginates search results', async () => {
        const seed = { users: Array.from({ length: 5 }, (_, index) => ({ id: index + 1 })) }
        const mock = await createMock({ ...base, seed })
        const response = await mock.fetch('http://api.test/users/search', {
            method: 'POST',
            body: JSON.stringify({ page: 2, limit: 2 }),
        })
        const result = (await response.json()) as { data: { id: string }[]; meta?: { total: number } }
        expect(result.data.map(user => user.id)).toEqual(['3', '4'])
        expect(result.meta?.total).toBe(5)
    })
})
