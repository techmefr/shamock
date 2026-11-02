import { describe, expect, it } from 'vitest'
import { createMock } from '../src/mock.ts'
import type { MockConfig } from '../src/mock.ts'

type Row = Record<string, any>

const seed = {
    users: [
        { id: 1, name: 'Ann', role: 'admin' },
        { id: 2, name: 'Bob', role: 'user' },
        { id: 3, name: 'Cid', role: 'user' },
    ],
    posts: [
        { id: 1, user_id: 1, title: 'a', score: 10, state: 'published' },
        { id: 2, user_id: 1, title: 'b', score: 30, state: 'draft' },
        { id: 3, user_id: 2, title: 'c', score: 5, state: 'published' },
    ],
}

const links = { posts: { type: 'hasMany' as const, resource: 'posts', foreignKey: 'user_id' } }

async function start(users: Row = {}, config: Partial<MockConfig> = {}) {
    const mock = await createMock({
        baseUrl: 'http://api.test',
        timing: 0,
        seed,
        resources: { users: { links, ...users }, posts: { links: { user: { type: 'belongsTo', resource: 'users', foreignKey: 'user_id' } } } },
        ...config,
    })
    const search = async (search: unknown) => {
        const response = await mock.fetch('http://api.test/users/search', { method: 'POST', body: JSON.stringify({ search }) })
        return { status: response.status, body: (await response.json()) as any }
    }
    return { search }
}

const rowsOf = (result: { body: any }): Row[] => result.body.data

describe('aggregates', () => {
    it('computes every type with the default alias', async () => {
        const { search } = await start()
        const result = await search({
            aggregates: [
                { relation: 'posts', type: 'count' },
                { relation: 'posts', type: 'exists' },
                { relation: 'posts', type: 'sum', field: 'score' },
                { relation: 'posts', type: 'avg', field: 'score' },
                { relation: 'posts', type: 'min', field: 'score' },
                { relation: 'posts', type: 'max', field: 'score' },
            ],
        })
        expect(rowsOf(result)[0]).toMatchObject({
            posts_count: 2,
            posts_exists: true,
            posts_sum_score: 40,
            posts_avg_score: 20,
            posts_min_score: 10,
            posts_max_score: 30,
        })
        expect(rowsOf(result)[2]).toMatchObject({ posts_count: 0, posts_exists: false, posts_sum_score: null, posts_avg_score: null, posts_min_score: null, posts_max_score: null })
    })

    it('honors alias and filters and keeps selects', async () => {
        const { search } = await start()
        const result = await search({
            selects: [{ field: 'id' }],
            aggregates: [{ relation: 'posts', type: 'count', alias: 'published', filters: [{ field: 'state', value: 'published' }] }],
        })
        expect(rowsOf(result)).toEqual([
            { id: 1, published: 1 },
            { id: 2, published: 1 },
            { id: 3, published: 0 },
        ])
    })

    it('aggregates a belongsTo relation', async () => {
        const mock = await createMock({ baseUrl: 'http://api.test', timing: 0, seed, resources: { posts: { links: { user: { type: 'belongsTo', resource: 'users', foreignKey: 'user_id' } } } } })
        const response = await mock.fetch('http://api.test/posts/search', { method: 'POST', body: JSON.stringify({ aggregates: [{ relation: 'user', type: 'exists' }] }) })
        expect(((await response.json()) as any).data.map((row: Row) => row.user_exists)).toEqual([true, true, true])
    })

    it('answers 422 for a bad type or a missing field', async () => {
        const { search } = await start()
        expect((await search({ aggregates: [{ relation: 'posts', type: 'median' }] })).status).toBe(422)
        expect((await search({ aggregates: [{ relation: 'posts', type: 'sum' }] })).status).toBe(422)
    })

    it('ignores an undeclared relation by default and refuses it under the profile', async () => {
        const { search } = await start()
        const ignored = await search({ aggregates: [{ relation: 'comments', type: 'count' }] })
        expect(ignored.status).toBe(200)
        expect(rowsOf(ignored)[0]).not.toHaveProperty('comments_count')
        const strict = await start({}, { profile: 'lomkit' })
        expect((await strict.search({ aggregates: [{ relation: 'comments', type: 'count' }] })).status).toBe(422)
        expect(rowsOf(await strict.search({ aggregates: [{ relation: 'posts', type: 'count' }] }))[0].posts_count).toBe(2)
    })

    it('stays refused under the profile when no relation is declared', async () => {
        const mock = await createMock({ baseUrl: 'http://api.test', timing: 0, seed, profile: 'lomkit' })
        const response = await mock.fetch('http://api.test/users/search', { method: 'POST', body: JSON.stringify({ aggregates: [{ relation: 'posts', type: 'count' }] }) })
        expect(response.status).toBe(422)
    })
})

