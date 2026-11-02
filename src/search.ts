import { toStoredDate } from './dates.ts'
import { HttpError } from './http-error.ts'
import { isRecord, own } from './record.ts'

const LOMKIT_NESTING = 1
export const MAX_NESTING = 10
const DEFAULT_NESTING = MAX_NESTING
const MAX_FILTERS = 100
const MAX_LIST_VALUES = 1000
const MAX_PATTERN_LENGTH = 256
const DEFAULT_LIMIT = 50
const SEARCH_KEYS = ['filters', 'sorts', 'selects', 'includes', 'text', 'limit', 'page']
const INCLUDE_KEYS = ['relation', 'filters', 'sorts', 'selects', 'includes', 'limit']
const REFUSED_KEYS = ['aggregates', 'scopes', 'instructions', 'gates']
const OPERATORS = new Set(['=', '!=', '>', '>=', '<', '<=', 'like', 'not like', 'in', 'not in'])

export const DEFAULT_LIMITS = [10, 25, 50]

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

export interface SearchResult {
    data: SearchRecord[]
    current_page: number
    last_page: number
    per_page: number
    total: number
    from: number | null
    to: number | null
    meta: []
}

export interface SearchRelation {
    type: 'belongsTo' | 'hasMany'
    foreignKey: string
    records: () => SearchRecord[]
    options: () => SearchOptions
}

export interface SearchOptions {
    lomkit?: boolean
    limits?: number[]
    searchable?: string[]
    likeEscape?: boolean
    maxNestingDepth?: number
    relations?: Record<string, SearchRelation>
}

interface ParsedInclude {
    name: string
    relation: SearchRelation
    search: ParsedSearch
}

interface ParsedSearch {
    filters: SearchFilter[]
    sorts: SearchSort[]
    selects: string[]
    includes: ParsedInclude[]
    text?: string
    limit?: number
    options: SearchOptions
}

interface LikeToken {
    character: string
    wildcard: boolean
}

const invalid = (what: string, errors: Record<string, string[]> = {}): HttpError => new HttpError(422, `Invalid search: ${what}`, errors)

const foldAscii = (value: string): string => value.replace(/[A-Z]/g, letter => letter.toLowerCase())

const fold = (value: string, lomkit: boolean): string => (lomkit ? foldAscii(value) : value.toLowerCase())

function likeTokens(pattern: string, escape: boolean): LikeToken[] {
    const tokens: LikeToken[] = []
    for (let index = 0; index < pattern.length; index++) {
        const character = pattern[index] as string
        if (escape && character === '\\' && index + 1 < pattern.length) {
            tokens.push({ character: pattern[++index] as string, wildcard: false })
        } else {
            tokens.push({ character, wildcard: character === '%' || character === '_' })
        }
    }
    return tokens
}

function likeMatch(value: string, pattern: string, escape: boolean, lomkit: boolean): boolean {
    const text = fold(value, lomkit)
    const glob = likeTokens(fold(pattern, lomkit), escape)
    let t = 0
    let p = 0
    let star = -1
    let mark = 0
    while (t < text.length) {
        const token = glob[p]
        if (token !== undefined && token.wildcard && token.character === '%') {
            star = p++
            mark = t
        } else if (token !== undefined && ((token.wildcard && token.character === '_') || (!token.wildcard && token.character === text[t]))) {
            p++
            t++
        } else if (star >= 0) {
            p = star + 1
            t = ++mark
        } else {
            return false
        }
    }
    while (p < glob.length && glob[p]?.wildcard === true && glob[p]?.character === '%') p++
    return p === glob.length
}

function ordered(left: unknown, right: unknown): number | undefined {
    if (typeof left === 'number' && typeof right === 'number' && !Number.isNaN(left) && !Number.isNaN(right)) {
        return left - right
    }
    if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : left > right ? 1 : 0
    return undefined
}

function likeResult(left: unknown, right: unknown, options: SearchOptions): boolean | undefined {
    if (typeof right !== 'string') return undefined
    if (typeof left !== 'string' && typeof left !== 'number' && typeof left !== 'boolean') return undefined
    return likeMatch(String(left), right, options.likeEscape !== false, options.lomkit === true)
}

const isNull = (value: unknown): boolean => value === undefined || value === null

function compare(left: unknown, operator: string, right: unknown, options: SearchOptions): boolean {
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
            return likeResult(left, right, options) === true
        case 'not like':
            return likeResult(left, right, options) === false
        case 'in':
            return Array.isArray(right) && (options.lomkit !== true || !isNull(left)) && right.includes(left)
        case 'not in':
            if (options.lomkit !== true) return Array.isArray(right) && !right.includes(left)
            return Array.isArray(right) && !isNull(left) && !right.includes(null) && !right.includes(left)
        default:
            return false
    }
}

