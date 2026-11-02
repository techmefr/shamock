import { HttpError } from './http-error.ts'
import { isRecord } from './record.ts'

export const MAX_BODY_BYTES = 1_000_000

const encoder = new TextEncoder()

const dropProto = (key: string, value: unknown): unknown => (key === '__proto__' ? undefined : value)

const tooLarge = (): HttpError => new HttpError(413, 'Request body too large')

export async function readBody(request: Request): Promise<string> {
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw tooLarge()
    return request.text()
}

export function parseJsonBody(raw: unknown): Record<string, unknown> | undefined {
    if (typeof raw !== 'string' || raw === '') return undefined
    if (encoder.encode(raw).length > MAX_BODY_BYTES) throw tooLarge()
    try {
        const parsed: unknown = JSON.parse(raw, dropProto)
        return isRecord(parsed) ? parsed : undefined
    } catch {
        return undefined
    }
}

export async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
    const raw = await readBody(request)
    const body = parseJsonBody(raw)
    if (body === undefined && raw !== '') throw new HttpError(422, 'Invalid JSON body')
    return body
}

export async function readRequiredJson(request: Request): Promise<Record<string, unknown>> {
    const body = await readJson(request)
    if (body === undefined) throw new HttpError(422, 'Invalid JSON body')
    return body
}
