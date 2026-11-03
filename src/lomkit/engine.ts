import { readJson } from '../body.ts'
import type { Engine, EngineSetup, Route } from '../engine.ts'
import { json, notFound } from '../response.ts'
import { normalizeDates } from './dates.ts'
import { applySearch, DEFAULT_LIMITS, MAX_NESTING, searchOf } from './search.ts'
import type { GateFn, GateName, InstructionFn, ScopeFn, SearchOptions } from './search.ts'
import { mutate, remove } from './writes.ts'
import type { Context } from './writes.ts'

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
            if (action === 'mutate') return mutate(context, strict)
            if (action === 'remove') return remove(context, strict)
            return notFound()
        },
        validate: validatedRelations,
    }
    if (strict) engine.normalize = normalizeDates
    return engine
}
