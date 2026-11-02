import { describe, expect, it } from 'vitest'
import { createMock } from '../src/mock.ts'
import type { MockConfig } from '../src/mock.ts'

type Row = Record<string, any>

async function start(config: Partial<MockConfig> & { seed: MockConfig['seed'] }) {
    const mock = await createMock({ baseUrl: 'http://api.test', timing: 0, ...config })
    const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
        const response = await mock.fetch(`http://api.test${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: response.status, body: await response.json() }
    }
    const search = (search: unknown) => call('POST', '/users/search', { search })
    return { call, search }
}

const ids = (result: { body: any }): number[] => result.body.data.map((row: Row) => row.id)

describe('without a profile', () => {
    it('accepts any positive limit', async () => {
        const { search } = await start({ seed: { users: Array.from({ length: 30 }, (_, index) => ({ id: index + 1 })) } })
        expect((await search({ limit: 7 })).body.per_page).toBe(7)
        expect((await search({ limit: 7 })).body.data).toHaveLength(7)
    })

    it('names mutation errors after the field', async () => {
        const { call } = await start({ seed: { users: [{ id: 1, email: 'a' }] }, resources: { users: { unique: ['email'] } } })
        const result = await call('POST', '/users/mutate', { mutate: [{ operation: 'create', attributes: { email: 'a' } }] })
        expect(Object.keys(result.body.errors)).toEqual(['email'])
    })

    it('deletes unknown ids and empty lists as a success', async () => {
        const { call, search } = await start({ seed: { users: [{ id: 1 }] } })
        expect((await call('DELETE', '/users', { resources: [9] })).status).toBe(200)
        expect((await call('DELETE', '/users', {})).status).toBe(200)
        expect(ids(await search({}))).toEqual([1])
    })

    it('matches no row for an empty in list and keeps null out of not in only when listed', async () => {
        const { search } = await start({ seed: { users: [{ id: 1, role: 'a' }, { id: 2, role: null }] } })
        expect((await search({ filters: [{ field: 'role', operator: 'in', value: [] }] })).body.total).toBe(0)
        expect(ids(await search({ filters: [{ field: 'role', operator: 'not in', value: ['a'] }] }))).toEqual([2])
    })

    it('keeps dates as given, folds case with unicode rules and sorts null last', async () => {
        const { search } = await start({ seed: { users: [{ id: 1, joined: '2024-05-01T08:00:00.000Z', name: 'Élodie', n: null }, { id: 2, name: 'Zoe', n: 1 }] } })
        expect((await search({})).body.data[0].joined).toBe('2024-05-01T08:00:00.000Z')
        expect(ids(await search({ filters: [{ field: 'name', operator: 'like', value: 'élodie' }] }))).toEqual([1])
        expect(ids(await search({ sorts: [{ field: 'n', direction: 'asc' }] }))).toEqual([2, 1])
    })

    it('ignores unknown keys and allows deep groups and like with text', async () => {
        const { search } = await start({ seed: { users: [{ id: 1, name: 'a' }] } })
        expect((await search({ wat: 1, aggregates: [{ x: 1 }] })).status).toBe(200)
        expect((await search({ filters: [{ nested: [{ nested: [{ field: 'name', value: 'a' }] }] }] })).status).toBe(200)
        expect(ids(await search({ filters: [{ field: 'name', operator: 'like', value: 'a' }], text: { value: 'A' } }))).toEqual([1])
    })

    it('searches text as a plain substring', async () => {
        const { search } = await start({ seed: { users: [{ id: 1, name: 'Ann' }, { id: 2, name: 'A_n' }] } })
        expect(ids(await search({ text: { value: 'A_n' } }))).toEqual([2])
    })
})
