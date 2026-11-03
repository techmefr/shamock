import { isRecord, own } from '../record.ts'
import { aggregatesOf, declaredKeys, gatesOf, instructionsOf, scopesOf } from './declared.ts'
import { filtersOf, invalid, limitOf, listOf, optionalString, selectsOf, sortsOf, textOf } from './search-input.ts'
import type { ParsedInclude, ParsedSearch, SearchFilter, SearchOptions, SearchRelation } from './search-types.ts'

const LOMKIT_NESTING = 1
export const MAX_NESTING = 10
const DEFAULT_NESTING = MAX_NESTING
const INCLUDE_KEYS = ['relation', 'filters', 'sorts', 'selects', 'includes', 'limit']
const REFUSED_KEYS = ['aggregates', 'scopes', 'instructions', 'gates']

export function searchOf(body: Record<string, unknown> | undefined): Record<string, unknown> {
    if (body === undefined) return {}
    const nested = own(body, 'search')
    return isRecord(nested) ? nested : body
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

function includesOf(value: unknown, options: SearchOptions, path: string): ParsedInclude[] {
    const includes: ParsedInclude[] = []
    listOf(value, 'includes').forEach((item, index) => {
        const name = optionalString(item, 'relation')
        const relation = name === undefined || !Object.hasOwn(options.relations ?? {}, name) ? undefined : (options.relations as Record<string, SearchRelation>)[name]
        if (name === undefined || relation === undefined) {
            if (options.lomkit === true) throw invalid(`unknown relation "${name ?? ''}"`)
            return
        }
        includes.push({ name, relation, search: parseSearch(item, relation.options(), `${path}.includes.${index}`, INCLUDE_KEYS) })
    })
    return includes
}

export function parseSearch(search: Record<string, unknown>, options: SearchOptions, path: string, allowed: string[], root = false): ParsedSearch {
    const lomkit = options.lomkit === true
    const declared = root ? declaredKeys(options) : []
    checkKeys(search, [...allowed, ...declared], lomkit)
    const maxDepth = options.maxNestingDepth ?? (lomkit ? LOMKIT_NESTING : DEFAULT_NESTING)
    const filters = filtersOf(own(search, 'filters'), maxDepth, lomkit)
    const text = textOf(search)
    if (lomkit && text !== undefined && hasLike(filters)) throw invalid('"like" filters cannot be combined with text search')
    const has = (key: string): boolean => declared.includes(key)
    return {
        aggregates: has('aggregates') ? aggregatesOf(own(search, 'aggregates'), options, maxDepth) : [],
        gates: has('gates') ? gatesOf(own(search, 'gates'), options) : [],
        prepare: [
            ...(has('scopes') ? scopesOf(own(search, 'scopes'), options) : []),
            ...(has('instructions') ? instructionsOf(own(search, 'instructions'), options) : []),
        ],
        filters,
        sorts: sortsOf(own(search, 'sorts')),
        selects: selectsOf(own(search, 'selects')),
        includes: includesOf(own(search, 'includes'), options, path),
        text,
        limit: limitOf(search, options, path),
        options,
    }
}
