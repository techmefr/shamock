import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMock, installMock } from '../src/mock.ts'
import type { FetchLike } from '../src/mock.ts'

const base = { baseUrl: 'http://api.test', timing: 0 }

const post = (mock: { fetch: FetchLike }, path: string, body: unknown = {}): Promise<Response> =>
    mock.fetch(`http://api.test/${path}`, { method: 'POST', body: JSON.stringify(body) })

const rows = async (response: Response): Promise<Record<string, unknown>[]> =>
    ((await response.json()) as { data: Record<string, unknown>[] }).data

afterEach(() => {
    vi.useRealTimers()
})

describe('resource names', () => {
    it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('handles a resource named %s', async name => {
        const seed = JSON.parse(`{"${name}":[{"id":1}]}`) as Record<string, Record<string, unknown>[]>
        const resources = { users: { schema: z.object({ id: z.number() }) } }
        const mock = await createMock({ ...base, seed, resources })
        expect(await rows(await post(mock, `${name}/search`))).toEqual([{ id: '1' }])
        expect((await post(mock, 'users/search')).status).toBe(404)
        expect(Object.hasOwn(Object.prototype, 'id')).toBe(false)
    })

    it('does not use inherited resources for validation', async () => {
        const mock = await createMock({ ...base, seed: { constructor: [{ id: 1 }] }, resources: {} })
        expect(await rows(await post(mock, 'constructor/search'))).toEqual([{ id: '1' }])
    })

    it('answers 404 for inherited names that are not resources', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        for (const name of ['constructor', 'toString', '__proto__']) {
            expect((await post(mock, `${name}/search`)).status).toBe(404)
        }
    })

    it('fixes the behavior for special characters in names', async () => {
        const names = ['my users', 'é', 'a/b', '[x]']
        const mock = await createMock({ ...base, seed: Object.fromEntries(names.map(name => [name, [{ id: 1, name }]])) })
        for (const name of names) {
            expect(await rows(await post(mock, `${encodeURIComponent(name)}/search`))).toEqual([{ id: '1', name }])
        }
        expect((await post(mock, 'a/b/search')).status).toBe(404)
    })
})

describe('ids', () => {
    const create = (mock: { fetch: FetchLike }, attributes: unknown): Promise<Response> =>
        post(mock, 'users/mutate', { mutate: [{ operation: 'create', attributes }] })

    it('rejects a create with an existing id', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1, name: 'Ann' }] } })
        const response = await create(mock, { id: '1', name: 'Dup' })
        expect(response.status).toBe(422)
        expect(((await response.json()) as { message: string }).message).toContain('already exists')
        expect(await rows(await post(mock, 'users/search'))).toEqual([{ id: '1', name: 'Ann' }])
    })

    it.each([[{ a: 1 }], [[1]], [true], ['']])('rejects the id %j', async id => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        expect((await create(mock, { id })).status).toBe(422)
    })

    it('rejects an invalid key on update and delete', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        const update = await post(mock, 'users/mutate', { mutate: [{ operation: 'update', key: { a: 1 }, attributes: {} }] })
        expect(update.status).toBe(422)
        const del = await mock.fetch('http://api.test/users', { method: 'DELETE', body: JSON.stringify({ resources: [{}] }) })
        expect(del.status).toBe(422)
    })

    it('auto increment skips ids that already exist', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 'x' }, { id: '2' }] } })
        expect((await rows(await create(mock, {})))[0]?.['id']).toBe('3')
        expect((await rows(await create(mock, {})))[0]?.['id']).toBe('4')
        expect(await rows(await post(mock, 'users/search'))).toHaveLength(4)
    })

    it('auto increment fills the gap before an explicit id only when free', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        await create(mock, { id: 2 })
        expect((await rows(await create(mock, {})))[0]?.['id']).toBe('3')
    })

    it('ignores unsafe numeric ids for the counter', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 10 }, { id: 1e21 }] } })
        expect((await rows(await create(mock, {})))[0]?.['id']).toBe('11')
    })

    it('fails clearly when no integer id is left', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: Number.MAX_SAFE_INTEGER }] } })
        expect((await create(mock, {})).status).toBe(422)
    })

    it('rejects a seed with duplicate ids', async () => {
        await expect(createMock({ ...base, seed: { users: [{ id: 1 }, { id: '1' }] } })).rejects.toThrow('already exists')
    })
})

