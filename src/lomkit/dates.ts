const STORED = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/

const format = (date: Date): string => date.toISOString().slice(0, 19).replace('T', ' ')

export function toStoredDate(value: unknown): unknown {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? value : format(value)
    if (typeof value !== 'string' || STORED.test(value)) return value
    const match = ISO.exec(value)
    if (match === null) return value
    const iso = value.replace(' ', 'T')
    const parsed = new Date(match[1] === undefined ? `${iso}Z` : iso)
    return Number.isNaN(parsed.getTime()) ? value : format(parsed)
}

export const normalizeDates = (attributes: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, toStoredDate(value)]))
