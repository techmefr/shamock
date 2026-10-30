import { describe, expect, it } from 'vitest'
import { idsToRemove, mutationsOf, parseJsonBody } from '../src/request-body.ts'
import { applySearch, searchOf } from '../src/search.ts'

const users = [
    { id: 1, name: 'Ann' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Cleo' },
]

describe('request body guards', () => {
    it('throws for a body over the limit', () => {
        expect(() => parseJsonBody(`{"a":"${'x'.repeat(1_000_001)}"}`)).toThrow('too large')
    })

    it('throws when there are too many mutations or ids', () => {
        const many = Array.from({ length: 1001 }, () => ({}))
        expect(() => mutationsOf({ mutate: many })).toThrow('Too many')
        expect(() => idsToRemove({ resources: many })).toThrow('Too many')
    })

    it('drops __proto__ keys at any depth and keeps other keys', () => {
        const parsed = parseJsonBody('{"__proto__":{"a":1},"x":[{"__proto__":1,"constructor":1,"y":2}],"prototype":3}')
        expect(parsed).toEqual({ x: [{ constructor: 1, y: 2 }], prototype: 3 })
        expect(Object.hasOwn(parsed ?? {}, '__proto__')).toBe(false)
    })
})

describe('search guards', () => {
    it.each([
        [{ filters: 'x' }],
        [{ filters: [null] }],
        [{ filters: [{ nested: 'x' }] }],
        [{ sorts: [1] }],
        [{ sorts: {} }],
    ])('throws for %j', search => {
        expect(() => applySearch(users, search)).toThrow('Invalid search')
    })

    it('reads only own fields of a record', () => {
        expect(applySearch(users, { filters: [{ field: 'constructor', operator: '!=', value: 1 }] }).data).toHaveLength(3)
        const sorted = applySearch(users, { sorts: [{ field: 'toString' }] })
        expect(sorted.data.map(user => user['id'])).toEqual([1, 2, 3])
    })

    it('searchOf ignores a non-object search key', () => {
        expect(searchOf({ search: 'x', limit: 1 })).toEqual({ search: 'x', limit: 1 })
    })
})
