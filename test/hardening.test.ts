import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createMock, installMock } from '../src/mock.ts'
import type { FetchLike } from '../src/mock.ts'
import { MAX_ROWS } from '../src/store.ts'

const base = { baseUrl: 'http://api.test', timing: 0 }

const post = (mock: { fetch: FetchLike }, path: string, body: unknown = {}): Promise<Response> =>
    mock.fetch(`http://api.test/${path}`, { method: 'POST', body: JSON.stringify(body) })

const remove = (mock: { fetch: FetchLike }, body: unknown): Promise<Response> =>
    mock.fetch('http://api.test/users', { method: 'DELETE', body: JSON.stringify(body) })

const rows = async (response: Response): Promise<Record<string, unknown>[]> =>
    ((await response.json()) as { data: Record<string, unknown>[] }).data

const create = (attributes: unknown): unknown => ({ operation: 'create', attributes })

describe('auto increment near the safe integer limit', () => {
    it('answers 422 instead of looping forever', { timeout: 5000 }, async () => {
        const mock = await createMock({
            ...base,
            seed: { users: [{ id: 9007199254740991 }, { id: 9007199254740993 }] },
        })
        const response = await post(mock, 'users/mutate', { mutate: [{ attributes: {} }] })
        expect(response.status).toBe(422)
        expect(((await response.json()) as { message: string }).message).toContain('No id available')
    })

    it('answers 422 when the raw body carries ids above 2^53', { timeout: 5000 }, async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const body =
            '{"mutate":[{"operation":"create","attributes":{"id":9007199254740991}},{"operation":"create","attributes":{"id":9007199254740993}},{"operation":"create","attributes":{}}]}'
        const response = await mock.fetch('http://api.test/users/mutate', { method: 'POST', body })
        expect(response.status).toBe(422)
    })
})

describe('atomicity', () => {
    it('changes nothing when a mutate batch fails halfway', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1, name: 'Ann' }] } })
        const duplicate = await post(mock, 'users/mutate', {
            mutate: [create({ id: 'a' }), create({ id: 'a' })],
        })
        expect(duplicate.status).toBe(422)
        const mixed = await post(mock, 'users/mutate', {
            mutate: [{ operation: 'update', key: 1, attributes: { name: 'Changed' } }, create({ id: { bad: 1 } })],
        })
        expect(mixed.status).toBe(422)
        const unsupported = await post(mock, 'users/mutate', { mutate: [create({ id: 'b' }), { operation: 'delete', key: 1 }] })
        expect(unsupported.status).toBe(422)
        expect(await rows(await post(mock, 'users/search'))).toEqual([{ id: 1, name: 'Ann' }])
    })

    it('keeps the auto increment counter after a failed batch', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        await post(mock, 'users/mutate', { mutate: [create({}), create({}), create({ id: 'x' }), create({ id: 'x' })] })
        expect((await rows(await post(mock, 'users/mutate', { mutate: [create({})] })))[0]?.['id']).toBe('1')
    })

    it('removes nothing when a delete contains an invalid id', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }, { id: 2 }] } })
        expect((await remove(mock, { resources: [1, 2, {}] })).status).toBe(422)
        expect(await rows(await post(mock, 'users/search'))).toEqual([{ id: 1 }, { id: 2 }])
    })
})

