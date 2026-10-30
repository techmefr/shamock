import { HttpError } from './http-error.ts'
import { isRecord, own } from './record.ts'

export const MAX_BODY_LENGTH = 1_000_000
export const MAX_ITEMS = 1000

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const dropUnsafeKeys = (key: string, value: unknown): unknown => (UNSAFE_KEYS.has(key) ? undefined : value)

export function parseJsonBody(raw: unknown): Record<string, unknown> | undefined {
    if (typeof raw !== 'string' || raw === '') return undefined
    if (raw.length > MAX_BODY_LENGTH) throw new HttpError(413, 'Request body too large')
    try {
        const parsed: unknown = JSON.parse(raw, dropUnsafeKeys)
        return isRecord(parsed) ? parsed : undefined
    } catch {
        return undefined
    }
}

function limited<T>(items: T[]): T[] {
    if (items.length > MAX_ITEMS) throw new HttpError(422, `Too many items (max ${MAX_ITEMS})`)
    return items
}

export function mutationsOf(body: Record<string, unknown> | undefined): Record<string, unknown>[] {
    const list = body === undefined ? undefined : own(body, 'mutate')
    return Array.isArray(list) ? limited(list).filter(isRecord) : []
}

export function idsToRemove(body: Record<string, unknown> | undefined): unknown[] {
    if (body === undefined) return []
    const resources = own(body, 'resources')
    if (Array.isArray(resources)) return limited(resources)
    const id = own(body, 'id')
    return id === undefined ? [] : [id]
}

export type Mutation =
    | { kind: 'create'; attributes: Record<string, unknown> }
    | { kind: 'update'; key: unknown; attributes: Record<string, unknown> }

export function toMutation(operation: Record<string, unknown>): Mutation {
    const attributes = own(operation, 'attributes')
    const key = own(operation, 'key')
    const id = own(operation, 'id')
    if (own(operation, 'operation') === 'create' && isRecord(attributes)) return { kind: 'create', attributes }
    if (own(operation, 'operation') === 'update' && isRecord(attributes) && key !== undefined) {
        return { kind: 'update', key, attributes }
    }
    if (id !== undefined) return { kind: 'update', key: id, attributes: operation }
    return { kind: 'create', attributes: operation }
}