describe('search validation', () => {
    it.each([
        [{ filters: 'x' }],
        [{ filters: [null] }],
        [{ filters: ['a'] }],
        [{ filters: [{ field: 1 }] }],
        [{ filters: [{ nested: 'x' }] }],
        [{ filters: [{ nested: [null] }] }],
        [{ sorts: {} }],
        [{ sorts: [1] }],
        [{ sorts: [{ field: 3 }] }],
    ])('answers 422 for %j', async body => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        const response = await post(mock, 'users/search', body)
        expect(response.status).toBe(422)
        expect(((await response.json()) as { message: string }).message).toContain('Invalid search')
    })

    it('answers 422 for too deeply nested filters', async () => {
        let filters: unknown[] = [{ field: 'id', value: 1 }]
        for (let depth = 0; depth < 30; depth++) filters = [{ nested: filters }]
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        expect((await post(mock, 'users/search', { filters })).status).toBe(422)
    })

    it('does not read inherited fields of a record', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        const equal = await post(mock, 'users/search', { filters: [{ field: 'constructor', operator: '=', value: 'x' }] })
        expect(await rows(equal)).toEqual([])
    })
})

describe('limits', () => {
    it('answers 413 for a body over the limit', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const big = JSON.stringify({ filler: 'x'.repeat(1_000_001) })
        expect((await mock.fetch('http://api.test/users/search', { method: 'POST', body: big })).status).toBe(413)
        expect((await mock.fetch('http://api.test/users', { method: 'DELETE', body: big })).status).toBe(413)
    })

    it('answers 422 for too many mutations or ids and changes nothing', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const mutate = Array.from({ length: 1001 }, () => ({ operation: 'create', attributes: {} }))
        expect((await post(mock, 'users/mutate', { mutate })).status).toBe(422)
        const resources = Array.from({ length: 1001 }, (_, index) => index)
        const del = await mock.fetch('http://api.test/users', { method: 'DELETE', body: JSON.stringify({ resources }) })
        expect(del.status).toBe(422)
        expect(await rows(await post(mock, 'users/search'))).toEqual([])
    })

    it('accepts exactly the maximum number of mutations', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const mutate = Array.from({ length: 1000 }, () => ({ operation: 'create', attributes: {} }))
        expect((await post(mock, 'users/mutate', { mutate })).status).toBe(200)
    })
})

describe('passthrough', () => {
    const original = globalThis.fetch

    afterEach(() => {
        globalThis.fetch = original
    })

    it('hands a Request with a body to the original fetch untouched', async () => {
        const received: unknown[] = []
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            received.push(input)
            return new Response('real')
        }) as typeof fetch
        const mock = await installMock({ ...base, seed: { users: [] } })
        const request = new Request('http://other.test/upload', { method: 'POST', body: 'payload' })
        await fetch(request)
        expect(received[0]).toBe(request)
        expect(request.bodyUsed).toBe(false)
        expect(await request.text()).toBe('payload')
        const url = new URL('http://other.test/u')
        await fetch(url)
        expect(received[1]).toBe(url)
        mock.restore()
    })

    it('passes relative urls through without throwing', async () => {
        globalThis.fetch = (async () => new Response('real')) as typeof fetch
        const mock = await installMock({ ...base, seed: { users: [] } })
        expect(await (await fetch('/relative')).text()).toBe('real')
        mock.restore()
    })

    it('handles a Request aimed at baseUrl', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        const response = await mock.fetch(new Request('http://api.test/users/search', { method: 'POST', body: '{}' }))
        expect(await rows(response)).toEqual([{ id: '1' }])
    })
})

