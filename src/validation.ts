import { HttpError } from './http-error.ts'
import { MockValidationError, parseMock } from './parse-mock.ts'
import type { Row } from './record.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'

export type FieldErrors = Record<string, string[]>

export function mergeErrors(target: FieldErrors, source: FieldErrors): void {
    for (const [key, messages] of Object.entries(source)) target[key] = [...(target[key] ?? []), ...messages]
}

function schemaErrors(error: MockValidationError, prefix: string, fallback: string): FieldErrors {
    const errors: FieldErrors = {}
    for (const issue of error.issues) {
        const path = (issue.path ?? []).map(segment => String(typeof segment === 'object' ? segment.key : segment)).join('.')
        const key = path === '' ? fallback : prefix === '' ? path : `${prefix}.${path}`
        errors[key] = [...(errors[key] ?? []), issue.message]
    }
    return errors
}

export async function validateRecord(
    resource: { schema?: StandardSchemaV1 },
    record: Row,
    prefix = '',
    fallback = 'record',
): Promise<FieldErrors> {
    if (resource.schema === undefined) return {}
    try {
        await parseMock({ schema: resource.schema }, record)
        return {}
    } catch (error) {
        if (error instanceof MockValidationError) return schemaErrors(error, prefix, fallback)
        throw error
    }
}

export const invalidData = (errors: FieldErrors): HttpError => new HttpError(422, 'The given data was invalid.', errors)
