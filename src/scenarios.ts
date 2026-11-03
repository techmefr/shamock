import type { FailureRule } from './failures.ts'
import type { StaticRoute } from './route-table.ts'

export interface MockSeed {
    [resourceName: string]: ReadonlyArray<object>
}

export interface MockScenario {
    routes?: Record<string, StaticRoute>
    seed?: MockSeed
    failures?: FailureRule[]
}

interface Scenarized extends MockScenario {
    scenarios?: Record<string, MockScenario>
    scenario?: string
}

export function withScenario<T extends Scenarized>(config: T): T {
    if (config.scenario === undefined) return config
    const scenarios = config.scenarios ?? {}
    const chosen = Object.hasOwn(scenarios, config.scenario) ? scenarios[config.scenario] : undefined
    if (chosen === undefined) throw new Error(`Unknown scenario "${config.scenario}"`)
    return {
        ...config,
        routes: { ...config.routes, ...chosen.routes },
        seed: { ...config.seed, ...chosen.seed },
        failures: chosen.failures ?? config.failures,
    }
}
