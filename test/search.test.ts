import { describe, expect, it } from 'vitest'
import { applySearch, searchOf } from '../src/mirage-search.ts'

const users = [
    { id: 1, name: 'Ann', age: 30, city: 'Paris' },
    { id: 2, name: 'Bob', age: 17, city: 'Lyon' },
    { id: 3, name: 'Cleo', age: 45, city: 'Paris' },
]

describe('searchOf', () => {
    it('unwraps the lomkit search key and accepts a flat body', () => {
        expect(searchOf({ search: { limit: 2 } })).toEqual({ limit: 2 })
        expect(searchOf({ limit: 2 })).toEqual({ limit: 2 })
        expect(searchOf(undefined)).toEqual({})
    })
})

describe('applySearch', () => {
    it('returns everything without meta when there is no limit', () => {
        const result = applySearch(users, {})

        expect(result.data).toHaveLength(3)
        expect(result.meta).toBeUndefined()
    })

    it.each([
        ['=', { field: 'city', operator: '=', value: 'Paris' }, [1, 3]],
        ['!=', { field: 'city', operator: '!=', value: 'Paris' }, [2]],
        ['>=', { field: 'age', operator: '>=', value: 30 }, [1, 3]],
        ['<', { field: 'age', operator: '<', value: 30 }, [2]],
        ['like', { field: 'name', operator: 'like', value: 'a%' }, [1]],
        ['not like', { field: 'name', operator: 'not like', value: '%o%' }, [1]],
        ['in', { field: 'id', operator: 'in', value: [2, 3] }, [2, 3]],
        ['not in', { field: 'id', operator: 'not in', value: [2, 3] }, [1]],
    ])('filters with %s', (_label, filter, ids) => {
        expect(applySearch(users, { filters: [filter] }).data.map(user => user.id)).toEqual(ids)
    })

    it('applies and, or and nested groups left to right', () => {
        const result = applySearch(users, {
            filters: [
                { field: 'city', operator: '=', value: 'Lyon' },
                { nested: [{ field: 'age', operator: '>', value: 40 }, { field: 'city', operator: '=', value: 'Paris', type: 'or' }], type: 'or' },
            ],
        })

        expect(result.data.map(user => user.id)).toEqual([1, 2, 3])
    })

    it('sorts ascending and descending, with ties kept stable', () => {
        expect(applySearch(users, { sorts: [{ field: 'age', direction: 'desc' }] }).data.map(user => user.id)).toEqual([3, 1, 2])
        expect(applySearch(users, { sorts: [{ field: 'city' }, { field: 'age', direction: 'desc' }] }).data.map(user => user.id)).toEqual([2, 3, 1])
    })

    it('paginates and reports meta', () => {
        const result = applySearch(users, { limit: 2, page: 2 })

        expect(result.data.map(user => user.id)).toEqual([3])
        expect(result.meta).toEqual({ current_page: 2, last_page: 2, per_page: 2, total: 3 })
    })

    it('reports a single empty page when nothing matches', () => {
        const result = applySearch(users, { filters: [{ field: 'id', operator: '=', value: 99 }], limit: 5 })

        expect(result.data).toEqual([])
        expect(result.meta).toEqual({ current_page: 1, last_page: 1, per_page: 5, total: 0 })
    })

    it('ignores unknown operators and escapes regex characters in like', () => {
        expect(applySearch(users, { filters: [{ field: 'id', operator: '??', value: 1 }] }).data).toHaveLength(3)
        expect(applySearch([{ name: 'a.b' }, { name: 'axb' }], { filters: [{ field: 'name', operator: 'like', value: 'a.b' }] }).data).toEqual([{ name: 'a.b' }])
    })
})

describe('like robustness and sorting', () => {
    it('matches pathological patterns in linear-ish time', () => {
        const text = 'a'.repeat(50000)
        const start = Date.now()
        const result = applySearch([{ v: text }], { filters: [{ field: 'v', operator: 'like', value: '%a%a%a%a%a%a%a%b' }] })
        expect(result.data).toHaveLength(0)
        expect(Date.now() - start).toBeLessThan(2000)
    })

    it('supports underscore, case insensitivity and anchors', () => {
        const rows = [{ v: 'Hello' }, { v: 'help' }]
        expect(applySearch(rows, { filters: [{ field: 'v', operator: 'like', value: 'hel_o' }] }).data).toEqual([{ v: 'Hello' }])
        expect(applySearch(rows, { filters: [{ field: 'v', operator: 'like', value: 'HEL%' }] }).data).toHaveLength(2)
        expect(applySearch(rows, { filters: [{ field: 'v', operator: 'not like', value: '%lp' }] }).data).toEqual([{ v: 'Hello' }])
    })

    it('sorts null and undefined last in both directions, keeping order stable', () => {
        const rows = [{ id: 1 }, { id: 2, n: 5 }, { id: 3, n: null }, { id: 4, n: 1 }, { id: 5 }]
        const asc = applySearch(rows, { sorts: [{ field: 'n', direction: 'asc' }] }).data.map(r => r['id'])
        const desc = applySearch(rows, { sorts: [{ field: 'n', direction: 'desc' }] }).data.map(r => r['id'])
        expect(asc).toEqual([4, 2, 1, 3, 5])
        expect(desc).toEqual([2, 4, 1, 3, 5])
    })
})
