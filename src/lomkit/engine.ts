import { readJson, readRequiredJson } from '../body.ts'
import type { Engine, EngineContext, EngineSetup, Route } from '../engine.ts'
import { HttpError } from '../http-error.ts'
import type { Row } from '../record.ts'
import { json, notFound } from '../response.ts'
import { invalidData, mergeErrors, validateRecord } from '../validation.ts'
import type { FieldErrors } from '../validation.ts'
import { normalizeDates } from './dates.ts'
import { idsToRemove, mutationsOf, toMutation } from './request-body.ts'
import { applySearch, DEFAULT_LIMITS, MAX_NESTING, searchOf } from './search.ts'
import type { GateFn, GateName, InstructionFn, ScopeFn, SearchOptions } from './search.ts'

export type { GateFn, GateName, InstructionFn, ScopeFn }

export interface MockRelation {
    type: 'belongsTo' | 'hasMany'
    resource: string
    foreignKey: string
}

export interface LomkitResource {
    limits?: number[]
    searchable?: string[]
    links?: Record<string, MockRelation>
    scopes?: Record<string, ScopeFn>
    instructions?: Record<string, InstructionFn>
    gates?: Partial<Record<GateName, GateFn>>
}

export interface LomkitOptions {
    profile?: 'lomkit'
    limits?: number[]
    likeEscape?: boolean
    maxNestingDepth?: number
}

export interface LomkitRoute extends Route {
    action?: 'search' | 'mutate' | 'remove'
}

interface AppliedMutation {
    kind: 'created' | 'updated'
    record: Row
    attributes: Record<string, unknown>
}

type Context = EngineContext<Route, LomkitResource>

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

function validatedLimits(limits: number[] | undefined): number[] | undefined {
    if (limits === undefined) return undefined
    if (!Array.isArray(limits) || limits.length === 0 || !limits.every(limit => Number.isInteger(limit) && limit > 0)) {
        throw new RangeError('Invalid limits: expected a non-empty list of positive integers')
    }
    return limits
}

function validatedNesting(depth: number | undefined): number | undefined {
    if (depth === undefined) return undefined
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_NESTING) {
        throw new RangeError(`Invalid maxNestingDepth: expected an integer between 1 and ${MAX_NESTING}`)
    }
    return depth
}

function validatedRelations({ resources, names }: EngineSetup<LomkitResource>): void {
    for (const [name, resource] of Object.entries(resources)) {
        for (const [relation, link] of Object.entries(resource.links ?? {})) {
            if (link.type !== 'belongsTo' && link.type !== 'hasMany') throw new Error(`Relation "${name}.${relation}" has an unknown type`)
            if (!names.includes(link.resource)) throw new Error(`Relation "${name}.${relation}" targets unknown resource "${link.resource}"`)
        }
    }
}

const decode = (segment: string): string => {
    try {
        return decodeURIComponent(segment)
    } catch {
        return segment
    }
}

export function lomkit(options: LomkitOptions = {}): Engine<LomkitRoute, LomkitResource> {
    if (options.profile !== undefined && options.profile !== 'lomkit') throw new RangeError('Invalid profile: expected "lomkit"')
    const strict = options.profile === 'lomkit'
    const limits = validatedLimits(options.limits) ?? (strict ? DEFAULT_LIMITS : undefined)
    const nesting = validatedNesting(options.maxNestingDepth)

    const searchOptions = (context: Context, name: string): SearchOptions => {
        const resource = context.resourceOf(name)
        const relations = Object.entries(resource?.links ?? {}).map(([relation, link]) => [
            relation,
            {
                type: link.type,
                foreignKey: link.foreignKey,
                records: () => (context.storeOf(link.resource) as Context['store']).all(),
                options: () => searchOptions(context, link.resource),
            },
        ])
        return {
            scopes: resource?.scopes,
            instructions: resource?.instructions,
            gates: resource?.gates,
            lomkit: strict,
            limits: resource?.limits ?? limits,
            searchable: resource?.searchable,
            likeEscape: options.likeEscape ?? !strict,
            maxNestingDepth: nesting,
            relations: Object.fromEntries(relations),
        }
    }

    const mutate = async (context: Context): Promise<Response> => {
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

    const remove = async (context: Context): Promise<Response> => {
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

    const engine: Engine<LomkitRoute, LomkitResource> = {
        match({ method, path }) {
            const [, rawName = '', rawAction, extra] = path.split('/')
            if (rawName === '') return undefined
            const resource = decode(rawName)
            const action = rawAction === undefined ? undefined : decode(rawAction)
            if (extra !== undefined) return { resource }
            if (method === 'POST' && action === 'search') return { resource, action }
            if (method === 'POST' && action === 'mutate') return { resource, action }
            if (method === 'DELETE' && action === undefined) return { resource, action: 'remove' }
            return { resource }
        },
        async handle(context) {
            const { action } = context.route as LomkitRoute
            if (action === 'search') {
                return json(applySearch(context.store.all(), searchOf(await readJson(context.request)), searchOptions(context, context.route.resource)))
            }
            if (action === 'mutate') return mutate(context)
            if (action === 'remove') return remove(context)
            return notFound()
        },
        validate: validatedRelations,
    }
    if (strict) engine.normalize = normalizeDates
    return engine
}
