const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function stripUnsafeKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripUnsafeKeys)
    if (!isRecord(value)) return value
    const clean: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
        if (!UNSAFE_KEYS.has(key)) clean[key] = stripUnsafeKeys(child)
    }
    return clean
}

export function parseJsonBody(raw: unknown): Record<string, unknown> | undefined {
    if (typeof raw !== 'string' || raw === '') return undefined
    try {
        const parsed: unknown = stripUnsafeKeys(JSON.parse(raw))
        return isRecord(parsed) ? parsed : undefined
    } catch {
        return undefined
    }
}

export function mutationsOf(body: Record<string, unknown> | undefined): Record<string, unknown>[] {
    const list = body?.['mutate']
    return Array.isArray(list) ? list.filter(isRecord) : []
}

export function idsToRemove(body: Record<string, unknown> | undefined): unknown[] {
    if (body === undefined) return []
    const resources: unknown = body['resources']
    if (Array.isArray(resources)) return resources
    return body['id'] === undefined ? [] : [body['id']]
}

export type Mutation =
    | { kind: 'create'; attributes: Record<string, unknown> }
    | { kind: 'update'; key: unknown; attributes: Record<string, unknown> }

export function toMutation(operation: Record<string, unknown>): Mutation {
    const attributes = isRecord(operation['attributes']) ? operation['attributes'] : undefined
    if (operation['operation'] === 'create' && attributes) return { kind: 'create', attributes }
    if (operation['operation'] === 'update' && attributes && operation['key'] !== undefined) {
        return { kind: 'update', key: operation['key'], attributes }
    }
    if (operation['id'] !== undefined) return { kind: 'update', key: operation['id'], attributes: operation }
    return { kind: 'create', attributes: operation }
}