describe('mutate payloads', () => {
    it('answers 422 for an unsupported operation without creating anything', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        const response = await post(mock, 'users/mutate', { mutate: [{ operation: 'delete', key: 1 }] })
        expect(response.status).toBe(422)
        expect(await response.json()).toEqual({ message: 'Unsupported operation', errors: {} })
        expect(await rows(await post(mock, 'users/search'))).toEqual([{ id: 1 }])
    })

    it.each([[{ mutate: 'x' }], [{ mutate: {} }], [{ mutate: [1] }], [{ mutate: [null] }], [{ mutate: [[]] }]])(
        'answers 422 for %j',
        async body => {
            const mock = await createMock({ ...base, seed: { users: [] } })
            expect((await post(mock, 'users/mutate', body)).status).toBe(422)
        },
    )

    it('keeps constructor and prototype attributes without polluting anything', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const body = '{"mutate":[{"operation":"create","attributes":{"__proto__":{"polluted":1},"constructor":{"x":1},"prototype":2}}]}'
        const response = await mock.fetch('http://api.test/users/mutate', { method: 'POST', body })
        const [record] = await rows(response)
        expect(record).toEqual({ id: '1', constructor: { x: 1 }, prototype: 2 })
        expect(Object.getPrototypeOf(record)).toBe(Object.prototype)
        expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
        expect(({} as Record<string, unknown>)['x']).toBeUndefined()
        const stored = (await rows(await post(mock, 'users/search')))[0]
        expect(Object.getPrototypeOf(stored)).toBe(Object.prototype)
        expect(stored).toEqual({ id: '1', constructor: { x: 1 }, prototype: 2 })
    })
})

describe('ids keep their type', () => {
    it('keeps numeric and string ids and filters them as text', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }, { id: 'b' }] } })
        expect(await rows(await post(mock, 'users/search'))).toEqual([{ id: 1 }, { id: 'b' }])
        const equal = await post(mock, 'users/search', { filters: [{ field: 'id', operator: '=', value: 1 }] })
        expect(await rows(equal)).toEqual([{ id: 1 }])
        const text = await post(mock, 'users/search', { filters: [{ field: 'id', operator: 'in', value: ['1', 'b'] }] })
        expect(await rows(text)).toHaveLength(2)
    })

    it('agrees with a z.number() id schema', async () => {
        const resources = { users: { schema: z.object({ id: z.number() }) } }
        const mock = await createMock({ ...base, seed: { users: [{ id: 5 }] }, resources })
        const parsed = resources.users.schema.safeParse((await rows(await post(mock, 'users/search')))[0])
        expect(parsed.success).toBe(true)
    })

    it('updates and deletes a numeric id by string or number key', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1, a: 0 }, { id: 2 }] } })
        const update = await post(mock, 'users/mutate', { mutate: [{ operation: 'update', key: '1', attributes: { a: 1 } }] })
        expect(await rows(update)).toEqual([{ id: 1, a: 1 }])
        await remove(mock, { resources: ['2'] })
        expect(await rows(await post(mock, 'users/search'))).toEqual([{ id: 1, a: 1 }])
    })
})

describe('body limits', () => {
    it('answers 413 from the content-length header before reading', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const request = new Request('http://api.test/users/search', {
            method: 'POST',
            body: '{}',
            headers: { 'content-length': '5000000' },
        })
        let read = false
        request.text = async () => {
            read = true
            return '{}'
        }
        expect((await mock.handle(request)).status).toBe(413)
        expect(read).toBe(false)
    })

    it('counts bytes, not characters', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const big = JSON.stringify({ filler: '€'.repeat(400_000) })
        expect(big.length).toBeLessThan(1_000_000)
        expect((await mock.fetch('http://api.test/users/search', { method: 'POST', body: big })).status).toBe(413)
    })

    it('answers 422 when the store would exceed the maximum number of records', async () => {
        const seed = { users: Array.from({ length: MAX_ROWS }, (_, index) => ({ id: index })) }
        const mock = await createMock({ ...base, seed })
        const response = await post(mock, 'users/mutate', { mutate: [create({})] })
        expect(response.status).toBe(422)
        expect(await rows(await post(mock, 'users/search'))).toHaveLength(MAX_ROWS)
    })

    it('rejects a seed above the maximum number of records', async () => {
        const seed = { users: Array.from({ length: MAX_ROWS + 1 }, (_, index) => ({ id: index })) }
        await expect(createMock({ ...base, seed })).rejects.toThrow('Too many records')
    })

    it('answers 422 for oversized search filters', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const filters = Array.from({ length: 101 }, () => ({ field: 'id', value: 1 }))
        expect((await post(mock, 'users/search', { filters })).status).toBe(422)
        const pattern = 'a'.repeat(257)
        expect((await post(mock, 'users/search', { filters: [{ field: 'n', operator: 'like', value: pattern }] })).status).toBe(422)
    })
})

