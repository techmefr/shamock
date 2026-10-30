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

function compare(left: unknown, operator: string, right: unknown): boolean {
    switch (operator) {
        case '=':
            return left === right
        case '!=':
            return left !== right
        case '>':
            return (left as number) > (right as number)
        case '>=':
            return (left as number) >= (right as number)
        case '<':
            return (left as number) < (right as number)
        case '<=':
            return (left as number) <= (right as number)
        case 'like':
            return likeMatch(String(left), String(right))
        case 'not like':
            return !likeMatch(String(left), String(right))
        case 'in':
            return Array.isArray(right) && right.includes(left)
        case 'not in':
            return Array.isArray(right) && !right.includes(left)
        default:
            return true
    }
}

function matches(record: SearchRecord, filters: SearchFilter[]): boolean {
    let result = true
    filters.forEach((filter, index) => {
        const current =
            filter.nested !== undefined
                ? matches(record, filter.nested)
                : compare(record[filter.field ?? ''], filter.operator ?? '=', filter.value)
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
            const left = a[field]
            const right = b[field]
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

export function searchOf(body: Record<string, unknown> | undefined): Record<string, unknown> {
    const nested = body?.['search']
    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as Record<string, unknown>
    }
    return body ?? {}
}

export function applySearch(records: SearchRecord[], search: Record<string, unknown>): SearchResult {
    const filters = Array.isArray(search['filters']) ? (search['filters'] as SearchFilter[]) : []
    const sorts = Array.isArray(search['sorts']) ? (search['sorts'] as SearchSort[]) : []
    const filtered = sortRecords(records.filter(record => matches(record, filters)), sorts)
    const limit = typeof search['limit'] === 'number' && search['limit'] > 0 ? Math.floor(search['limit']) : undefined
    if (limit === undefined) return { data: filtered }
    const page = typeof search['page'] === 'number' && search['page'] > 0 ? Math.floor(search['page']) : 1
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