const asText = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(asText)
    return typeof value === 'string' || typeof value === 'number' ? String(value) : value
}

function matches(record: SearchRecord, filters: SearchFilter[], options: SearchOptions): boolean {
    let group = true
    let result = false
    filters.forEach((filter, index) => {
        const field = filter.field ?? ''
        const normalize = field === 'id' ? asText : (value: unknown): unknown => value
        const current =
            filter.nested !== undefined
                ? matches(record, filter.nested, options)
                : compare(normalize(own(record, field)), filter.operator ?? '=', normalize(filter.value), options)
        if (index > 0 && filter.type === 'or') {
            result = result || group
            group = current
        } else {
            group = group && current
        }
    })
    return result || group
}

function sortRecords(records: SearchRecord[], sorts: SearchSort[], lomkit: boolean): SearchRecord[] {
    if (sorts.length === 0) return records
    return [...records].sort((a, b) => {
        for (const sort of sorts) {
            const field = sort.field ?? ''
            const left = own(a, field)
            const right = own(b, field)
            if (isNull(left) && isNull(right)) continue
            let order = 0
            if (isNull(left)) order = -1
            else if (isNull(right)) order = 1
            else if (left !== right) order = (left as number | string) > (right as number | string) ? 1 : -1
            if (order === 0) continue
            if (!lomkit && (isNull(left) || isNull(right))) return -order
            return sort.direction === 'desc' ? -order : order
        }
        return 0
    })
}

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

function valueOf(item: Record<string, unknown>, operator: string | undefined, lomkit: boolean): unknown {
    const value = own(item, 'value')
    if (Array.isArray(value) && value.length > MAX_LIST_VALUES) throw invalid(`value lists are limited to ${MAX_LIST_VALUES} items`)
    if ((operator === 'like' || operator === 'not like') && typeof value === 'string' && value.length > MAX_PATTERN_LENGTH) {
        throw invalid(`like patterns are limited to ${MAX_PATTERN_LENGTH} characters`)
    }
    if (!lomkit) return value
    if (operator === 'in' && Array.isArray(value) && value.length === 0) throw invalid('"in" needs at least one value')
    return Array.isArray(value) ? value.map(toStoredDate) : toStoredDate(value)
}

function filtersOf(value: unknown, maxDepth: number, lomkit: boolean, budget = { left: MAX_FILTERS }, depth = 0): SearchFilter[] {
    if (depth > maxDepth) throw invalid('filters are nested too deeply')
    return listOf(value, 'filters').map(item => {
        if (--budget.left < 0) throw invalid(`filters are limited to ${MAX_FILTERS}`)
        const unknown = Object.keys(item).find(key => !['field', 'operator', 'value', 'type', 'nested'].includes(key))
        if (lomkit && unknown !== undefined) throw invalid(`unknown filter key "${unknown}"`)
        const nested = own(item, 'nested')
        const operator = optionalString(item, 'operator')
        if (operator !== undefined && !OPERATORS.has(operator)) throw invalid(`unknown operator "${operator}"`)
        return {
            field: optionalString(item, 'field'),
            operator,
            type: optionalString(item, 'type'),
            value: valueOf(item, operator, lomkit),
            nested: nested === undefined ? undefined : filtersOf(nested, maxDepth, lomkit, budget, depth + 1),
        }
    })
}

function sortsOf(value: unknown): SearchSort[] {
    return listOf(value, 'sorts').map(item => ({
        field: optionalString(item, 'field'),
        direction: optionalString(item, 'direction'),
    }))
}

function selectsOf(value: unknown): string[] {
    return listOf(value, 'selects').map(item => {
        const field = optionalString(item, 'field')
        if (field === undefined) throw invalid('"selects" items need a field')
        return field
    })
}

export function searchOf(body: Record<string, unknown> | undefined): Record<string, unknown> {
    if (body === undefined) return {}
    const nested = own(body, 'search')
    return isRecord(nested) ? nested : body
}

function textOf(search: Record<string, unknown>): string | undefined {
    const text = own(search, 'text')
    if (!isRecord(text)) return undefined
    const value = own(text, 'value')
    return typeof value === 'string' && value !== '' ? value : undefined
}

const hasLike = (filters: SearchFilter[]): boolean =>
    filters.some(filter => filter.operator === 'like' || filter.operator === 'not like' || (filter.nested !== undefined && hasLike(filter.nested)))

function checkKeys(search: Record<string, unknown>, allowed: string[], lomkit: boolean): void {
    if (!lomkit) return
    for (const key of Object.keys(search)) {
        if (allowed.includes(key)) continue
        if (!REFUSED_KEYS.includes(key)) throw invalid(`unknown key "${key}"`)
        const value = search[key]
        if (!Array.isArray(value) || value.length > 0) throw invalid(`"${key}" is not supported`)
    }
}