describe('abort after reading the body', () => {
    it('does not apply a mutation or a delete once aborted', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        const controller = new AbortController()
        const pending = mock.fetch('http://api.test/users/mutate', {
            method: 'POST',
            body: JSON.stringify({ mutate: [create({ id: 2 })] }),
            signal: controller.signal,
        })
        controller.abort('stop')
        await expect(pending).rejects.toBe('stop')
        const second = new AbortController()
        const deletion = mock.fetch('http://api.test/users', {
            method: 'DELETE',
            body: JSON.stringify({ resources: [1] }),
            signal: second.signal,
        })
        second.abort('stop')
        await expect(deletion).rejects.toBe('stop')
        expect(await rows(await post(mock, 'users/search'))).toEqual([{ id: 1 }])
    })
})

describe('search bodies and 404 shape', () => {
    it('answers 422 for invalid non-empty JSON and lists everything for an empty body', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        for (const body of ['{', '[1]', '3', 'null']) {
            const response = await mock.fetch('http://api.test/users/search', { method: 'POST', body })
            expect(response.status).toBe(422)
            expect(await response.json()).toEqual({ message: 'Invalid JSON body', errors: {} })
        }
        expect(await rows(await mock.fetch('http://api.test/users/search', { method: 'POST', body: '' }))).toEqual([{ id: 1 }])
    })

    it('answers every 404 with message and errors', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const responses = [
            await mock.fetch('http://api.test/nope/search', { method: 'POST' }),
            await mock.fetch('http://api.test/users'),
            await mock.handle(new Request('http://other.test/users/search', { method: 'POST' })),
        ]
        for (const response of responses) {
            expect(response.status).toBe(404)
            expect(await response.json()).toEqual({ message: 'Not found', errors: {} })
        }
    })

    it('decodes the action like the resource name', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        expect(await rows(await post(mock, 'users/sea%72ch'))).toEqual([{ id: 1 }])
    })
})

describe('config validation', () => {
    it('throws when a resource has no seed entry', async () => {
        const resources = { users: { schema: z.object({}) }, posts: { schema: z.object({}) } }
        await expect(createMock({ ...base, seed: { users: [] }, resources })).rejects.toThrow('"posts"')
    })

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 60_001])('throws for the timing %s', async timing => {
        await expect(createMock({ ...base, timing, seed: { users: [] } })).rejects.toThrow('Invalid timing')
    })

    it('accepts the timing bounds', async () => {
        await createMock({ ...base, timing: 0, seed: { users: [] } })
        await createMock({ ...base, timing: 60_000, seed: { users: [] } })
    })
})

describe('restore with a third-party wrapper on top', () => {
    const original = globalThis.fetch

    afterEach(() => {
        globalThis.fetch = original
    })

    it('keeps the wrapper in place and stops serving the mock', async () => {
        globalThis.fetch = (async () => new Response('real')) as typeof fetch
        const mock = await installMock({ ...base, seed: { users: [{ id: 1 }] } })
        const calls: string[] = []
        const underneath = globalThis.fetch
        const wrapper = (async (input: RequestInfo | URL, init?: RequestInit) => {
            calls.push(String(input))
            return underneath(input, init)
        }) as typeof fetch
        globalThis.fetch = wrapper
        expect(await (await fetch('http://api.test/users/search', { method: 'POST' })).json()).toEqual({ data: [{ id: 1 }] })
        mock.restore()
        expect(globalThis.fetch).toBe(wrapper)
        expect(await (await fetch('http://api.test/users/search', { method: 'POST' })).text()).toBe('real')
        expect(calls).toHaveLength(2)
    })
})
