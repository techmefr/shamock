import type { FetchLike } from './install.ts'
import { canonicalQuery, routeKey, textKey } from './route-table.ts'

export interface Recorder {
    capture: (request: Request, method: string, path: string, send: FetchLike) => Promise<Response>
    recorded: () => Record<string, unknown>
    clear: () => void
}

const parsed = (text: string): { body: unknown } | undefined => {
    try {
        return { body: JSON.parse(text) }
    } catch {
        return undefined
    }
}

function entry(status: number, text: string): unknown {
    if (text === '') return { $status: status }
    const found = parsed(text)
    if (found === undefined) return undefined
    return status >= 200 && status < 300 ? found.body : { $status: status, $body: found.body }
}

export function createRecorder(): Recorder {
    const entries = new Map<string, unknown>()
    return {
        async capture(request, method, path, send) {
            const hash = textKey(await request.clone().text())
            const response = await send.call(globalThis, request)
            const value = entry(response.status, await response.clone().text())
            const key = routeKey(method, path, canonicalQuery(new URL(request.url).searchParams), hash)
            if (value !== undefined) entries.set(key, value)
            return response
        },
        recorded: () => Object.fromEntries(entries),
        clear: () => entries.clear(),
    }
}
