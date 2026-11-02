import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMock } from '../src/mock.ts'
import { applySearch } from '../src/search.ts'
import type { MockConfig, MockResource } from '../src/mock.ts'

const base = { baseUrl: 'http://api.test', timing: 0 }

type Row = Record<string, any>

async function start(config: Partial<MockConfig> & { seed: MockConfig['seed'] }) {
    const mock = await createMock({ profile: 'lomkit', ...base, ...config })
    const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
        const response = await mock.fetch(`http://api.test${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: response.status, body: await response.json() }
    }
    const search = (search: unknown, resource = 'users') => call('POST', `/${resource}/search`, { search })
    const names = async (search_: unknown, resource = 'users'): Promise<string[]> =>
        (await search({ ...(search_ as object), limit: 50 }, resource)).body.data.map((row: Row) => row.name)
    return { mock, call, search, names }
}

const plain = (config: Partial<MockConfig> & { seed: MockConfig['seed'] }) => start({ ...config, profile: undefined })

const FIRST_NAMES = ['Alice', 'Bob', 'Carla', 'David', 'Emma', 'Felix', 'Gaia', 'Hugo', 'Iris', 'Jules', 'Kevin', 'Lea', 'Mona', 'Nils', 'Olga', 'Paul', 'Quinn', 'Rita', 'Sam', 'Tina']
const ROLES = ['admin', 'editor', 'viewer']

const playground = (): Row[] => {
    const seeded = FIRST_NAMES.map((name, index) => ({
        name: `${name} Martin`,
        age: 18 + ((index * 7) % 45),
        role: ROLES[index % ROLES.length],
    }))
    const specials = [40, 41, 42, 43, 44, 45, 46, 33, 34].map((age, index) => ({ name: `Special ${index}`, age, role: 'special' }))
    const bulk = Array.from({ length: 50 }, (_, index) => ({ name: `Bulk ${index}`, age: 20 + (index % 30), role: 'bulk' }))
    return [...seeded, ...specials, ...bulk].map((row, index) => ({ id: index + 1, ...row }))
}

const filter = (field: string, operator: string, value: unknown, type?: string): Row => ({ field, operator, value, ...(type ? { type } : {}) })

describe('and binds tighter than or', () => {
    const rows = playground()
    const expected = rows.filter(row => (row.role === 'admin' && row.age >= 30) || (row.role === 'special' && row.age < 43)).map(row => row.name)

    it('returns the 11 rows of the playground dataset for a AND b OR c AND d', async () => {
        const { names } = await start({ seed: { users: rows } })
        const got = await names({
            filters: [filter('role', '=', 'admin'), filter('age', '>=', 30), filter('role', '=', 'special', 'or'), filter('age', '<', 43)],
        })
        expect(expected).toHaveLength(11)
        expect(got).toEqual(expected)
    })

    it('groups every and between two or connectors', async () => {
        const { names } = await start({
            seed: { users: [{ id: 1, name: 'a', x: 1, y: 0 }, { id: 2, name: 'b', x: 0, y: 1 }, { id: 3, name: 'c', x: 1, y: 1 }, { id: 4, name: 'd', x: 0, y: 0 }] },
        })
        const got = await names({ filters: [filter('x', '=', 1), filter('y', '=', 1, 'or'), filter('x', '=', 0)] })
        expect(got).toEqual(['a', 'b', 'c'])
    })

    it('keeps a nested group as one condition', async () => {
        const { names } = await start({ seed: { users: rows } })
        const got = await names({
            filters: [filter('role', '=', 'bulk'), { nested: [filter('age', '<', 21), filter('age', '>', 48, 'or')] }],
        })
        expect(got).toEqual(rows.filter(row => row.role === 'bulk' && (row.age < 21 || row.age > 48)).map(row => row.name))
    })
})

describe('in, not in and null', () => {
    const seed = { users: [{ id: 1, name: 'a', role: 'admin' }, { id: 2, name: 'b', role: null }, { id: 3, name: 'c', role: 'guest' }] }

    it('rejects an empty in list with 422', async () => {
        const { search } = await start({ seed })
        expect((await search({ filters: [filter('role', 'in', [])] })).status).toBe(422)
    })

    it('matches nothing for in or not in a list holding only null', async () => {
        const { search } = await start({ seed })
        expect((await search({ filters: [filter('role', 'in', [null])] })).body.total).toBe(0)
        expect((await search({ filters: [filter('role', 'not in', [null])] })).body.total).toBe(0)
        expect((await search({ filters: [filter('role', 'not in', ['admin', null])] })).body.total).toBe(0)
    })

    it('does not match a null value with in or not in', async () => {
        const { names } = await start({ seed })
        expect(await names({ filters: [filter('role', 'not in', ['admin'])] })).toEqual(['c'])
        expect(await names({ filters: [filter('role', 'in', ['admin', 'guest'])] })).toEqual(['a', 'c'])
    })
})

describe('like folds ASCII letters only', () => {
    it('keeps non ASCII letters case sensitive', async () => {
        const { names } = await start({ seed: { users: [{ id: 1, name: 'Élodie' }, { id: 2, name: 'Zoe' }] } })
        expect(await names({ filters: [filter('name', 'like', 'élodie')] })).toEqual([])
        expect(await names({ filters: [filter('name', 'like', 'Élodie')] })).toEqual(['Élodie'])
        expect(await names({ filters: [filter('name', 'like', 'ZOE')] })).toEqual(['Zoe'])
    })
})

describe('dates are stored and compared as Y-m-d H:i:s', () => {
    const seed = {
        users: [
            { id: 1, name: 'a', joined: new Date(Date.UTC(2024, 2, 1, 10, 30, 0)) },
            { id: 2, name: 'b', joined: '2024-05-01T08:00:00.000Z' },
            { id: 3, name: 'c', joined: '2024-06-01 00:00:00.000Z' },
            { id: 4, name: 'd', joined: '2024-07-01 12:00:00' },
            { id: 5, name: 'e', joined: null },
        ],
    }

    it('normalizes seeded dates', async () => {
        const { search } = await start({ seed })
        const joined = (await search({ sorts: [{ field: 'id' }] })).body.data.map((row: Row) => row.joined)
        expect(joined).toEqual(['2024-03-01 10:30:00', '2024-05-01 08:00:00', '2024-06-01 00:00:00', '2024-07-01 12:00:00', null])
    })

    it('compares ISO and stored values on the same scale', async () => {
        const { names } = await start({ seed })
        expect(await names({ filters: [filter('joined', '=', '2024-05-01T08:00:00.000Z')] })).toEqual(['b'])
        expect(await names({ filters: [filter('joined', '>=', '2024-05-01T08:00:00Z')] })).toEqual(['b', 'c', 'd'])
        expect(await names({ filters: [filter('joined', '<', '2024-06-01 00:00:00')] })).toEqual(['a', 'b'])
        expect(await names({ filters: [filter('joined', '>=', '2024-06-01')] })).toEqual(['c', 'd'])
    })

    it('normalizes dates written by mutate', async () => {
        const { call, search } = await start({ seed })
        await call('POST', '/users/mutate', { mutate: [{ operation: 'update', key: 5, attributes: { joined: '2025-01-02T03:04:05Z' } }] })
        expect((await search({ filters: [filter('id', '=', 5)] })).body.data[0].joined).toBe('2025-01-02 03:04:05')
    })
})

describe('unsupported search keys answer 422', () => {
    const seed = { users: [{ id: 1, name: 'a' }] }

    it.each(['aggregates', 'scopes', 'instructions', 'gates'])('refuses %s', async key => {
        const { search } = await start({ seed })
        const refused = await search({ [key]: [{ name: 'x' }] })
        expect(refused.status).toBe(422)
        expect(refused.body.message).toContain(`"${key}" is not supported`)
        expect((await search({ [key]: [] })).status).toBe(200)
    })

    it('refuses unknown keys, unknown filter keys and groups nested in groups', async () => {
        const { search } = await start({ seed })
        expect((await search({ wat: 1 })).status).toBe(422)
        expect((await search({ filters: [{ field: 'name', value: 'a', extra: 1 }] })).status).toBe(422)
        expect((await search({ filters: [{ nested: [{ nested: [filter('name', '=', 'a')] }] }] })).status).toBe(422)
        expect((await search({ filters: [{ nested: [filter('name', '=', 'a')] }] })).status).toBe(200)
    })

    it('refuses like filters combined with text search', async () => {
        const { search } = await start({ seed })
        expect((await search({ filters: [filter('name', 'like', 'a')], text: { value: 'a' } })).status).toBe(422)
        expect((await search({ filters: [filter('id', '=', 1)], text: { value: 'a' } })).status).toBe(200)
    })
})

describe('text search scope', () => {
    const seed = { users: [{ id: 1, name: 'Ann', email: 'x@y', role: 'guest' }, { id: 2, name: 'Bob', email: 'guest@y', role: 'admin' }] }

    it('searches every string field by default', async () => {
        const { names } = await start({ seed })
        expect(await names({ text: { value: 'guest' } })).toEqual(['Ann', 'Bob'])
    })

    it('searches only the searchable fields of the resource', async () => {
        const { names } = await plain({ seed, resources: { users: { searchable: ['name', 'email'] } } })
        expect(await names({ text: { value: 'guest' } })).toEqual(['Bob'])
    })

    it('treats percent and underscore of the text as wildcards', async () => {
        const { names } = await start({ seed })
        expect(await names({ text: { value: 'A_n' } })).toEqual(['Ann'])
    })
})

describe('selects', () => {
    it('keeps only the selected fields', async () => {
        const { search } = await plain({ seed: { users: [{ id: 1, name: 'a', age: 3 }] } })
        expect((await search({ selects: [{ field: 'id' }, { field: 'name' }] })).body.data).toEqual([{ id: 1, name: 'a' }])
        expect((await search({ selects: [{}] })).status).toBe(422)
    })
})

describe('includes', () => {
    const resources: Record<string, MockResource> = {
        users: {
            links: {
                manager: { type: 'belongsTo', resource: 'users', foreignKey: 'manager_id' },
                posts: { type: 'hasMany', resource: 'posts', foreignKey: 'user_id' },
            },
        },
        posts: { limits: [1, 2], links: { user: { type: 'belongsTo', resource: 'users', foreignKey: 'user_id' } } },
    }
    const seed = {
        users: [
            { id: 1, name: 'boss', manager_id: null },
            { id: 2, name: 'dev', manager_id: 1 },
            { id: 3, name: 'ops', manager_id: 1 },
        ],
        posts: [
            { id: 1, user_id: 1, title: 'p1', views: 5, published: true },
            { id: 2, user_id: 1, title: 'p2', views: 9, published: true },
            { id: 3, user_id: 1, title: 'p3', views: 1, published: false },
            { id: 4, user_id: 2, title: 'p4', views: 2, published: true },
        ],
    }

    it('embeds a belongsTo as an object or null', async () => {
        const { search } = await plain({ seed, resources })
        const rows = (await search({ includes: [{ relation: 'manager', selects: [{ field: 'id' }, { field: 'name' }] }] })).body.data
        expect(rows.map((row: Row) => row.manager)).toEqual([null, { id: 1, name: 'boss' }, { id: 1, name: 'boss' }])
    })

    it('embeds a hasMany with filters, sorts, selects and a limit per parent', async () => {
        const { search } = await plain({ seed, resources })
        const rows = (
            await search({
                filters: [filter('id', 'in', [1, 2, 3])],
                includes: [
                    {
                        relation: 'posts',
                        filters: [filter('published', '=', true)],
                        sorts: [{ field: 'views', direction: 'desc' }],
                        selects: [{ field: 'id' }, { field: 'views' }],
                        limit: 1,
                    },
                ],
            })
        ).body.data
        expect(rows.map((row: Row) => row.posts)).toEqual([[{ id: 2, views: 9 }], [{ id: 4, views: 2 }], []])
    })

    it('nests includes and keeps the parent fields', async () => {
        const { search } = await plain({ seed, resources })
        const row = (await search({ filters: [filter('id', '=', 2)], includes: [{ relation: 'posts', includes: [{ relation: 'user', selects: [{ field: 'name' }] }] }] })).body.data[0]
        expect(row).toEqual({ id: 2, name: 'dev', manager_id: 1, posts: [{ id: 4, user_id: 2, title: 'p4', views: 2, published: true, user: { name: 'dev' } }] })
    })

    it('applies the limits of the related resource', async () => {
        const { search } = await plain({ seed, resources })
        expect((await search({ includes: [{ relation: 'posts', limit: 5 }] })).status).toBe(422)
        expect((await search({ includes: [{ relation: 'posts', limit: 2 }] })).status).toBe(200)
    })

    it('ignores unknown relations and keeps the embedded data without a profile', async () => {
        const { search } = await plain({ seed: { users: [{ id: 1, name: 'a', manager: { name: 'x' } }] } })
        expect((await search({ includes: [{ relation: 'manager' }] })).body.data).toEqual([{ id: 1, name: 'a', manager: { name: 'x' } }])
        expect((await search({ includes: [{ relation: 'nope' }, {}] })).status).toBe(200)
        expect((await search({ includes: [{ relation: 1 }] })).status).toBe(422)
    })

    it('refuses unknown relations under the lomkit profile', async () => {
        const { search } = await start({ seed, resources })
        expect((await search({ includes: [{ relation: 'nope' }] })).status).toBe(422)
        expect((await search({ includes: [{ relation: 'toString' }] })).status).toBe(422)
        expect((await search({ includes: [{}] })).status).toBe(422)
    })

    it('refuses unsupported include keys under the lomkit profile', async () => {
        const { search } = await start({ seed, resources })
        expect((await search({ includes: [{ relation: 'manager', text: { value: 'x' } }] })).status).toBe(422)
        expect((await search({ includes: [{ relation: 'manager', aggregates: [{ relation: 'posts', type: 'count' }] }] })).status).toBe(422)
    })

    it('refuses an include on a resource without relations under the lomkit profile', async () => {
        const { search } = await start({ seed })
        expect((await search({ includes: [{ relation: 'manager' }] })).status).toBe(422)
    })

    it('rejects a relation that targets an unknown resource', async () => {
        await expect(
            createMock({ ...base, seed: { users: [] }, resources: { users: { links: { posts: { type: 'hasMany', resource: 'posts', foreignKey: 'user_id' } } } } }),
        ).rejects.toThrow('unknown resource "posts"')
    })
})

describe('limits', () => {
    const seed = { users: Array.from({ length: 30 }, (_, index) => ({ id: index + 1 })) }

    it('accepts only 10, 25 and 50 by default', async () => {
        const { search } = await start({ seed })
        for (const limit of [10, 25, 50]) expect((await search({ limit })).status).toBe(200)
        const refused = await search({ limit: 7 })
        expect(refused.status).toBe(422)
        expect(refused.body.errors).toEqual({ 'search.limit': ['The selected search.limit is invalid.'] })
        expect((await search({ limit: 0 })).status).toBe(422)
        expect((await search({ limit: '10' })).status).toBe(422)
        expect((await search({})).body.per_page).toBe(50)
    })

    it('takes the limits of the config, then of the resource', async () => {
        const configured = await plain({ seed, limits: [5] })
        expect((await configured.search({ limit: 5 })).body.data).toHaveLength(5)
        expect((await configured.search({ limit: 10 })).status).toBe(422)
        const perResource = await plain({ seed, limits: [5], resources: { users: { limits: [20] } } })
        expect((await perResource.search({ limit: 20 })).body.data).toHaveLength(20)
        expect((await perResource.search({ limit: 5 })).status).toBe(422)
    })

    it.each([[[]], [[0]], [[1.5]], [['5']]])('throws for the limits %j', async limits => {
        await expect(createMock({ ...base, seed, limits: limits as number[] })).rejects.toThrow('Invalid limits')
    })
})

describe('mutation errors', () => {
    const resources = { users: { schema: z.object({ id: z.number(), name: z.string().min(2), email: z.string().email() }).passthrough(), unique: ['email'] } }
    const seed = { users: [{ id: 1, name: 'Ann', email: 'ann@x.test' }, { id: 2, name: 'Bob', email: 'bob@x.test' }] }

    it('prefixes field errors with the index of the mutation', async () => {
        const { call } = await start({ seed, resources })
        const result = await call('POST', '/users/mutate', {
            mutate: [
                { operation: 'create', attributes: { name: 'Cy', email: 'cy@x.test' } },
                { operation: 'create', attributes: { email: 'nope' } },
                { operation: 'update', key: 2, attributes: { name: 'B' } },
            ],
        })
        expect(result.status).toBe(422)
        expect(Object.keys(result.body.errors).sort()).toEqual(['mutate.1.attributes.email', 'mutate.1.attributes.name', 'mutate.2.attributes.name'])
    })

    it('answers 422 for a duplicate unique value on create and on update', async () => {
        const { call, search } = await start({ seed, resources })
        const created = await call('POST', '/users/mutate', { mutate: [{ operation: 'create', attributes: { name: 'Dup', email: 'ann@x.test' } }] })
        expect(created.status).toBe(422)
        expect(created.body.errors).toEqual({ 'mutate.0.attributes.email': ['The email has already been taken.'] })
        const updated = await call('POST', '/users/mutate', { mutate: [{ operation: 'update', key: 2, attributes: { email: 'ann@x.test' } }] })
        expect(updated.body.errors).toEqual({ 'mutate.0.attributes.email': ['The email has already been taken.'] })
        expect((await search({})).body.total).toBe(2)
    })

    it('lets a record keep its own unique value and ignores null', async () => {
        const { call } = await start({ seed: { users: [{ id: 1, name: 'Ann', email: 'ann@x.test' }, { id: 2, name: 'Bob', email: null }] }, resources: { users: { unique: ['email'] } } })
        expect((await call('POST', '/users/mutate', { mutate: [{ operation: 'update', key: 1, attributes: { email: 'ann@x.test', name: 'Anne' } }] })).status).toBe(200)
        expect((await call('POST', '/users/mutate', { mutate: [{ operation: 'create', attributes: { name: 'Cy', email: null } }] })).status).toBe(200)
    })

    it('answers the invalid payload with the message and the prefixed keys of the schema', async () => {
        const { call, search } = await start({ seed: { users: [{ id: 1, name: 'Ann', email: 'ann@x.test' }] }, resources })
        const result = await call('POST', '/users/mutate', { mutate: [{ operation: 'create', attributes: { name: 'x', email: 'nope' } }] })
        expect(result.status).toBe(422)
        expect(result.body.message).toBe('The given data was invalid.')
        expect(Object.keys(result.body.errors).sort()).toEqual(['mutate.0.attributes.email', 'mutate.0.attributes.name'])
        expect(result.body.errors['mutate.0.attributes.name']).toEqual([expect.any(String)])
        expect((await search({})).body.total).toBe(1)
    })

    it('detects a duplicate inside one request', async () => {
        const { call } = await start({ seed, resources })
        const result = await call('POST', '/users/mutate', {
            mutate: [
                { operation: 'create', attributes: { name: 'Cy', email: 'cy@x.test' } },
                { operation: 'create', attributes: { name: 'Di', email: 'cy@x.test' } },
            ],
        })
        expect(result.status).toBe(422)
    })
})

describe('delete', () => {
    const seed = { users: [{ id: 1 }, { id: 2 }] }

    it('answers 422 without ids', async () => {
        const { call } = await start({ seed })
        const result = await call('DELETE', '/users', {})
        expect(result.status).toBe(422)
        expect(result.body.errors).toEqual({ resources: ['The resources field is required.'] })
        expect((await call('DELETE', '/users', { resources: [] })).status).toBe(422)
    })

    it('answers 422 for unknown ids and deletes nothing', async () => {
        const { call, search } = await start({ seed })
        const result = await call('DELETE', '/users', { resources: [1, 99, 98] })
        expect(result.status).toBe(422)
        expect(Object.keys(result.body.errors)).toEqual(['resources.1', 'resources.2'])
        expect(result.body.message).toBe('The selected resources.1 is invalid.')
        expect((await search({})).body.total).toBe(2)
    })
})

describe('sorting nulls', () => {
    const rows = [{ id: 1 }, { id: 2, n: 5 }, { id: 3, n: null }, { id: 4, n: 1 }, { id: 5 }]

    it('sorts null and undefined first ascending and last descending like SQLite, keeping order stable', () => {
        const options = { lomkit: true }
        const asc = applySearch(rows, { sorts: [{ field: 'n', direction: 'asc' }] }, options).data.map(r => r['id'])
        const desc = applySearch(rows, { sorts: [{ field: 'n', direction: 'desc' }] }, options).data.map(r => r['id'])
        expect(asc).toEqual([1, 3, 5, 4, 2])
        expect(desc).toEqual([2, 4, 1, 3, 5])
    })
})

describe('profile validation', () => {
    it('rejects an unknown profile', async () => {
        await expect(createMock({ ...base, seed: { users: [] }, profile: 'other' as 'lomkit' })).rejects.toThrow('Invalid profile')
    })

    it('answers the delete of a missing id with the lomkit body and keeps the rows', async () => {
        const { call, search } = await start({ seed: { users: [{ id: 1 }] } })
        const response = await call('DELETE', '/users', { resources: [9] })
        expect(response.status).toBe(422)
        expect(response.body).toEqual({ message: 'The selected resources.0 is invalid.', errors: { 'resources.0': ['The selected resources.0 is invalid.'] } })
        expect((await search({})).body.data).toEqual([{ id: 1 }])
    })

    it('rejects a store that would exceed the maximum number of records through the limits option', async () => {
        const { call } = await start({ seed: { users: Array.from({ length: 10_000 }, (_, index) => ({ id: index })) }, limits: [10_000] })
        expect((await call('POST', '/users/mutate', { mutate: [{ operation: 'create', attributes: {} }] })).status).toBe(422)
    })

    it('paginates with a configured limit', async () => {
        const { search } = await start({ seed: { users: Array.from({ length: 5 }, (_, index) => ({ id: index + 1 })) }, limits: [2] })
        const body = (await search({ page: 2, limit: 2 })).body
        expect(body.data).toEqual([{ id: 3 }, { id: 4 }])
        expect(body.per_page).toBe(2)
    })
})

describe('failure injection', () => {
    const seed = { users: [{ id: 1 }] }
    const config = (failures: MockConfig['failures']) => ({ seed, failures })

    it('answers a status on matching calls only', async () => {
        const { call } = await plain(config([{ method: 'post', path: '/users/search', status: 503 }]))
        const failed = await call('POST', '/users/search', {})
        expect(failed.status).toBe(503)
        expect(failed.body).toEqual({ message: 'Injected failure', errors: {} })
        expect((await call('POST', '/users/mutate', { mutate: [] })).status).toBe(200)
        expect((await call('DELETE', '/users', { resources: [1] })).status).toBe(200)
    })

    it('counts calls with after and times', async () => {
        const { call } = await plain(config([{ status: 500, after: 1, times: 2 }]))
        const statuses: number[] = []
        for (let index = 0; index < 5; index++) statuses.push((await call('POST', '/users/search', {})).status)
        expect(statuses).toEqual([200, 500, 500, 200, 200])
    })

    it('fails every call after the first when times is omitted', async () => {
        const { call } = await plain(config([{ status: 502, after: 1 }]))
        expect([(await call('POST', '/users/search', {})).status, (await call('POST', '/users/search', {})).status, (await call('POST', '/users/search', {})).status]).toEqual([200, 502, 502])
    })

    it('rejects like the network', async () => {
        const { mock } = await plain(config([{ network: true, times: 1 }]))
        await expect(mock.fetch('http://api.test/users/search', { method: 'POST', body: '{}' })).rejects.toThrow(TypeError)
        expect((await mock.fetch('http://api.test/users/search', { method: 'POST', body: '{}' })).status).toBe(200)
    })

    it('adds latency without failing', async () => {
        vi.useFakeTimers()
        try {
            const { mock } = await plain(config([{ delay: 500 }]))
            let done = false
            const pending = mock.fetch('http://api.test/users/search', { method: 'POST', body: '{}' }).then(response => {
                done = true
                return response
            })
            await vi.advanceTimersByTimeAsync(499)
            expect(done).toBe(false)
            await vi.advanceTimersByTimeAsync(1)
            expect((await pending).status).toBe(200)
        } finally {
            vi.useRealTimers()
        }
    })

    it('uses the first rule that fires', async () => {
        const { call } = await plain(config([{ path: '/users/search', status: 500, times: 1 }, { status: 503 }]))
        expect((await call('POST', '/users/search', {})).status).toBe(500)
        expect((await call('POST', '/users/search', {})).status).toBe(503)
    })

    it.each([
        [{}, 'give "status", "network" or "delay"'],
        [{ status: 200 }, '"status" must be an integer from 400 to 599'],
        [{ status: 500, network: true }, 'not both'],
        [{ status: 500, after: -1 }, '"after" must be a non-negative integer'],
        [{ status: 500, times: 1.5 }, '"times" must be a non-negative integer'],
        [{ status: 500, path: 'users' }, '"path" must start with "/"'],
        [{ delay: 60_001 }, '"delay" must be a number between 0 and 60000'],
    ])('rejects the rule %j', async (rule, message) => {
        await expect(createMock({ ...base, seed, failures: [rule] })).rejects.toThrow(message)
    })
})

describe('like backslash', () => {
    const seed = { users: [{ id: 1, name: '100%' }, { id: 2, name: '100x' }, { id: 3, name: '100\\z' }] }
    const likeNames = async (likeEscape: boolean | undefined, pattern: string): Promise<string[]> =>
        (await plain({ seed, likeEscape })).names({ filters: [filter('name', 'like', pattern)] })

    it('escapes a wildcard by default', async () => {
        expect(await likeNames(undefined, '100\\%')).toEqual(['100%'])
    })

    it('reads the backslash literally with likeEscape false', async () => {
        expect(await likeNames(false, '100\\%')).toEqual(['100\\z'])
        expect(await likeNames(false, '100%')).toEqual(['100%', '100x', '100\\z'])
    })

    it('applies to text search too', async () => {
        const { names } = await plain({ seed, likeEscape: false })
        expect(await names({ text: { value: '0\\' } })).toEqual(['100\\z'])
    })
})

describe('maxNestingDepth', () => {
    const seed = { users: [{ id: 1, name: 'a' }] }
    const group = (depth: number): Row[] => {
        let filters: Row[] = [filter('name', '=', 'a')]
        for (let level = 0; level < depth; level++) filters = [{ nested: filters }]
        return filters
    }

    it('allows one group level by default', async () => {
        const { search } = await start({ seed })
        expect((await search({ filters: group(1) })).status).toBe(200)
        expect((await search({ filters: group(2) })).status).toBe(422)
    })

    it('allows deeper groups up to the configured depth', async () => {
        const { search } = await plain({ seed, maxNestingDepth: 3 })
        expect((await search({ filters: group(3) })).status).toBe(200)
        expect((await search({ filters: group(4) })).status).toBe(422)
    })

    it.each([0, 1.5, 11])('throws for the depth %s', async depth => {
        await expect(createMock({ ...base, seed, maxNestingDepth: depth })).rejects.toThrow('Invalid maxNestingDepth')
    })
})
