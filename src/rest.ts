import { readRequiredJson } from './body.ts'
import type { Engine, EngineContext, Route } from './engine.ts'
import type { Row } from './record.ts'
import { json, notFound } from './response.ts'
import { invalidData, mergeErrors, validateRecord } from './validation.ts'
import type { FieldErrors } from './validation.ts'

export type { Row }

export interface ListPage {
    rows: Row[]
    total: number
    page: number
    perPage: number | undefined
}

export interface RestOptions {
    collection?: (page: ListPage) => unknown
    defaultPerPage?: number
}

export interface RestRoute extends Route {
    kind: 'list' | 'one' | 'create' | 'update' | 'remove'
    id?: string
}

const RESERVED = new Set(['page', 'perPage', 'limit', 'sort'])

const decode = (segment: string): string => {
    try {
        return decodeURIComponent(segment)
    } catch {
        return segment
    }
}

const positive = (value: string | null): number | undefined => {
    const number = Number(value)
    return value !== null && Number.isInteger(number) && number > 0 ? number : undefined
}

const order = (left: unknown, right: unknown): number => {
    if (left === right) return 0
    if (left === undefined || left === null) return 1
    if (right === undefined || right === null) return -1
    return (left as number | string) > (right as number | string) ? 1 : -1
}

function sorted(rows: Row[], keys: string[]): Row[] {
    if (keys.length === 0) return rows
    const fields = keys.map(key => (key.startsWith('-') ? { field: key.slice(1), sign: -1 } : { field: key.replace(/^\+/, ''), sign: 1 }))
    return [...rows].sort((a, b) => {
        for (const { field, sign } of fields) {
            const result = order(a[field], b[field])
            if (result !== 0) return result * sign
        }
        return 0
    })
}

function taken(unique: string[], record: Row, rows: Row[], attributes: Row): FieldErrors {
    const errors: FieldErrors = {}
    for (const field of unique) {
        const value = record[field]
        if (!Object.hasOwn(attributes, field) || value === undefined || value === null) continue
        if (rows.some(row => row['id'] !== record['id'] && row[field] === value)) errors[field] = [`The ${field} has already been taken.`]
    }
    return errors
}

const missing = notFound

export function rest(options: RestOptions = {}): Engine<RestRoute> {
    const list = (context: EngineContext<RestRoute>): Response => {
        const params = new URL(context.request.url).searchParams
        const wanted = new Map<string, string[]>()
        for (const [key, value] of params) {
            if (!RESERVED.has(key)) wanted.set(key, [...(wanted.get(key) ?? []), value])
        }
        const matching = context.store
            .all()
            .filter(row => [...wanted].every(([field, values]) => Object.hasOwn(row, field) && values.includes(String(row[field]))))
        const rows = sorted(matching, params.getAll('sort').flatMap(value => value.split(',')).filter(key => key !== ''))
        const given = positive(params.get('perPage')) ?? positive(params.get('limit'))
        const page = positive(params.get('page')) ?? 1
        const perPage = given ?? (params.has('page') ? (options.defaultPerPage ?? 25) : undefined)
        const slice = perPage === undefined ? rows : rows.slice((page - 1) * perPage, page * perPage)
        const body = options.collection === undefined ? slice : options.collection({ rows: slice, total: rows.length, page, perPage })
        return json(body, 200, { 'X-Total-Count': String(rows.length) })
    }

    const write = (context: EngineContext<RestRoute>): Promise<Response> =>
        readRequiredJson(context.request).then(attributes =>
            context.exclusive(async () => {
                const { store, resource, route } = context
                const creating = route.kind === 'create'
                if (!creating && !store.has(route.id)) return missing()
                const apply = (): Row => (creating ? store.insert(attributes) : (store.update(route.id, attributes) as Row))
                const candidate = store.preview(() => {
                    const record = apply()
                    return { record, errors: taken(resource.unique ?? [], record, store.all(), attributes) }
                })
                const errors: FieldErrors = candidate.errors
                mergeErrors(errors, await validateRecord(resource, candidate.record))
                if (Object.keys(errors).length > 0) throw invalidData(errors)
                return json(store.transaction(apply), creating ? 201 : 200)
            }),
        )

    return {
        match({ method, path }) {
            const [, rawName = '', rawId, extra] = path.split('/')
            if (rawName === '' || extra !== undefined) return undefined
            const resource = decode(rawName)
            const id = rawId === undefined ? undefined : decode(rawId)
            if (method === 'GET') return id === undefined ? { resource, kind: 'list' } : { resource, kind: 'one', id }
            if (method === 'POST' && id === undefined) return { resource, kind: 'create' }
            if ((method === 'PATCH' || method === 'PUT') && id !== undefined) return { resource, kind: 'update', id }
            if (method === 'DELETE' && id !== undefined) return { resource, kind: 'remove', id }
            return undefined
        },
        async handle(context) {
            const { route, store } = context
            if (route.kind === 'list') return list(context)
            if (route.kind === 'one') {
                const row = store.get(route.id)
                return row === undefined ? missing() : json(row)
            }
            if (route.kind === 'remove') {
                return context.exclusive(async () => {
                    if (!store.has(route.id)) return missing()
                    store.remove(route.id)
                    return new Response(null, { status: 204 })
                })
            }
            return write(context)
        },
    }
}
