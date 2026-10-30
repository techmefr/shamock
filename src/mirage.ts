import { idsToRemove, mutationsOf, parseJsonBody, toMutation } from './mirage-body.ts'
import { applySearch, searchOf } from './mirage-search.ts'
import type { SearchRecord } from './mirage-search.ts'
import { parseMockList } from './parse-mock.ts'
import type { MockableResource } from './parse-mock.ts'

export interface MirageResourceSeed {
    [resourceName: string]: Record<string, unknown>[]
}

export interface MirageSdkConfig {
    baseUrl: string
    seed: MirageResourceSeed
    resources?: Record<string, MockableResource>
    timing?: number
}

interface MirageDb {
    where: (query: Record<string, unknown>) => SearchRecord[]
    insert: (record: unknown) => unknown
    update: (id: unknown, record: unknown) => unknown
    find: (id: unknown) => unknown
    remove: (id: unknown) => void
}

const INVALID_BODY = { message: 'Invalid JSON body', errors: {} }

async function validatedSeed(config: MirageSdkConfig): Promise<MirageResourceSeed> {
    const resources = config.resources
    if (resources === undefined) return config.seed
    const seed: MirageResourceSeed = {}
    for (const [name, items] of Object.entries(config.seed)) {
        const resource = resources[name]
        seed[name] = resource ? ((await parseMockList(resource, items)) as Record<string, unknown>[]) : items
    }
    return seed
}

export async function setupMirageMock(config: MirageSdkConfig): Promise<unknown> {
    const { createServer, Model, Response } = await import('miragejs')
    const seed = await validatedSeed(config)

    const models = Object.fromEntries(Object.keys(seed).map(name => [name, Model.extend({})]))

    return createServer({
        models,

        seeds(server) {
            for (const [name, items] of Object.entries(seed)) {
                server.db.loadData({ [name]: items })
            }
        },

        routes() {
            this.urlPrefix = config.baseUrl
            this.namespace = ''
            this.timing = config.timing ?? 300

            for (const resourceName of Object.keys(seed)) {
                const path = encodeURIComponent(resourceName)
                const dbFor = (schema: { db: unknown }): MirageDb => (schema.db as Record<string, MirageDb>)[resourceName]

                this.post(`/${path}/search`, (schema, request) => {
                    const body = parseJsonBody(request.requestBody)
                    return applySearch(dbFor(schema).where({}), searchOf(body))
                })

                this.post(`/${path}/mutate`, (schema, request) => {
                    const body = parseJsonBody(request.requestBody)
                    if (body === undefined) return new Response(422, {}, INVALID_BODY)
                    const db = dbFor(schema)
                    const results = mutationsOf(body).map(operation => {
                        const mutation = toMutation(operation)
                        if (mutation.kind === 'create') return db.insert(mutation.attributes)
                        db.update(mutation.key, mutation.attributes)
                        return db.find(mutation.key)
                    })
                    return { data: results }
                })

                this.delete(`/${path}`, (schema, request) => {
                    const body = parseJsonBody(request.requestBody)
                    if (body === undefined) return new Response(422, {}, INVALID_BODY)
                    const db = dbFor(schema)
                    for (const id of idsToRemove(body)) db.remove(id)
                    return { success: true }
                })
            }
        },
    })
}
