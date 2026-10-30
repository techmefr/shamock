import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseMock, parseMockList } from '../src/parse-mock.ts'

const UserSchema = z.object({
    id: z.number(),
    name: z.string(),
    email: z.string().email(),
})

const resource = { schema: UserSchema }

describe('parseMock', () => {
    it('returns the mock when it matches the schema', async () => {
        const mock = { id: 1, name: 'Alice', email: 'alice@test.com' }
        await expect(parseMock(resource, mock)).resolves.toEqual(mock)
    })

    it('throws when the mock does not match the schema', async () => {
        await expect(parseMock(resource, { id: 'not-a-number', name: 'Alice' })).rejects.toThrow()
    })
})

describe('parseMockList', () => {
    it('wraps a single object in an array', async () => {
        const mock = { id: 1, name: 'Alice', email: 'alice@test.com' }
        const result = await parseMockList(resource, mock)
        expect(result).toEqual([mock])
        expect(result).toHaveLength(1)
    })

    it('returns every element when the mock is an array', async () => {
        const mock = [
            { id: 1, name: 'Alice', email: 'alice@test.com' },
            { id: 2, name: 'Bob', email: 'bob@test.com' },
            { id: 3, name: 'Carol', email: 'carol@test.com' },
        ]
        const result = await parseMockList(resource, mock)
        expect(result).toEqual(mock)
        expect(result).toHaveLength(3)
    })

    it('throws when an element does not match the schema', async () => {
        await expect(parseMockList(resource, [{ id: 'nope', name: 'Alice' }])).rejects.toThrow()
    })
})

describe('validation errors', () => {
    it('names the failing field and the list index', async () => {
        const bad = { id: 1, name: 'Bob', email: 'nope' }

        await expect(parseMockList(resource, [{ id: 2, name: 'Ann', email: "a@test.com" }, bad])).rejects.toMatchObject({
            name: 'MockValidationError',
            index: 1,
            message: expect.stringContaining('email'),
        })
    })

    it('aggregates several issues in one message', async () => {
        await expect(parseMock(resource, { id: 'x', name: 3, email: "a@test.com" })).rejects.toThrow(/id: .*; name: /)
    })

    it('accepts a validator that resolves asynchronously and an empty list', async () => {
        const asyncResource = {
            schema: {
                "~standard": { version: 1 as const, vendor: 'test', validate: async (value: unknown) => ({ value }) },
            },
        }

        await expect(parseMock(asyncResource, { ok: true })).resolves.toEqual({ ok: true })
        await expect(parseMockList(asyncResource, [])).resolves.toEqual([])
    })
})
