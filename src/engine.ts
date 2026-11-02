import type { Normalize, Store } from './store.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'

export interface MockResource {
    schema?: StandardSchemaV1
    unique?: string[]
    mock?: boolean
}

export interface Route {
    resource: string
}

export interface EngineRequest {
    method: string
    path: string
}

export interface EngineContext<TRoute extends Route = Route, TResource extends object = object> {
    request: Request
    method: string
    path: string
    route: TRoute
    store: Store
    resource: MockResource & Partial<TResource>
    storeOf: (name: string) => Store | undefined
    resourceOf: (name: string) => (MockResource & Partial<TResource>) | undefined
    exclusive: <T>(task: () => Promise<T>) => Promise<T>
}

export interface EngineSetup<TResource extends object = object> {
    resources: Record<string, MockResource & TResource>
    names: string[]
}

export interface Engine<TRoute extends Route = Route, TResource extends object = object> {
    match(request: EngineRequest): TRoute | undefined
    handle(context: EngineContext<TRoute, TResource>): Response | Promise<Response>
    normalize?: Normalize
    validate?(setup: EngineSetup<TResource>): void
    readonly types?: { resource: TResource }
}
