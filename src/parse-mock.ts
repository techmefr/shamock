import type { StandardSchemaV1 } from './standard-schema.ts'

// Minimal structural contract for what the mock parsers accept. Declared
// locally so chaff does not depend on nexdk's Resource/AnyResource types — any
// object carrying a Standard Schema (Zod 3.24+, Valibot, ArkType, …) is mockable.
export interface MockableResource {
    schema: StandardSchemaV1
}

// Standard Schema's `validate` may return a Promise (some validators run
// async refinements), so both parsers below are async even though Zod itself
// resolves synchronously for the schemas this SDK uses.
async function standardValidate<TSchema extends StandardSchemaV1>(
    schema: TSchema,
    value: unknown,
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
    const result = await schema['~standard'].validate(value)
    if (result.issues) {
        throw new Error(result.issues.map(issue => issue.message).join('; '))
    }
    return result.value
}

export async function parseMock<TResource extends MockableResource>(
    resource: TResource,
    mock: unknown,
): Promise<unknown> {
    return standardValidate(resource.schema, mock)
}

export async function parseMockList<TResource extends MockableResource>(
    resource: TResource,
    mock: unknown,
): Promise<unknown[]> {
    if (Array.isArray(mock)) {
        return Promise.all(mock.map(item => standardValidate(resource.schema, item)))
    }
    return [await standardValidate(resource.schema, mock)]
}
