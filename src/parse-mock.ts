import type { ZodTypeAny } from 'zod'

// Minimal structural contract for what the mock parsers accept. Declared
// locally so chaff does not depend on nexdk's Resource/AnyResource types — any
// object carrying a Zod schema is mockable.
export interface MockableResource {
    schema: ZodTypeAny
}

export function parseMock<TResource extends MockableResource>(
    resource: TResource,
    mock: unknown,
): unknown {
    return resource.schema.parse(mock)
}

export function parseMockList<TResource extends MockableResource>(
    resource: TResource,
    mock: unknown,
): unknown[] {
    if (Array.isArray(mock)) {
        return mock.map(item => resource.schema.parse(item))
    }
    return [resource.schema.parse(mock)]
}