describe('abort signal', () => {
    it('rejects with the reason when already aborted', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const reason = new Error('stop')
        await expect(
            mock.fetch('http://api.test/users/search', { method: 'POST', signal: AbortSignal.abort(reason) }),
        ).rejects.toBe(reason)
    })

    it('rejects with the reason when aborted during timing', async () => {
        vi.useFakeTimers()
        const mock = await createMock({ baseUrl: 'http://api.test', timing: 1000, seed: { users: [] } })
        const controller = new AbortController()
        const pending = mock.fetch('http://api.test/users/search', { method: 'POST', signal: controller.signal })
        const outcome = expect(pending).rejects.toBe('gone')
        await vi.advanceTimersByTimeAsync(500)
        controller.abort('gone')
        await outcome
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('routing and behavior', () => {
    it('normalizes a trailing slash on delete and search', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }, { id: 2 }] } })
        const del = await mock.fetch('http://api.test/users/', { method: 'DELETE', body: JSON.stringify({ resources: [1] }) })
        expect(del.status).toBe(200)
        expect(await rows(await post(mock, 'users/search/'))).toEqual([{ id: '2' }])
    })

    it('answers 404 for a GET and for unknown actions', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        expect((await mock.fetch('http://api.test/users')).status).toBe(404)
        expect((await mock.fetch('http://api.test/users/search')).status).toBe(404)
        expect((await post(mock, 'users/other')).status).toBe(404)
        expect((await post(mock, 'users/search/more')).status).toBe(404)
    })

    it('answers 422 through createMock on an invalid mutate body', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        const response = await mock.fetch('http://api.test/users/mutate', { method: 'POST', body: '{' })
        expect(response.status).toBe(422)
        expect(await response.json()).toEqual({ message: 'Invalid JSON body', errors: {} })
    })

    it('answers 422 on an empty body for mutate and delete and lists on search', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        expect((await mock.fetch('http://api.test/users/mutate', { method: 'POST' })).status).toBe(422)
        expect((await mock.fetch('http://api.test/users', { method: 'DELETE' })).status).toBe(422)
        expect(await rows(await mock.fetch('http://api.test/users/search', { method: 'POST' }))).toEqual([{ id: '1' }])
    })

    it('updating an unknown key returns null and creates nothing', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        const response = await post(mock, 'users/mutate', { mutate: [{ operation: 'update', key: 99, attributes: { a: 1 } }] })
        expect(((await response.json()) as { data: unknown[] }).data).toEqual([null])
        expect(await rows(await post(mock, 'users/search'))).toEqual([{ id: '1' }])
    })

    it('a partial update keeps the other fields and the id', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1, name: 'Ann', age: 30 }] } })
        const response = await post(mock, 'users/mutate', {
            mutate: [{ operation: 'update', key: 1, attributes: { age: 31, id: 'hack' } }],
        })
        expect(await rows(response)).toEqual([{ id: '1', name: 'Ann', age: 31 }])
    })

    it('works with a baseUrl that has a path', async () => {
        const mock = await createMock({ baseUrl: 'http://api.test/v1/', timing: 0, seed: { users: [{ id: 1 }] } })
        const list = await mock.fetch('http://api.test/v1/users/search', { method: 'POST', body: '{}' })
        expect(await rows(list)).toEqual([{ id: '1' }])
        expect((await mock.handle(new Request('http://api.test/users/search', { method: 'POST' }))).status).toBe(404)
        expect((await mock.handle(new Request('http://api.test/v10/users/search', { method: 'POST' }))).status).toBe(404)
    })

    it('copies the seed deeply so later changes do not reach the store', async () => {
        const seed = { users: [{ id: 1, profile: { city: 'Paris' } }] }
        const mock = await createMock({ ...base, seed })
        seed.users[0]!.profile.city = 'Lyon'
        seed.users.push({ id: 2, profile: { city: 'Nice' } })
        expect(await rows(await post(mock, 'users/search'))).toEqual([{ id: '1', profile: { city: 'Paris' } }])
    })

    it('waits 300 ms by default', async () => {
        vi.useFakeTimers()
        const mock = await createMock({ baseUrl: 'http://api.test', seed: { users: [] } })
        let done = false
        const pending = mock.fetch('http://api.test/users/search', { method: 'POST' }).then(response => {
            done = true
            return response
        })
        await vi.advanceTimersByTimeAsync(299)
        expect(done).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect((await pending).status).toBe(200)
    })
})
