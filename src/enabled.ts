const TRUTHY = new Set(['1', 'true', 'on', 'yes'])

type Env = Record<string, unknown>

const processEnv = (): Env | undefined => (globalThis as { process?: { env?: Env } }).process?.env

export function isMockEnabled(env: Env | undefined = processEnv(), variable = 'SHAMOCK'): boolean {
    const value = env?.[variable]
    if (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') return false
    return TRUTHY.has(String(value).trim().toLowerCase())
}
