export const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

export const own = (record: Record<string, unknown>, key: string): unknown =>
    Object.hasOwn(record, key) ? record[key] : undefined