describe('scopes and instructions', () => {
    const declared = {
        scopes: { withRole: (rows: Row[], params: unknown[]) => rows.filter(row => row.role === params[0]) },
        instructions: { search: (rows: Row[], fields: Record<string, unknown>) => rows.filter(row => String(row.name).startsWith(String(fields.prefix))) },
    }

    it('applies a declared scope with its parameters', async () => {
        const { search } = await start(declared)
        expect(rowsOf(await search({ scopes: [{ name: 'withRole', parameters: ['user'] }] })).map(row => row.id)).toEqual([2, 3])
    })

    it('applies a declared instruction with its fields', async () => {
        const { search } = await start(declared)
        const result = await search({ instructions: [{ name: 'search', fields: [{ name: 'prefix', value: 'B' }] }] })
        expect(rowsOf(result).map(row => row.id)).toEqual([2])
    })

    it('combines a scope with filters and totals', async () => {
        const { search } = await start(declared)
        const result = await search({ scopes: [{ name: 'withRole', parameters: ['user'] }], filters: [{ field: 'name', value: 'Cid' }] })
        expect(result.body.total).toBe(1)
    })

    it('ignores an unknown scope by default and refuses it under the profile', async () => {
        const { search } = await start(declared)
        expect(rowsOf(await search({ scopes: [{ name: 'nope' }] }))).toHaveLength(3)
        const strict = await start(declared, { profile: 'lomkit' })
        expect((await strict.search({ scopes: [{ name: 'nope' }] })).status).toBe(422)
        expect((await strict.search({ instructions: [{ name: 'nope' }] })).status).toBe(422)
        expect(rowsOf(await strict.search({ scopes: [{ name: 'withRole', parameters: ['admin'] }] }))).toHaveLength(1)
    })

    it('ignores scopes without a declaration and refuses them under the profile', async () => {
        const { search } = await start()
        expect(rowsOf(await search({ scopes: [{ name: 'withRole' }] }))).toHaveLength(3)
        const strict = await start({}, { profile: 'lomkit' })
        expect((await strict.search({ scopes: [{ name: 'withRole' }] })).status).toBe(422)
    })

    it('answers 422 for parameters that are not an array', async () => {
        const { search } = await start(declared)
        expect((await search({ scopes: [{ name: 'withRole', parameters: 'x' }] })).status).toBe(422)
    })
})

describe('gates', () => {
    const gates = { view: () => true, update: (row: Row) => row.role !== 'admin', delete: (row: Row) => row.id === 3 }

    it('exposes the requested gates under the gates key with the policy names', async () => {
        const { search } = await start({ gates })
        const result = await search({ gates: ['view', 'update', 'delete', 'create'] })
        expect(rowsOf(result).map(row => row.gates)).toEqual([
            { authorized_to_view: true, authorized_to_update: false, authorized_to_delete: false },
            { authorized_to_view: true, authorized_to_update: true, authorized_to_delete: false },
            { authorized_to_view: true, authorized_to_update: true, authorized_to_delete: true },
        ])
    })

    it('adds nothing when no gate is requested', async () => {
        const { search } = await start({ gates })
        expect(rowsOf(await search({}))[0]).not.toHaveProperty('gates')
    })

    it('ignores gates without a declaration and refuses them under the profile', async () => {
        const { search } = await start()
        expect(rowsOf(await search({ gates: ['view'] }))[0]).not.toHaveProperty('gates')
        const strict = await start({}, { profile: 'lomkit' })
        expect((await strict.search({ gates: ['view'] })).status).toBe(422)
    })

    it('refuses an undeclared or unknown gate under the profile only', async () => {
        const strict = await start({ gates: { view: () => true } }, { profile: 'lomkit' })
        expect((await strict.search({ gates: ['view'] })).status).toBe(200)
        expect((await strict.search({ gates: ['delete'] })).status).toBe(422)
        expect((await strict.search({ gates: ['fly'] })).status).toBe(422)
        const loose = await start({ gates: { view: () => true } })
        expect(rowsOf(await loose.search({ gates: ['delete', 'fly'] }))[0]).not.toHaveProperty('gates')
    })
})

describe('keyword fields', () => {
    const rows = { users: [{ id: 1, name: 'Bob' }, { id: 2, name: 'Ann' }] }

    it.each([undefined, 'lomkit' as const])('filters and sorts on name.keyword like on name (%s)', async profile => {
        const { search } = await start({}, { seed: { ...seed, ...rows }, profile })
        expect(rowsOf(await search({ filters: [{ field: 'name.keyword', value: 'Ann' }] })).map(row => row.id)).toEqual([2])
        expect(rowsOf(await search({ sorts: [{ field: 'name.keyword', direction: 'asc' }] })).map(row => row.id)).toEqual([2, 1])
    })
})
