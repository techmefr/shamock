import { trimmed } from './route-table.ts'

export const urlOf = (input: RequestInfo | URL): URL | undefined => {
    if (input instanceof URL) return input
    try {
        return new URL(typeof input === 'string' ? input : input.url)
    } catch {
        return undefined
    }
}

export const methodOf = (input: RequestInfo | URL, init: RequestInit | undefined): string =>
    (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

export function scopeOf(baseUrl: string): (url: URL | undefined) => string | undefined {
    const base = new URL(baseUrl)
    const basePath = base.pathname.replace(/\/+$/, '')
    return url => {
        if (url === undefined || url.origin !== base.origin) return undefined
        if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return undefined
        return trimmed(url.pathname.slice(basePath.length))
    }
}
