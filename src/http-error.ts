export class HttpError extends Error {
    readonly status: number
    readonly errors: Record<string, string[]>

    constructor(status: number, message: string, errors: Record<string, string[]> = {}) {
        super(message)
        this.name = 'HttpError'
        this.status = status
        this.errors = errors
    }
}
