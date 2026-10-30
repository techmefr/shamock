import { describe, expect, it } from 'vitest'
import { idsToRemove, mutationsOf, parseJsonBody, toMutation } from '../src/request-body.ts'

describe('parseJsonBody', () => {
    it('parses a JSON object', () => {
        expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 })
    })

    it.each([['{'], [''], [undefined], [null], ['[1]'], ['3'], ['null']])(
        'returns undefined for %j',
        raw => {
            expect(parseJsonBody(raw)).toBeUndefined()
        },
    )
})

describe('mutationsOf', () => {
    it('returns the mutate operations', () => {
        expect(mutationsOf({ mutate: [{ id: 1 }, { name: 'x' }] })).toEqual([{ id: 1 }, { name: 'x' }])
    })

    it('returns nothing for a missing list', () => {
        expect(mutationsOf(undefined)).toEqual([])
        expect(mutationsOf({})).toEqual([])
    })

    it.each([['no'], [{}], [[1]], [[null]], [[[1]]], [['x']]])('throws a 422 for the malformed list %j', mutate => {
        expect(() => mutationsOf({ mutate })).toThrow(expect.objectContaining({ status: 422 }))
    })
})

describe('idsToRemove', () => {
    it('supports the lomkit resources array and the single id form', () => {
        expect(idsToRemove({ resources: [1, 2] })).toEqual([1, 2])
        expect(idsToRemove({ id: 7 })).toEqual([7])
    })

    it('returns nothing for an empty or missing body', () => {
        expect(idsToRemove(undefined)).toEqual([])
        expect(idsToRemove({})).toEqual([])
    })
})

describe('toMutation', () => {
    it('reads the lomkit operation shape', () => {
        expect(toMutation({ operation: 'create', attributes: { name: 'a' } })).toEqual({ kind: 'create', attributes: { name: 'a' } })
        expect(toMutation({ operation: 'update', key: 4, attributes: { name: 'b' } })).toEqual({
            kind: 'update',
            key: 4,
            attributes: { name: 'b' },
        })
    })

    it('treats a plain object with an id as an update and without as a create', () => {
        expect(toMutation({ id: 2, name: 'c' })).toEqual({ kind: 'update', key: 2, attributes: { id: 2, name: 'c' } })
        expect(toMutation({ name: 'd' })).toEqual({ kind: 'create', attributes: { name: 'd' } })
    })

    it('falls back to a create for an update without a key', () => {
        expect(toMutation({ operation: 'update', attributes: { name: 'e' } }).kind).toBe('create')
    })
})

describe('toMutation operations', () => {
    it.each(['delete', 'remove', '', null, 3])('rejects the unsupported operation %j with a 422', operation => {
        expect(() => toMutation({ operation, attributes: { name: 'x' } })).toThrow(
            expect.objectContaining({ status: 422, message: 'Unsupported operation' }),
        )
    })
})
