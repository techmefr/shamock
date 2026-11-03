import { readRequiredJson } from '../body.ts'
import type { EngineContext, Route } from '../engine.ts'
import { HttpError } from '../http-error.ts'
import type { Row } from '../record.ts'
import { json } from '../response.ts'
import { invalidData, mergeErrors, validateRecord } from '../validation.ts'
import type { FieldErrors } from '../validation.ts'
import type { LomkitResource } from './engine.ts'
import { idsToRemove, mutationsOf, toMutation } from './request-body.ts'

interface AppliedMutation {
    kind: 'created' | 'updated'
    record: Row
    attributes: Record<string, unknown>
}

export type Context = EngineContext<Route, LomkitResource>

function takenErrors(unique: string[], applied: AppliedMutation[], rows: Row[], prefixed: boolean): FieldErrors {
    const errors: FieldErrors = {}
    applied.forEach(({ record, attributes }, index) => {
        for (const field of unique) {
            const value = record[field]
            if (!Object.hasOwn(attributes, field) || value === undefined || value === null) continue
            if (rows.some(row => row['id'] !== record['id'] && row[field] === value)) {
                errors[prefixed ? `mutate.${index}.attributes.${field}` : field] = [`The ${field} has already been taken.`]
            }
        }
    })
    return errors
}

export async function mutate(context: Context, strict: boolean): Promise<Response> {
    const { request, store, resource } = context
    const mutations = mutationsOf(await readRequiredJson(request)).map(toMutation)
    request.signal.throwIfAborted()
    const apply = (): AppliedMutation[] =>
        mutations.map(mutation => {
            if (mutation.kind === 'create') {
                return { kind: 'created', record: store.insert(mutation.attributes), attributes: mutation.attributes }
            }
            const updated = store.update(mutation.key, mutation.attributes)
            if (updated === null) throw new HttpError(404, 'Not found')
            return { kind: 'updated', record: updated, attributes: mutation.attributes }
        })
    return context.exclusive(async () => {
        const previewed = store.preview(() => {
            const done = apply()
            return { done, taken: takenErrors(resource.unique ?? [], done, store.all(), strict) }
        })
        const errors: FieldErrors = {}
        mergeErrors(errors, previewed.taken)
        for (const [index, { record }] of previewed.done.entries()) {
            const prefix = strict ? `mutate.${index}.attributes` : ''
            mergeErrors(errors, await validateRecord(resource, record, prefix, strict ? prefix : 'record'))
        }
        if (Object.keys(errors).length > 0) throw invalidData(errors)
        request.signal.throwIfAborted()
        const applied = store.transaction(apply)
        const idsOf = (kind: AppliedMutation['kind']): unknown[] =>
            applied.filter(entry => entry.kind === kind).map(entry => entry.record['id'])
        return json({ created: idsOf('created'), updated: idsOf('updated') })
    })
}

export async function remove(context: Context, strict: boolean): Promise<Response> {
    const { request, store } = context
    const ids = idsToRemove(await readRequiredJson(request))
    request.signal.throwIfAborted()
    if (strict && ids.length === 0) {
        const message = 'The resources field is required.'
        throw new HttpError(422, message, { resources: [message] })
    }
    return context.exclusive(async () => {
        const errors: FieldErrors = {}
        if (strict) {
            ids.forEach((id, index) => {
                if (!store.has(id)) errors[`resources.${index}`] = [`The selected resources.${index} is invalid.`]
            })
        }
        if (Object.keys(errors).length > 0) throw new HttpError(422, Object.values(errors)[0]?.[0] ?? 'Invalid ids', errors)
        store.transaction(() => ids.forEach(id => store.remove(id)))
        return json({ success: true })
    })
}