function limitOf(search: Record<string, unknown>, options: SearchOptions, path: string): number | undefined {
    const raw = own(search, 'limit')
    if (raw === undefined) return undefined
    if (options.limits !== undefined) {
        if (typeof raw !== 'number' || !options.limits.includes(raw)) {
            const message = `The selected ${path}.limit is invalid.`
            throw new HttpError(422, message, { [`${path}.limit`]: [message] })
        }
        return raw
    }
    return typeof raw === 'number' && raw > 0 ? Math.floor(raw) : undefined
}

function includesOf(value: unknown, options: SearchOptions, path: string): ParsedInclude[] {
    return listOf(value, 'includes').map((item, index) => {
        const name = optionalString(item, 'relation')
        const relation = name === undefined || !Object.hasOwn(options.relations ?? {}, name) ? undefined : (options.relations as Record<string, SearchRelation>)[name]
        if (name === undefined || relation === undefined) throw invalid(`unknown relation "${name ?? ''}"`)
        return { name, relation, search: parseSearch(item, relation.options(), `${path}.includes.${index}`, INCLUDE_KEYS) }
    })
}

function parseSearch(search: Record<string, unknown>, options: SearchOptions, path: string, allowed: string[]): ParsedSearch {
    const lomkit = options.lomkit === true
    checkKeys(search, allowed, lomkit)
    const filters = filtersOf(own(search, 'filters'), options.maxNestingDepth ?? (lomkit ? LOMKIT_NESTING : DEFAULT_NESTING), lomkit)
    const text = textOf(search)
    if (lomkit && text !== undefined && hasLike(filters)) throw invalid('"like" filters cannot be combined with text search')
    return {
        filters,
        sorts: sortsOf(own(search, 'sorts')),
        selects: selectsOf(own(search, 'selects')),
        includes: includesOf(own(search, 'includes'), options, path),
        text,
        limit: limitOf(search, options, path),
        options,
    }
}

const containsText = (record: SearchRecord, text: string, options: SearchOptions): boolean => {
    const lomkit = options.lomkit === true
    const needle = text.toLowerCase()
    return Object.entries(record).some(([field, value]) => {
        if (typeof value !== 'string' || (options.searchable !== undefined && !options.searchable.includes(field))) return false
        return lomkit ? likeMatch(value, `%${text}%`, options.likeEscape !== false, true) : value.toLowerCase().includes(needle)
    })
}

function rowsOf(records: SearchRecord[], parsed: ParsedSearch): SearchRecord[] {
    const { text, options } = parsed
    return sortRecords(
        records.filter(record => matches(record, parsed.filters, options) && (text === undefined || containsText(record, text, options))),
        parsed.sorts,
        options.lomkit === true,
    )
}

const sameId = (left: unknown, right: unknown): boolean => !isNull(left) && !isNull(right) && String(left) === String(right)

function included(record: SearchRecord, { relation, search }: ParsedInclude): unknown {
    const related = rowsOf(relation.records(), search)
    if (relation.type === 'belongsTo') {
        const found = related.find(item => sameId(item['id'], record[relation.foreignKey]))
        return found === undefined ? null : shape(found, search)
    }
    const children = related.filter(item => sameId(item[relation.foreignKey], record['id']))
    return (search.limit === undefined ? children : children.slice(0, search.limit)).map(item => shape(item, search))
}

function shape(record: SearchRecord, parsed: ParsedSearch): SearchRecord {
    const row: SearchRecord =
        parsed.selects.length === 0
            ? { ...record }
            : Object.fromEntries(parsed.selects.filter(field => Object.hasOwn(record, field)).map(field => [field, record[field]]))
    for (const include of parsed.includes) row[include.name] = included(record, include)
    return row
}

export function applySearch(records: SearchRecord[], search: Record<string, unknown>, options: SearchOptions = {}): SearchResult {
    const parsed = parseSearch(search, options, 'search', SEARCH_KEYS)
    const rawPage = own(search, 'page')
    const filtered = rowsOf(records, parsed)
    const limit = parsed.limit ?? DEFAULT_LIMIT
    const page = typeof rawPage === 'number' && rawPage > 0 ? Math.floor(rawPage) : 1
    const data = filtered.slice((page - 1) * limit, page * limit).map(record => shape(record, parsed))
    return {
        data,
        current_page: page,
        last_page: Math.max(1, Math.ceil(filtered.length / limit)),
        per_page: limit,
        total: filtered.length,
        from: data.length === 0 ? null : (page - 1) * limit + 1,
        to: data.length === 0 ? null : (page - 1) * limit + data.length,
        meta: [],
    }
}
