import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMock } from '../src/mock.ts'
import type { FetchLike } from '../src/mock.ts'

const base = { baseUrl: 'http://api.test', timing: 0 }

const post = (mock: { fetch: FetchLike }, path: string, body: unknown = {}): Promise<Response> =>
    mock.fetch(`http://api.test/${path}`, { method: 'POST', body: JSON.stringify(body) })

const rows = async (response: Response): Promise<Record<string, unknown>[]> =>
    ((await response.json()) as { data: Record<string, unknown>[] }).data

const create = (mock: { fetch: FetchLike }, attributes: unknown): Promise<Response> =>
    post(mock, 'users/mutate', { mutate: [{ operation: 'create', attributes }] })

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('generated ids follow the seed', () => {
    it('numeric when every seed id is numeric', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }, { id: 20 }] } })
        expect(await rows(await create(mock, { name: 'A' }))).toEqual([{ id: 21, name: 'A' }])
    })

    it('string when the seed ids are strings', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 'a' }] } })
        expect(await rows(await create(mock, { name: 'A' }))).toEqual([{ id: '1', name: 'A' }])
    })

    it('string when the seed is empty', async () => {
        const mock = await createMock({ ...base, seed: { users: [] } })
        expect(await rows(await create(mock, {}))).toEqual([{ id: '1' }])
    })
})

describe('schema validation of mutations', () => {
    const resources = { users: { schema: z.object({ id: z.number(), name: z.string().min(2), age: z.number().optional() }) } }
    const seed = { users: [{ id: 1, name: 'Ann' }] }

    it('rejects an invalid create with 422 and Laravel-style errors', async () => {
        const mock = await createMock({ ...base, seed, resources })
        const response = await create(mock, { name: 'A', age: 'x' })
        expect(response.status).toBe(422)
        const body = (await response.json()) as { message: string; errors: Record<string, string[]> }
        expect(body.message).toBe('The given data was invalid.')
        expect(Object.keys(body.errors).sort()).toEqual(['age', 'name'])
        expect(body.errors['name']).toEqual([expect.any(String)])
        expect(await rows(await post(mock, 'users/search'))).toEqual(seed.users)
    })

    it('accepts a valid create with a numeric id', async () => {
        const mock = await createMock({ ...base, seed, resources })
        expect(await rows(await create(mock, { name: 'Bob' }))).toEqual([{ id: 2, name: 'Bob' }])
    })

    it('validates the merged record of an update', async () => {
        const mock = await createMock({ ...base, seed, resources })
        const bad = await post(mock, 'users/mutate', { mutate: [{ operation: 'update', key: 1, attributes: { name: 'B' } }] })
        expect(bad.status).toBe(422)
        const good = await post(mock, 'users/mutate', { mutate: [{ operation: 'update', key: 1, attributes: { age: 3 } }] })
        expect(await rows(good)).toEqual([{ id: 1, name: 'Ann', age: 3 }])
    })

    it('is atomic: one invalid record leaves the store unchanged', async () => {
        const mock = await createMock({ ...base, seed, resources })
        const response = await post(mock, 'users/mutate', {
            mutate: [
                { operation: 'create', attributes: { name: 'Bob' } },
                { operation: 'create', attributes: { name: 'C' } },
            ],
        })
        expect(response.status).toBe(422)
        expect(await rows(await post(mock, 'users/search'))).toEqual(seed.users)
        expect(await rows(await create(mock, { name: 'Dan' }))).toEqual([{ id: 2, name: 'Dan' }])
    })

    it('does not validate resources without a schema', async () => {
        const mock = await createMock({ ...base, seed: { users: [], notes: [] }, resources: { users: resources.users } })
        const response = await post(mock, 'notes/mutate', { mutate: [{ operation: 'create', attributes: { x: 1 } }] })
        expect(response.status).toBe(200)
    })

    it('serializes concurrent writes', async () => {
        const mock = await createMock({ ...base, seed, resources })
        const responses = await Promise.all([create(mock, { name: 'Bob' }), create(mock, { name: 'Cat' })])
        const ids = (await Promise.all(responses.map(rows))).map(list => list[0]?.['id'])
        expect(ids).toEqual([2, 3])
    })
})

