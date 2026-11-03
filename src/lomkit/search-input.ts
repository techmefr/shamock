import { HttpError } from '../http-error.ts'
import { isRecord, own } from '../record.ts'
import { toStoredDate } from './dates.ts'
import type { SearchFilter, SearchOptions, SearchSort } from './search-types.ts'

const MAX_FILTERS = 100
const MAX_LIST_VALUES = 1000
const MAX_PATTERN_LENGTH = 256
const OPERATORS = new Set(['=', '!=', '>', '>=', '<', '<=', 'like', 'not like', 'in', 'not in'])

export const invalid = (what: string, errors: Record<string, string[]> = {}): HttpError => new HttpError(422, `Invalid search: ${what}`, errors)

export function optionalString(item: Record<string, unknown>, key: string): string | undefined {
    const value = own(item, key)
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw invalid(`"${key}" must be a string`)
    return value
}

export const plainField = (field: string | undefined): string | undefined => field?.replace(/\.keyword$/, '')

export function listOf(value: unknown, what: string): Record<string, unknown>[] {
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

export function filtersOf(value: unknown, maxDepth: number, lomkit: boolean, budget = { left: MAX_FILTERS }, depth = 0): SearchFilter[] {
    if (depth > maxDepth) throw invalid('filters are nested too deeply')
    return listOf(value, 'filters').map(item => {
        if (--budget.left < 0) throw invalid(`filters are limited to ${MAX_FILTERS}`)
        const unknown = Object.keys(item).find(key => !['field', 'operator', 'value', 'type', 'nested'].includes(key))
        if (lomkit && unknown !== undefined) throw invalid(`unknown filter key "${unknown}"`)
        const nested = own(item, 'nested')
        const operator = optionalString(item, 'operator')
        if (operator !== undefined && !OPERATORS.has(operator)) throw invalid(`unknown operator "${operator}"`)
        return {
            field: plainField(optionalString(item, 'field')),
            operator,
            type: optionalString(item, 'type'),
            value: valueOf(item, operator, lomkit),
            nested: nested === undefined ? undefined : filtersOf(nested, maxDepth, lomkit, budget, depth + 1),
        }
    })
}

export function sortsOf(value: unknown): SearchSort[] {
    return listOf(value, 'sorts').map(item => ({
        field: plainField(optionalString(item, 'field')),
        direction: optionalString(item, 'direction'),
    }))
}

export function selectsOf(value: unknown): string[] {
    return listOf(value, 'selects').map(item => {
        const field = optionalString(item, 'field')
        if (field === undefined) throw invalid('"selects" items need a field')
        return field
    })
}

export function textOf(search: Record<string, unknown>): string | undefined {
    const text = own(search, 'text')
    if (!isRecord(text)) return undefined
    const value = own(text, 'value')
    return typeof value === 'string' && value !== '' ? value : undefined
}

export function limitOf(search: Record<string, unknown>, options: SearchOptions, path: string): number | undefined {
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
