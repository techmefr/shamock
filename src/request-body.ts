import { HttpError } from './http-error.ts'
import { isRecord, own } from './record.ts'

export const MAX_BODY_BYTES = 1_000_000
export const MAX_ITEMS = 1000

const encoder = new TextEncoder()

const dropProto = (key: string, value: unknown): unknown => (key === '__proto__' ? undefined : value)

const tooLarge = (): HttpError => new HttpError(413, 'Request body too large')

export async function readBody(request: Request): Promise<string> {
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw tooLarge()
    return request.text()
}

export function parseJsonBody(raw: unknown): Record<string, unknown> | undefined {
    if (typeof raw !== 'string' || raw === '') return undefined
    if (encoder.encode(raw).length > MAX_BODY_BYTES) throw tooLarge()
    try {
        const parsed: unknown = JSON.parse(raw, dropProto)
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
    if (list === undefined) return []
    if (!Array.isArray(list)) throw new HttpError(422, 'Invalid mutate: expected an array')
    return limited(list).map(item => {
        if (!isRecord(item)) throw new HttpError(422, 'Invalid mutate: items must be objects')
        return item
    })
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
    const name = own(operation, 'operation')
    if (name !== undefined && name !== 'create' && name !== 'update') throw new HttpError(422, 'Unsupported operation')
    if (name === 'create' && isRecord(attributes)) return { kind: 'create', attributes }
    if (name === 'update' && isRecord(attributes) && key !== undefined) return { kind: 'update', key, attributes }
    if (id !== undefined) return { kind: 'update', key: id, attributes: operation }
    return { kind: 'create', attributes: operation }
}
