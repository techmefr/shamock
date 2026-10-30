import { afterEach, describe, expect, it } from 'vitest'
import { installMock } from '../src/mock.ts'

const original = globalThis.fetch

afterEach(() => {
    globalThis.fetch = original
})

const post = (url: string): Promise<Response> => fetch(url, { method: 'POST', body: '{}' })

const names = async (response: Response): Promise<unknown[]> =>
    ((await response.json()) as { data: { name: string }[] }).data.map(user => user.name)

const stubNetwork = (): string[] => {
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input))
        return new Response('real')
    }) as typeof fetch
    return calls
}

describe('nested installs', () => {
    it('restores in install order', async () => {
        const calls = stubNetwork()
        const real = globalThis.fetch
        const a = await installMock({ baseUrl: 'http://a.test', timing: 0, seed: { users: [{ name: 'A' }] } })
        const b = await installMock({ baseUrl: 'http://b.test', timing: 0, seed: { users: [{ name: 'B' }] } })
        a.restore()
        expect(await (await post('http://a.test/users/search')).text()).toBe('real')
        expect(await names(await post('http://b.test/users/search'))).toEqual(['B'])
        expect(calls).toEqual(['http://a.test/users/search'])
        b.restore()
        expect(globalThis.fetch).toBe(real)
    })

    it('restores in reverse order', async () => {
        const real = globalThis.fetch
        const a = await installMock({ baseUrl: 'http://a.test', timing: 0, seed: { users: [] } })
        const afterA = globalThis.fetch
        const b = await installMock({ baseUrl: 'http://b.test', timing: 0, seed: { users: [] } })
        b.restore()
        expect(globalThis.fetch).toBe(afterA)
        a.restore()
        expect(globalThis.fetch).toBe(real)
    })

    it('serves the baseUrl of A while B is installed after A', async () => {
        const a = await installMock({ baseUrl: 'http://a.test', timing: 0, seed: { users: [{ name: 'A' }] } })
        const b = await installMock({ baseUrl: 'http://b.test', timing: 0, seed: { users: [{ name: 'B' }] } })
        expect(await names(await post('http://a.test/users/search'))).toEqual(['A'])
        expect(await names(await post('http://b.test/users/search'))).toEqual(['B'])
        b.restore()
        a.restore()
    })

    it('reads the previous fetch at install time', async () => {
        const first = stubNetwork()
        const a = await installMock({ baseUrl: 'http://a.test', timing: 0, seed: { users: [] } })
        const second: string[] = []
        const afterA = globalThis.fetch
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            second.push(String(input))
            return afterA(input, init)
        }) as typeof fetch
        const b = await installMock({ baseUrl: 'http://b.test', timing: 0, seed: { users: [] } })
        await post('http://other.test/x')
        expect(second).toEqual(['http://other.test/x'])
        expect(first).toEqual(['http://other.test/x'])
        b.restore()
        a.restore()
    })

    it('restore is idempotent', async () => {
        const real = globalThis.fetch
        const a = await installMock({ baseUrl: 'http://a.test', timing: 0, seed: { users: [] } })
        const b = await installMock({ baseUrl: 'http://b.test', timing: 0, seed: { users: [] } })
        a.restore()
        a.restore()
        b.restore()
        b.restore()
        expect(globalThis.fetch).toBe(real)
    })
})
