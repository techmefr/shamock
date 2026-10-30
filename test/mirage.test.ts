import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { setupMirageMock } from '../src/mirage.ts'

interface TestServer {
    shutdown: () => void
}

const servers: TestServer[] = []

beforeAll(() => {
    Object.assign(globalThis, { window: globalThis, self: globalThis, XMLHttpRequest: class {} })
})

afterEach(() => {
    while (servers.length > 0) servers.pop()?.shutdown()
})

async function start(config: Parameters<typeof setupMirageMock>[0]): Promise<TestServer> {
    const server = (await setupMirageMock(config)) as TestServer
    servers.push(server)
    return server
}

function send(method: string, url: string, body: unknown): Promise<Response> {
    return fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    })
}

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
        expect((await send('POST', 'http://api.test/users/mutate', 'not json')).status).toBe(422)
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
