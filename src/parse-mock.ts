import type { StandardSchemaV1 } from './standard-schema.ts'

// Minimal structural contract for what the mock parsers accept. Declared
// locally so chaff does not depend on nexdk's Resource/AnyResource types — any
// object carrying a Standard Schema (Zod 3.24+, Valibot, ArkType, …) is mockable.
export interface MockableResource {
    schema: StandardSchemaV1
}

export class MockValidationError extends Error {
    readonly issues: readonly StandardSchemaV1.Issue[]
    readonly index?: number

    constructor(issues: readonly StandardSchemaV1.Issue[], index?: number) {
        const prefix = index === undefined ? '' : `[${index}] `
        super(prefix + issues.map(describeIssue).join('; '))
        this.name = 'MockValidationError'
        this.issues = issues
        this.index = index
    }
}

function describeIssue(issue: StandardSchemaV1.Issue): string {
    const path = (issue.path ?? [])
        .map(segment => String(typeof segment === 'object' ? segment.key : segment))
        .join('.')
    return path === '' ? issue.message : `${path}: ${issue.message}`
}

// Standard Schema's `validate` may return a Promise (some validators run
// async refinements), so both parsers below are async even though Zod itself
// resolves synchronously for the schemas this SDK uses.
async function standardValidate<TSchema extends StandardSchemaV1>(
    schema: TSchema,
    value: unknown,
    index?: number,
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
    const result = await schema['~standard'].validate(value)
    if (result.issues) throw new MockValidationError(result.issues, index)
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
        return Promise.all(mock.map((item, index) => standardValidate(resource.schema, item, index)))
    }
    return [await standardValidate(resource.schema, mock)]
}
