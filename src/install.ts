export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface Installation {
    previous: FetchLike
    active: boolean
}

const installations: Installation[] = []

export function installFetch(serve: (previous: () => FetchLike) => FetchLike): { fetch: FetchLike; restore: () => void } {
    const installation: Installation = { previous: globalThis.fetch, active: true }
    const served = serve(() => installation.previous)
    const mockFetch: FetchLike = (input, init) =>
        installation.active ? served(input, init) : installation.previous.call(globalThis, input, init)
    installations.push(installation)
    globalThis.fetch = mockFetch
    const restore = (): void => {
        const index = installations.indexOf(installation)
        if (index === -1) return
        installations.splice(index, 1)
        installation.active = false
        const above = installations.find(other => other.previous === mockFetch)
        if (above !== undefined) above.previous = installation.previous
        else if (globalThis.fetch === mockFetch) globalThis.fetch = installation.previous
    }
    return { fetch: mockFetch, restore }
}
