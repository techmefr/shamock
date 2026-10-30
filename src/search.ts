import { HttpError } from './http-error.ts'
import { isRecord, own } from './record.ts'

const MAX_NESTING = 10
const MAX_FILTERS = 100
const MAX_LIST_VALUES = 1000
const MAX_PATTERN_LENGTH = 256

export type SearchRecord = Record<string, unknown>

export interface SearchFilter {
    field?: string
    operator?: string
    value?: unknown
    type?: string
    nested?: SearchFilter[]
}

export interface SearchSort {
    field?: string
    direction?: string
}

export interface SearchMeta {
    current_page: number
    last_page: number
    per_page: number
    total: number
}

export interface SearchResult {
    data: SearchRecord[]
    meta?: SearchMeta
}

function likeMatch(value: string, pattern: string): boolean {
    const text = value.toLowerCase()
    const glob = pattern.toLowerCase()
    let t = 0
    let p = 0
    let star = -1
    let mark = 0
    while (t < text.length) {
        if (p < glob.length && glob[p] === '%') {
            star = p++
            mark = t
        } else if (p < glob.length && (glob[p] === '_' || glob[p] === text[t])) {
            p++
            t++
        } else if (star >= 0) {
            p = star + 1
            t = ++mark
        } else {
            return false
        }
    }
    while (p < glob.length && glob[p] === '%') p++
    return p === glob.length
}

function ordered(left: unknown, right: unknown): number | undefined {
    if (typeof left === 'number' && typeof right === 'number' && !Number.isNaN(left) && !Number.isNaN(right)) {
        return left - right
    }
    if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : left > right ? 1 : 0
    return undefined
}

function likeResult(left: unknown, right: unknown): boolean | undefined {
    if (typeof right !== 'string') return undefined
    if (typeof left !== 'string' && typeof left !== 'number' && typeof left !== 'boolean') return undefined
    return likeMatch(String(left), right)
}

function compare(left: unknown, operator: string, right: unknown): boolean {
    switch (operator) {
        case '=':
            return left === right
        case '!=':
            return left !== right
        case '>':
            return (ordered(left, right) ?? Number.NaN) > 0
        case '>=':
            return (ordered(left, right) ?? Number.NaN) >= 0
        case '<':
            return (ordered(left, right) ?? Number.NaN) < 0
        case '<=':
            return (ordered(left, right) ?? Number.NaN) <= 0
        case 'like':
            return likeResult(left, right) === true
        case 'not like':
            return likeResult(left, right) === false
        case 'in':
            return Array.isArray(right) && right.includes(left)
        case 'not in':
            return Array.isArray(right) && !right.includes(left)
        default:
            return true
    }
}

const asText = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(asText)
    return typeof value === 'string' || typeof value === 'number' ? String(value) : value
}

function matches(record: SearchRecord, filters: SearchFilter[]): boolean {
    let result = true
    filters.forEach((filter, index) => {
        const field = filter.field ?? ''
        const normalize = field === 'id' ? asText : (value: unknown): unknown => value
        const current =
            filter.nested !== undefined
                ? matches(record, filter.nested)
                : compare(normalize(own(record, field)), filter.operator ?? '=', normalize(filter.value))
        if (index === 0) result = current
        else if (filter.type === 'or') result = result || current
        else result = result && current
    })
    return result
}

function sortRecords(records: SearchRecord[], sorts: SearchSort[]): SearchRecord[] {
    if (sorts.length === 0) return records
    return [...records].sort((a, b) => {
        for (const sort of sorts) {
            const field = sort.field ?? ''
            const left = own(a, field)
            const right = own(b, field)
            const leftMissing = left === undefined || left === null
            const rightMissing = right === undefined || right === null
            if (leftMissing && rightMissing) continue
            if (leftMissing) return 1
            if (rightMissing) return -1
            if (left === right) continue
            const order = (left as number | string) > (right as number | string) ? 1 : -1
            return sort.direction === 'desc' ? -order : order
        }
        return 0
    })
}

const invalid = (what: string): HttpError => new HttpError(422, `Invalid search: ${what}`)

function optionalString(item: Record<string, unknown>, key: string): string | undefined {
    const value = own(item, key)
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw invalid(`"${key}" must be a string`)
    return value
}

function listOf(value: unknown, what: string): Record<string, unknown>[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw invalid(`"${what}" must be an array`)
    return value.map(item => {
        if (!isRecord(item)) throw invalid(`"${what}" items must be objects`)
        return item
    })
}

function valueOf(item: Record<string, unknown>, operator: string | undefined): unknown {
    const value = own(item, 'value')
    if (Array.isArray(value) && value.length > MAX_LIST_VALUES) throw invalid(`value lists are limited to ${MAX_LIST_VALUES} items`)
    if ((operator === 'like' || operator === 'not like') && typeof value === 'string' && value.length > MAX_PATTERN_LENGTH) {
        throw invalid(`like patterns are limited to ${MAX_PATTERN_LENGTH} characters`)
    }
    return value
}

function filtersOf(value: unknown, budget = { left: MAX_FILTERS }, depth = 0): SearchFilter[] {
    if (depth > MAX_NESTING) throw invalid('filters are nested too deeply')
    return listOf(value, 'filters').map(item => {
        if (--budget.left < 0) throw invalid(`filters are limited to ${MAX_FILTERS}`)
        const nested = own(item, 'nested')
        const operator = optionalString(item, 'operator')
        return {
            field: optionalString(item, 'field'),
            operator,
            type: optionalString(item, 'type'),
            value: valueOf(item, operator),
            nested: nested === undefined ? undefined : filtersOf(nested, budget, depth + 1),
        }
    })
}

function sortsOf(value: unknown): SearchSort[] {
    return listOf(value, 'sorts').map(item => ({
        field: optionalString(item, 'field'),
        direction: optionalString(item, 'direction'),
    }))
}

export function searchOf(body: Record<string, unknown> | undefined): Record<string, unknown> {
    if (body === undefined) return {}
    const nested = own(body, 'search')
    return isRecord(nested) ? nested : body
}

export function applySearch(records: SearchRecord[], search: Record<string, unknown>): SearchResult {
    const filters = filtersOf(own(search, 'filters'))
    const sorts = sortsOf(own(search, 'sorts'))
    const filtered = sortRecords(records.filter(record => matches(record, filters)), sorts)
    const rawLimit = own(search, 'limit')
    const rawPage = own(search, 'page')
    const limit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.floor(rawLimit) : undefined
    if (limit === undefined) return { data: filtered }
    const page = typeof rawPage === 'number' && rawPage > 0 ? Math.floor(rawPage) : 1
    return {
        data: filtered.slice((page - 1) * limit, page * limit),
        meta: {
            current_page: page,
            last_page: Math.max(1, Math.ceil(filtered.length / limit)),
            per_page: limit,
            total: filtered.length,
        },
    }
}
