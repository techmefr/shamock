import { ofetch } from 'ofetch'
import { afterEach, describe, expect, it } from 'vitest'
import { createMock, installMock } from '../src/mock.ts'
import type { InstalledMock } from '../src/mock.ts'

const baseUrl = 'https://api.test'
const seed = { users: [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bob' }] }

let installed: InstalledMock | undefined

afterEach(() => {
    installed?.restore()
    installed = undefined
})

describe('ofetch and $fetch', () => {
    it('is intercepted by installMock because ofetch resolves globalThis.fetch at call time', async () => {
        const client = ofetch
        installed = await installMock({ baseUrl, seed, timing: 0 })
        const result = await client<{ data: { name: string }[] }>(`${baseUrl}/users/search`, { method: 'POST', body: { search: {} } })
        expect(result.data.map(user => user.name)).toEqual(['Ann', 'Bob'])
    })

    it('is intercepted for an instance created before the install', async () => {
        const api = ofetch.create({ baseURL: baseUrl })
        installed = await installMock({ baseUrl, seed, timing: 0 })
        const result = await api<{ total: number }>('/users/search', { method: 'POST', body: {} })
        expect(result.total).toBe(2)
    })

    it('reaches the mock with ofetch.create(defaults, { fetch }) given mock.fetch', async () => {
        const mock = await createMock({ baseUrl, seed, timing: 0 })
        const api = ofetch.create({ baseURL: baseUrl }, { fetch: mock.fetch })
        const result = await api<{ total: number }>('/users/search', { method: 'POST', body: {} })
        expect(result.total).toBe(2)
    })

    it('reaches the mock with ofetch.create(defaults, { fetch }) given a fetch resolved at call time', async () => {
        const api = ofetch.create({ baseURL: baseUrl }, { fetch: (...args) => globalThis.fetch(...args) })
        installed = await installMock({ baseUrl, seed, timing: 0 })
        const result = await api<{ total: number }>('/users/search', { method: 'POST', body: {} })
        expect(result.total).toBe(2)
    })

    it('misses the mock when ofetch.create captured the real fetch before the install', async () => {
        const original = globalThis.fetch
        const real = async (): Promise<Response> => new Response(JSON.stringify({ real: true }), { headers: { 'Content-Type': 'application/json' } })
        globalThis.fetch = real
        try {
            const api = ofetch.create({ baseURL: baseUrl }, { fetch: real })
            installed = await installMock({ baseUrl, seed, timing: 0 })
            expect(globalThis.fetch).not.toBe(real)
            expect(await api('/users/search', { method: 'POST', body: {} })).toEqual({ real: true })
            installed.restore()
            installed = undefined
        } finally {
            globalThis.fetch = original
        }
    })

    it('surfaces mock errors as FetchError with the status and the data', async () => {
        installed = await installMock({ baseUrl, seed, timing: 0 })
        const error = await ofetch(`${baseUrl}/nothing/search`, { method: 'POST', body: {}, retry: 0 }).catch(caught => caught)
        expect(error.status).toBe(404)
        expect(error.data.message).toBe('Not found')
    })
})