describe('unknown ids', () => {
    it('update of an unknown id answers 404 and applies nothing', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1, name: 'Ann' }] } })
        const response = await post(mock, 'users/mutate', {
            mutate: [
                { operation: 'update', key: 1, attributes: { name: 'Changed' } },
                { operation: 'update', key: 9, attributes: { name: 'X' } },
            ],
        })
        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ message: 'Not found', errors: {} })
        expect(await rows(await post(mock, 'users/search'))).toEqual([{ id: 1, name: 'Ann' }])
    })

    it('delete of an unknown id stays a success', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        const response = await mock.fetch('http://api.test/users', { method: 'DELETE', body: JSON.stringify({ resources: [9] }) })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ success: true })
    })
})

describe('unknown search operator', () => {
    it('answers 422 Invalid search', async () => {
        const mock = await createMock({ ...base, seed: { users: [{ id: 1 }] } })
        const response = await post(mock, 'users/search', { filters: [{ field: 'id', operator: 'regex', value: 1 }] })
        expect(response.status).toBe(422)
        expect(((await response.json()) as { message: string }).message).toContain('Invalid search')
    })
})

describe('fetch capture', () => {
    it('does not recurse when mock.fetch is the global fetch', async () => {
        const foreign = vi.fn(async () => new Response('foreign'))
        vi.stubGlobal('fetch', foreign)
        const mock = await createMock({ ...base, seed: { users: [] } })
        vi.stubGlobal('fetch', mock.fetch)
        const response = await fetch('http://other.test/x')
        expect(await response.text()).toBe('foreign')
        expect(foreign).toHaveBeenCalledOnce()
        expect(await rows(await post(mock, 'users/search'))).toEqual([])
    })
})

describe('full-text search', () => {
    const seed = {
        users: [
            { id: 1, name: 'Joël', city: 'Paris', age: 30 },
            { id: 2, name: 'Ann', city: 'Lyon', note: 'PARIS fan' },
            { id: 3, name: 'Bob', city: 'Nice', tags: ['paris'] },
        ],
    }

    it('matches string values containing the text, case-insensitively', async () => {
        const mock = await createMock({ ...base, seed })
        const found = await rows(await post(mock, 'users/search', { search: { text: { value: 'paris' } } }))
        expect(found.map(row => row['id'])).toEqual([1, 2])
    })

    it('ignores numbers and arrays, combines with filters, and an empty text matches all', async () => {
        const mock = await createMock({ ...base, seed })
        expect(await rows(await post(mock, 'users/search', { text: { value: '30' } }))).toEqual([])
        const both = await rows(
            await post(mock, 'users/search', { text: { value: 'paris' }, filters: [{ field: 'name', operator: '=', value: 'Ann' }] }),
        )
        expect(both.map(row => row['id'])).toEqual([2])
        expect(await rows(await post(mock, 'users/search', { text: { value: '' } }))).toHaveLength(3)
    })
})

describe('like escapes', () => {
    const seed = { users: [{ id: 1, name: 'Joel' }, { id: 2, name: 'Jo_el' }, { id: 5, name: 'Joxel' }, { id: 3, name: '50%' }, { id: 4, name: 'a\\b' }] }
    const like = async (value: string): Promise<unknown[]> => {
        const mock = await createMock({ ...base, seed })
        const found = await rows(await post(mock, 'users/search', { filters: [{ field: 'name', operator: 'like', value }] }))
        return found.map(row => row['id'])
    }

    it('treats an escaped underscore as a literal', async () => {
        expect(await like('%Jo\\_el%')).toEqual([2])
    })

    it('keeps an unescaped underscore as a wildcard', async () => {
        expect(await like('Jo_el')).toEqual([2, 5])
    })

    it('treats an escaped percent as a literal', async () => {
        expect(await like('50\\%')).toEqual([3])
    })

    it('treats an escaped backslash as a literal', async () => {
        expect(await like('a\\\\b')).toEqual([4])
    })

    it('keeps a trailing lone backslash literal', async () => {
        expect(await like('a\\')).toEqual([])
    })
})
