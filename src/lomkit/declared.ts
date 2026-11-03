import { own } from '../record.ts'
import { filtersOf, invalid, listOf, optionalString } from './search-input.ts'
import type { GateFn, GateName, InstructionFn, ParsedAggregate, ParsedSearch, ScopeFn, SearchOptions, SearchRelation } from './search-types.ts'

const AGGREGATE_TYPES = ['count', 'exists', 'sum', 'avg', 'min', 'max']
const FIELD_AGGREGATES = ['sum', 'avg', 'min', 'max']
const GATE_ABILITIES = ['viewAny', 'view', 'create', 'update', 'delete', 'restore', 'forceDelete']
const GATE_OUTPUT: Record<string, string> = {
    view: 'authorized_to_view',
    update: 'authorized_to_update',
    delete: 'authorized_to_delete',
    restore: 'authorized_to_restore',
    forceDelete: 'authorized_to_force_delete',
}

const declaredIn = (declarations: object | undefined, name: string | undefined): boolean =>
    name !== undefined && declarations !== undefined && Object.hasOwn(declarations, name)

export function declaredKeys(options: SearchOptions): string[] {
    const keys: string[] = []
    if (Object.keys(options.relations ?? {}).length > 0) keys.push('aggregates')
    if (options.scopes !== undefined) keys.push('scopes')
    if (options.instructions !== undefined) keys.push('instructions')
    if (options.gates !== undefined) keys.push('gates')
    return keys
}

export function aggregatesOf(value: unknown, options: SearchOptions, maxDepth: number): ParsedAggregate[] {
    const lomkit = options.lomkit === true
    const aggregates: ParsedAggregate[] = []
    for (const item of listOf(value, 'aggregates')) {
        const name = optionalString(item, 'relation')
        if (!declaredIn(options.relations, name)) {
            if (lomkit) throw invalid(`unknown relation "${name ?? ''}"`)
            continue
        }
        const relation = (options.relations as Record<string, SearchRelation>)[name as string] as SearchRelation
        const type = optionalString(item, 'type')
        if (type === undefined || !AGGREGATE_TYPES.includes(type)) throw invalid(`unknown aggregate type "${type ?? ''}"`)
        const field = optionalString(item, 'field')
        const needsField = FIELD_AGGREGATES.includes(type)
        if (field === undefined && needsField) throw invalid(`"${type}" aggregates need a field`)
        if (lomkit && field !== undefined && !needsField) throw invalid(`"${type}" aggregates take no field`)
        const alias = optionalString(item, 'alias')
        const snake = (name as string).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
        aggregates.push({
            key: alias ?? `${snake}_${type}${field === undefined ? '' : `_${field}`}`,
            type,
            field,
            relation,
            filters: filtersOf(own(item, 'filters'), maxDepth, lomkit),
        })
    }
    return aggregates
}

export function scopesOf(value: unknown, options: SearchOptions): ParsedSearch['prepare'] {
    const steps: ParsedSearch['prepare'] = []
    for (const item of listOf(value, 'scopes')) {
        const name = optionalString(item, 'name')
        if (!declaredIn(options.scopes, name)) {
            if (options.lomkit === true) throw invalid(`unknown scope "${name ?? ''}"`)
            continue
        }
        const params = own(item, 'parameters') ?? []
        if (!Array.isArray(params)) throw invalid('"parameters" must be an array')
        const scope = (options.scopes as Record<string, ScopeFn>)[name as string] as ScopeFn
        steps.push(rows => scope(rows, params))
    }
    return steps
}

export function instructionsOf(value: unknown, options: SearchOptions): ParsedSearch['prepare'] {
    const steps: ParsedSearch['prepare'] = []
    for (const item of listOf(value, 'instructions')) {
        const name = optionalString(item, 'name')
        if (!declaredIn(options.instructions, name)) {
            if (options.lomkit === true) throw invalid(`unknown instruction "${name ?? ''}"`)
            continue
        }
        const fields = Object.fromEntries(
            listOf(own(item, 'fields'), 'fields').map(field => [optionalString(field, 'name') ?? '', own(field, 'value')]),
        )
        const instruction = (options.instructions as Record<string, InstructionFn>)[name as string] as InstructionFn
        steps.push(rows => instruction(rows, fields))
    }
    return steps
}

export function gatesOf(value: unknown, options: SearchOptions): [string, GateFn][] {
    if (value !== undefined && !Array.isArray(value)) throw invalid('"gates" must be an array')
    const gates: [string, GateFn][] = []
    for (const ability of (value ?? []) as unknown[]) {
        if (typeof ability !== 'string' || !GATE_ABILITIES.includes(ability)) {
            if (options.lomkit === true) throw invalid(`unknown gate "${String(ability)}"`)
            continue
        }
        const output = GATE_OUTPUT[ability]
        if (output === undefined) continue
        const check = options.gates?.[ability as GateName]
        if (check !== undefined) gates.push([output, check])
        else if (options.lomkit === true) throw invalid(`unknown gate "${ability}"`)
    }
    return gates
}
