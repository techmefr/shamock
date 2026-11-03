import { own } from '../record.ts'
import type { SearchFilter, SearchOptions, SearchRecord, SearchSort } from './search-types.ts'

interface LikeToken {
    character: string
    wildcard: boolean
}

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

export function likeMatch(value: string, pattern: string, escape: boolean, lomkit: boolean): boolean {
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

export function ordered(left: unknown, right: unknown): number | undefined {
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

export const isNull = (value: unknown): boolean => value === undefined || value === null

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

export function matches(record: SearchRecord, filters: SearchFilter[], options: SearchOptions): boolean {
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

export function sortRecords(records: SearchRecord[], sorts: SearchSort[], lomkit: boolean): SearchRecord[] {
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

export const containsText = (record: SearchRecord, text: string, options: SearchOptions): boolean => {
    const lomkit = options.lomkit === true
    const needle = text.toLowerCase()
    return Object.entries(record).some(([field, value]) => {
        if (typeof value !== 'string' || (options.searchable !== undefined && !options.searchable.includes(field))) return false
        return lomkit ? likeMatch(value, `%${text}%`, options.likeEscape !== false, true) : value.toLowerCase().includes(needle)
    })
}
