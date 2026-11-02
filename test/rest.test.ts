import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createMock } from '../src/core.ts'
import type { FetchLike } from '../src/core.ts'
import { rest } from '../src/rest.ts'
import type { RestOptions } from '../src/rest.ts'

const BASE = 'http://api.test/api'

const people = [
    { id: 1, name: 'Ada', age: 36, team: 'a' },
    { id: 2, name: 'Grace', age: 85, team: 'b' },
    { id: 3, name: 'Linus', age: 55, team: 'a' },
    { id: 4, name: 'Alan', age: 41, team: 'b' },
]

async function setup(options?: RestOptions, resources = {}, seed: Record<string, object[]> = { people }): Promise<FetchLike> {
    return (await createMock({ baseUrl: BASE, seed, resources, engine: rest(options), timing: 0 })).fetch
}

const call = (fetch: FetchLike, method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('rest engine reads', () => {
    it('lists every row when nothing is asked', async () => {
        const response = await call(await setup(), 'GET', '/people')
        expect(response.headers.get('X-Total-Count')).toBe('4')
        expect(await response.json()).toEqual(people)
    })

    it('filters by equality on query parameters', async () => {
        const fetch = await setup()
        expect(await (await call(fetch, 'GET', '/people?team=a')).json()).toEqual([people[0], people[2]])
        expect(await (await call(fetch, 'GET', '/people?team=a&name=Linus')).json()).toEqual([people[2]])
        expect(await (await call(fetch, 'GET', '/people?team=a&team=b')).json()).toHaveLength(4)
        expect(await (await call(fetch, 'GET', '/people?missing=1')).json()).toEqual([])
    })

    it('sorts ascending, descending and by several fields', async () => {
        const fetch = await setup()
        const names = async (query: string): Promise<string[]> =>
            ((await (await call(fetch, 'GET', `/people?${query}`)).json()) as { name: string }[]).map(row => row.name)
        expect(await names('sort=age')).toEqual(['Ada', 'Alan', 'Linus', 'Grace'])
        expect(await names('sort=-age')).toEqual(['Grace', 'Linus', 'Alan', 'Ada'])
        expect(await names('sort=team,-age')).toEqual(['Linus', 'Ada', 'Grace', 'Alan'])
    })

    it('paginates with page and perPage or limit and reports the total', async () => {
        const fetch = await setup()
        const second = await call(fetch, 'GET', '/people?page=2&perPage=3')
        expect(await second.json()).toEqual([people[3]])
        expect(second.headers.get('X-Total-Count')).toBe('4')
        expect(await (await call(fetch, 'GET', '/people?limit=2')).json()).toEqual([people[0], people[1]])
        expect(await (await call(fetch, 'GET', '/people?page=1')).json()).toHaveLength(4)
    })

    it('uses defaultPerPage when only page is given', async () => {
        const fetch = await setup({ defaultPerPage: 2 })
        expect(await (await call(fetch, 'GET', '/people?page=2')).json()).toEqual([people[2], people[3]])
    })

    it('shapes the collection with the collection option', async () => {
        const fetch = await setup({ collection: ({ rows, total }) => ({ 'hydra:member': rows, 'hydra:totalItems': total }) })
        expect(await (await call(fetch, 'GET', '/people?perPage=1')).json()).toEqual({ 'hydra:member': [people[0]], 'hydra:totalItems': 4 })
    })

    it('finds one row by numeric or string id and answers 404 otherwise', async () => {
        const fetch = await setup(undefined, {}, { people, tags: [{ id: 'x1', label: 'one' }] })
        expect(await (await call(fetch, 'GET', '/people/2')).json()).toEqual(people[1])
        expect(await (await call(fetch, 'GET', '/tags/x1')).json()).toEqual({ id: 'x1', label: 'one' })
        expect((await call(fetch, 'GET', '/people/99')).status).toBe(404)
        expect((await call(fetch, 'GET', '/people/1/extra')).status).toBe(404)
        expect((await call(fetch, 'PUT', '/people')).status).toBe(404)
    })
})

describe('rest engine writes', () => {
    it('creates with a generated numeric id and answers 201', async () => {
        const fetch = await setup()
        const created = await call(fetch, 'POST', '/people', { name: 'Ken' })
        expect(created.status).toBe(201)
        expect(await created.json()).toEqual({ name: 'Ken', id: 5 })
        expect(await (await call(fetch, 'GET', '/people/5')).json()).toEqual({ name: 'Ken', id: 5 })
    })

    it('keeps a given string id and refuses a duplicate with 422', async () => {
        const fetch = await setup(undefined, {}, { tags: [{ id: 'a', label: 'A' }] })
        expect((await call(fetch, 'POST', '/tags', { id: 'b', label: 'B' })).status).toBe(201)
        expect((await call(fetch, 'POST', '/tags', { id: 'b', label: 'C' })).status).toBe(422)
    })

    it('patches and puts a partial body without touching the id', async () => {
        const fetch = await setup()
        const patched = await call(fetch, 'PATCH', '/people/1', { name: 'Augusta', id: 99 })
        expect(await patched.json()).toEqual({ ...people[0], name: 'Augusta' })
        expect(await (await call(fetch, 'PUT', '/people/2', { age: 1 })).json()).toEqual({ ...people[1], age: 1 })
        expect((await call(fetch, 'PATCH', '/people/99', { age: 1 })).status).toBe(404)
    })

    it('deletes with 204 then answers 404', async () => {
        const fetch = await setup()
        const removed = await call(fetch, 'DELETE', '/people/1')
        expect(removed.status).toBe(204)
        expect((await call(fetch, 'GET', '/people/1')).status).toBe(404)
        expect((await call(fetch, 'DELETE', '/people/1')).status).toBe(404)
    })

    it('answers 422 for a body that is not a json object', async () => {
        const fetch = await setup()
        expect((await call(fetch, 'POST', '/people')).status).toBe(422)
        expect((await fetch(`${BASE}/people`, { method: 'POST', body: '[1]' })).status).toBe(422)
    })

    it('validates with the resource schema and keeps the store untouched on failure', async () => {
        const schema = z.object({ id: z.number(), name: z.string().min(2), age: z.number().optional(), team: z.string().optional() })
        const fetch = await setup(undefined, { people: { schema } })
        const refused = await call(fetch, 'POST', '/people', { name: 'K' })
        expect(refused.status).toBe(422)
        const body = (await refused.json()) as { message: string; errors: Record<string, string[]> }
        expect(Object.keys(body.errors)).toEqual(['name'])
        expect((await call(fetch, 'PATCH', '/people/1', { name: 1 })).status).toBe(422)
        expect(await (await call(fetch, 'GET', '/people')).json()).toEqual(people)
        expect((await call(fetch, 'PATCH', '/people/1', { name: 'Augusta' })).status).toBe(200)
    })

    it('enforces unique fields', async () => {
        const fetch = await setup(undefined, { people: { unique: ['name'] } })
        const refused = await call(fetch, 'POST', '/people', { name: 'Ada' })
        expect(refused.status).toBe(422)
        expect(await refused.json()).toEqual({ message: 'The given data was invalid.', errors: { name: ['The name has already been taken.'] } })
        expect((await call(fetch, 'PATCH', '/people/1', { name: 'Ada' })).status).toBe(200)
        expect((await call(fetch, 'PATCH', '/people/1', { name: 'Grace' })).status).toBe(422)
    })

    it('serializes concurrent creations', async () => {
        const fetch = await setup()
        const responses = await Promise.all([1, 2, 3].map(() => call(fetch, 'POST', '/people', { name: 'X' })))
        const ids = await Promise.all(responses.map(async response => ((await response.json()) as { id: number }).id))
        expect(new Set(ids).size).toBe(3)
    })
})
