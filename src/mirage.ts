export interface MirageResourceSeed {
    [resourceName: string]: Record<string, unknown>[]
}

export interface MiragePilotaConfig {
    baseUrl: string
    seed: MirageResourceSeed
}

export async function setupMirageMock(config: MiragePilotaConfig): Promise<unknown> {
    const { createServer, Model } = await import('miragejs')

    const models = Object.fromEntries(
        Object.keys(config.seed).map(name => [name, Model.extend({})]),
    )

    return createServer({
        models,

        seeds(server) {
            for (const [name, items] of Object.entries(config.seed)) {
                server.db.loadData({ [name]: items })
            }
        },

        routes() {
            this.urlPrefix = config.baseUrl
            this.namespace = ''
            this.timing = 300

            for (const resourceName of Object.keys(config.seed)) {
                this.post(`/${resourceName}/search`, schema => ({
                    data: (schema.db as unknown as Record<string, { all: () => unknown[] }>)[resourceName].all(),
                    meta: null,
                }))

                this.post(`/${resourceName}/mutate`, (schema, request) => {
                    const body = JSON.parse(request.requestBody as string) as {
                        mutate: Record<string, unknown>[]
                    }
                    const results = (body.mutate ?? []).map(op => {
                        const db = (schema.db as unknown as Record<string, {
                            insert: (o: unknown) => unknown
                            update: (id: unknown, o: unknown) => unknown
                            find: (id: unknown) => unknown
                        }>)[resourceName]
                        if (op['id'] !== undefined) {
                            db.update(op['id'], op)
                            return db.find(op['id'])
                        }
                        return db.insert(op)
                    })
                    return { data: results }
                })

                this.delete(`/${resourceName}`, (schema, request) => {
                    const body = JSON.parse(request.requestBody as string) as { id: unknown }
                    ;(schema.db as unknown as Record<string, { remove: (id: unknown) => void }>)[resourceName].remove(body.id)
                    return { success: true }
                })
            }
        },
    })
}
