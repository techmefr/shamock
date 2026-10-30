import { HttpError } from './http-error.ts'
import { isRecord, own } from './record.ts'
import type { SearchRecord } from './search.ts'

export const MAX_ROWS = 10_000

const toId = (value: unknown): string | number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value !== '') return value
    throw new HttpError(422, 'Invalid id: expected a non-empty string or a number')
}

export interface Store {
    all: () => SearchRecord[]
    insert: (attributes: unknown) => SearchRecord
    update: (key: unknown, attributes: Record<string, unknown>) => SearchRecord | null
    remove: (key: unknown) => void
    transaction: <T>(work: () => T) => T
}

export function createStore(items: Record<string, unknown>[]): Store {
    let rows = new Map<string, SearchRecord>()
    let nextId = 1

    const insert = (attributes: unknown): SearchRecord => {
        if (!isRecord(attributes)) throw new HttpError(422, 'Invalid record: expected an object')
        if (rows.size >= MAX_ROWS) throw new HttpError(422, `Too many records (max ${MAX_ROWS})`)
        const given = own(attributes, 'id')
        let id: string | number
        if (given === undefined || given === null) {
            while (!Number.isSafeInteger(nextId) || rows.has(String(nextId))) {
                if (!Number.isSafeInteger(nextId + 1)) throw new HttpError(422, 'No id available')
                nextId++
            }
            id = String(nextId)
        } else {
            id = toId(given)
            if (rows.has(String(id))) throw new HttpError(422, `Record "${String(id)}" already exists`)
        }
        const numeric = Number(id)
        if (Number.isSafeInteger(numeric) && String(numeric) === String(id) && numeric >= nextId) nextId = numeric + 1
        const record = { ...attributes, id }
        rows.set(String(id), record)
        return { ...record }
    }

    items.forEach(item => insert(structuredClone(item)))

    return {
        all: () => [...rows.values()].map(record => ({ ...record })),
        insert,
        update(key, attributes) {
            const current = rows.get(String(toId(key)))
            if (current === undefined) return null
            const record = { ...current, ...attributes, id: current['id'] }
            rows.set(String(current['id']), record)
            return { ...record }
        },
        remove(key) {
            rows.delete(String(toId(key)))
        },
        transaction(work) {
            const savedRows = new Map(rows)
            const savedNextId = nextId
            try {
                return work()
            } catch (error) {
                rows = savedRows
                nextId = savedNextId
                throw error
            }
        },
    }
}
