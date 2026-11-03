import { createStore } from './store.ts'
import type { Normalize, Store } from './store.ts'

export interface State {
    storeOf: (name: string) => Store | undefined
    exclusive: <T>(task: () => Promise<T>) => Promise<T>
    reset: () => void
}

export function createState(seed: Map<string, Record<string, unknown>[]>, normalize: Normalize | undefined): State {
    const storesFromSeed = (): Map<string, Store> => new Map<string, Store>([...seed].map(([name, items]) => [name, createStore(items, normalize)]))
    let stores = storesFromSeed()
    let writes: Promise<unknown> = Promise.resolve()
    return {
        storeOf: name => stores.get(name),
        exclusive<T>(task: () => Promise<T>): Promise<T> {
            const run = writes.then(task)
            writes = run.catch(() => undefined)
            return run
        },
        reset() {
            stores = storesFromSeed()
        },
    }
}
