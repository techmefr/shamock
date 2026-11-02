import { createMock as createCoreMock } from './create-mock.ts'
import type { InstalledMock, Mock, MockOptions } from './create-mock.ts'
import type { Engine, MockResource as CoreResource, Route } from './engine.ts'
import { lomkit } from './lomkit/engine.ts'
import type { LomkitOptions, LomkitResource } from './lomkit/engine.ts'

export type { FailureRule, FetchLike, InstalledMock, Mock, MockSeed, StaticRoute } from './create-mock.ts'
export type { GateFn, GateName, InstructionFn, MockRelation, ScopeFn } from './lomkit/engine.ts'

export type MockResource = CoreResource & LomkitResource

export type MockConfig<TResource extends object = LomkitResource> = MockOptions<TResource> &
    LomkitOptions & { engine?: Engine<Route, TResource> }

export async function createMock<TResource extends object = LomkitResource>(config: MockConfig<TResource>): Promise<Mock> {
    const engine = config.engine ?? (config.enabled === false ? undefined : lomkit(config))
    return createCoreMock({ ...config, engine } as MockOptions<TResource> & { engine?: Engine<Route, TResource> })
}

export async function installMock<TResource extends object = LomkitResource>(config: MockConfig<TResource>): Promise<InstalledMock> {
    return (await createMock(config)).install()
}
