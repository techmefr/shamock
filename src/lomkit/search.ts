import { own } from '../record.ts'
import { containsText, isNull, matches, ordered, sortRecords } from './match.ts'
import { parseSearch } from './parse-search.ts'
import type { ParsedAggregate, ParsedInclude, ParsedSearch, SearchOptions, SearchRecord, SearchRelation, SearchResult } from './search-types.ts'

export { MAX_NESTING, searchOf } from './parse-search.ts'
export type {
    GateFn,
    GateName,
    InstructionFn,
    ScopeFn,
    SearchFilter,
    SearchOptions,
    SearchRecord,
    SearchRelation,
    SearchResult,
    SearchSort,
} from './search-types.ts'

const DEFAULT_LIMIT = 50
const SEARCH_KEYS = ['filters', 'sorts', 'selects', 'includes', 'text', 'limit', 'page']
const GATES_KEY = 'gates'

export const DEFAULT_LIMITS = [10, 25, 50]

function rowsOf(records: SearchRecord[], parsed: ParsedSearch): SearchRecord[] {
    const { text, options } = parsed
    return sortRecords(
        records.filter(record => matches(record, parsed.filters, options) && (text === undefined || containsText(record, text, options))),
        parsed.sorts,
        options.lomkit === true,
    )
}

const sameId = (left: unknown, right: unknown): boolean => !isNull(left) && !isNull(right) && String(left) === String(right)

function linked(record: SearchRecord, relation: SearchRelation, rows: SearchRecord[]): SearchRecord[] {
    if (relation.type === 'belongsTo') return rows.filter(item => sameId(item['id'], record[relation.foreignKey]))
    return rows.filter(item => sameId(item[relation.foreignKey], record['id']))
}

function included(record: SearchRecord, { relation, search }: ParsedInclude): unknown {
    const related = linked(record, relation, rowsOf(relation.records(), search))
    if (relation.type === 'belongsTo') {
        const [found] = related
        return found === undefined ? null : shape(found, search)
    }
    return (search.limit === undefined ? related : related.slice(0, search.limit)).map(item => shape(item, search))
}

function aggregated(record: SearchRecord, { relation, type, field, filters }: ParsedAggregate): unknown {
    const options = relation.options()
    const rows = linked(record, relation, relation.records().filter(item => matches(item, filters, options)))
    if (type === 'count') return rows.length
    if (type === 'exists') return rows.length > 0
    const values = rows.map(row => own(row, field ?? '')).filter(value => !isNull(value))
    if (type === 'sum' || type === 'avg') {
        const numbers = values.filter((value): value is number => typeof value === 'number')
        if (numbers.length === 0) return null
        const sum = numbers.reduce((total, value) => total + value, 0)
        return type === 'sum' ? sum : sum / numbers.length
    }
    const direction = type === 'min' ? -1 : 1
    const best = values.reduce<unknown>((kept, value) => (kept === undefined || (ordered(value, kept) ?? 0) * direction > 0 ? value : kept), undefined)
    return best ?? null
}

function shape(record: SearchRecord, parsed: ParsedSearch): SearchRecord {
    const row: SearchRecord =
        parsed.selects.length === 0
            ? { ...record }
            : Object.fromEntries(parsed.selects.filter(field => Object.hasOwn(record, field)).map(field => [field, record[field]]))
    for (const include of parsed.includes) row[include.name] = included(record, include)
    for (const aggregate of parsed.aggregates) row[aggregate.key] = aggregated(record, aggregate)
    if (parsed.gates.length > 0) row[GATES_KEY] = Object.fromEntries(parsed.gates.map(([name, check]) => [name, check(record)]))
    return row
}

export function applySearch(records: SearchRecord[], search: Record<string, unknown>, options: SearchOptions = {}): SearchResult {
    const parsed = parseSearch(search, options, 'search', SEARCH_KEYS, true)
    const rawPage = own(search, 'page')
    const filtered = rowsOf(
        parsed.prepare.reduce((rows, step) => step(rows), [...records]),
        parsed,
    )
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
