import { isRecord } from './record.ts'
import { json } from './response.ts'

export type StaticRoute = unknown | ((request: Request, path: string) => unknown)

export interface RouteTable {
    find: (method: string, path: string, hash: string | undefined) => { value: StaticRoute } | undefined
    hashed: (method: string, path: string) => boolean
}

const ROUTE_KEY = /^(?:([A-Za-z]+)\s+)?(\/\S*)(?:\s+#([0-9A-Fa-f]+))?$/

const NULL_BODY = new Set([101, 103, 204, 205, 304])

const encoder = new TextEncoder()

export const trimmed = (path: string): string => path.replace(/\/+$/, '')

const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}

export function bodyKey(body: unknown): string {
    let hash = 0x811c9dc5
    for (const byte of encoder.encode(JSON.stringify(canonical(body)) ?? '')) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
    return hash.toString(16).padStart(8, '0')
}

export function textKey(text: string): string | undefined {
    if (text === '') return undefined
    try {
        return bodyKey(JSON.parse(text))
    } catch {
        return bodyKey(text)
    }
}

export function routeTable(routes: Record<string, StaticRoute> | undefined): RouteTable {
    const table = new Map<string, StaticRoute>()
    const withHash = new Set<string>()
    for (const [key, value] of Object.entries(routes ?? {})) {
        const match = ROUTE_KEY.exec(key)
        if (match === null) throw new TypeError(`Invalid route "${key}": expected "METHOD /path", "/path" or "METHOD /path #hash"`)
        const route = `${(match[1] ?? '').toUpperCase()} ${trimmed(match[2] as string)}`
        if (match[3] !== undefined) withHash.add(route)
        table.set(match[3] === undefined ? route : `${route} #${match[3].toLowerCase()}`, value)
    }
    return {
        find(method, path, hash) {
            const plain = [`${method} ${path}`, ` ${path}`]
            const candidates = hash === undefined ? plain : [...plain.map(route => `${route} #${hash}`), ...plain]
            const key = candidates.find(candidate => table.has(candidate))
            return key === undefined ? undefined : { value: table.get(key) }
        },
        hashed: (method, path) => withHash.has(`${method} ${path}`) || withHash.has(` ${path}`),
    }
}

const isStatusValue = (value: unknown): value is { $status: number; $body?: unknown } =>
    isRecord(value) && typeof value['$status'] === 'number'

export function routeResponse(value: unknown): Response {
    if (value instanceof Response) return value
    if (!isStatusValue(value)) return json(value)
    if (value.$body === undefined || NULL_BODY.has(value.$status)) return new Response(null, { status: value.$status })
    return json(value.$body, value.$status)
}
