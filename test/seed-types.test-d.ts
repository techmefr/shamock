import { describe, expectTypeOf, it } from 'vitest'
import { createMock } from '../src/index.ts'
import type { MockConfig, MockSeed } from '../src/index.ts'

interface UserInterface {
    id: number
    name: string
}

type UserAlias = {
    id: number
    name: string
}

describe('seed typing', () => {
    it('accepts an interface and a type alias', () => {
        const users: UserInterface[] = [{ id: 1, name: 'Ada' }]
        const posts: UserAlias[] = [{ id: 1, name: 'Hello' }]
        expectTypeOf({ users, posts }).toExtend<MockSeed>()
        expectTypeOf<{ baseUrl: string; seed: { users: UserInterface[] } }>().toExtend<MockConfig>()
        expectTypeOf(createMock).parameter(0).toExtend<MockConfig>()
    })

    it('still rejects a seed entry that is not a list of objects', () => {
        expectTypeOf<{ users: string[] }>().not.toExtend<MockSeed>()
        expectTypeOf<{ users: UserInterface }>().not.toExtend<MockSeed>()
    })
})
