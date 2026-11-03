import type { MockResource } from './engine.ts'
import { MAX_DELAY } from './failures.ts'
import { parseMockList } from './parse-mock.ts'
import type { MockSeed } from './scenarios.ts'

export async function validatedSeed(
    seedConfig: MockSeed,
    resources: Record<string, MockResource>,
): Promise<Map<string, Record<string, unknown>[]>> {
    for (const name of Object.keys(resources)) {
        if (resources[name]?.mock !== false && !Object.hasOwn(seedConfig, name)) throw new Error(`Resource "${name}" has no entry in seed`)
    }
    const seed = new Map<string, Record<string, unknown>[]>()
    for (const [name, items] of Object.entries(seedConfig)) {
        const schema = Object.hasOwn(resources, name) ? resources[name]?.schema : undefined
        seed.set(name, schema ? ((await parseMockList({ schema }, items)) as Record<string, unknown>[]) : (items as Record<string, unknown>[]))
    }
    return seed
}

export function validatedTiming(timing: number | undefined): number {
    if (timing === undefined) return 300
    if (!Number.isFinite(timing) || timing < 0 || timing > MAX_DELAY) {
        throw new RangeError(`Invalid timing: expected a number between 0 and ${MAX_DELAY}`)
    }
    return timing
}

export function validatedUnhandled(unhandled: unknown): void {
    if (unhandled !== undefined && unhandled !== 'passthrough' && unhandled !== 'error') {
        throw new TypeError('Invalid unhandled: expected "passthrough" or "error"')
    }
}
