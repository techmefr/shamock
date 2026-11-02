export const MAX_DELAY = 60_000

export interface FailureRule {
    method?: string
    path?: string
    after?: number
    times?: number
    status?: number
    network?: boolean
    delay?: number
}

const count = (value: unknown, what: string): void => {
    if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
        throw new RangeError(`Invalid failure rule: "${what}" must be a non-negative integer`)
    }
}

function validated(rule: FailureRule): FailureRule {
    count(rule.after, 'after')
    count(rule.times, 'times')
    if (rule.method !== undefined && typeof rule.method !== 'string') throw new TypeError('Invalid failure rule: "method" must be a string')
    if (rule.path !== undefined && (typeof rule.path !== 'string' || !rule.path.startsWith('/'))) {
        throw new TypeError('Invalid failure rule: "path" must start with "/"')
    }
    if (rule.status !== undefined && (!Number.isInteger(rule.status) || rule.status < 400 || rule.status > 599)) {
        throw new RangeError('Invalid failure rule: "status" must be an integer from 400 to 599')
    }
    if (rule.delay !== undefined && (typeof rule.delay !== 'number' || !Number.isFinite(rule.delay) || rule.delay < 0 || rule.delay > MAX_DELAY)) {
        throw new RangeError(`Invalid failure rule: "delay" must be a number between 0 and ${MAX_DELAY}`)
    }
    if (rule.status !== undefined && rule.network === true) {
        throw new TypeError('Invalid failure rule: choose "status" or "network", not both')
    }
    if (rule.status === undefined && rule.network !== true && rule.delay === undefined) {
        throw new TypeError('Invalid failure rule: give "status", "network" or "delay"')
    }
    return rule
}

export function createFailures(rules: FailureRule[] = []): (method: string, path: string) => FailureRule | undefined {
    if (!Array.isArray(rules)) throw new TypeError('Invalid failures: expected an array')
    const checked = rules.map(validated)
    const seen = checked.map(() => 0)
    return (method, path) => {
        for (const [index, rule] of checked.entries()) {
            if (rule.method !== undefined && rule.method.toUpperCase() !== method) continue
            if (rule.path !== undefined && rule.path.replace(/\/+$/, '') !== path) continue
            const calls = (seen[index] = (seen[index] as number) + 1)
            const first = (rule.after ?? 0) + 1
            if (calls >= first && (rule.times === undefined || calls < first + rule.times)) return rule
        }
        return undefined
    }
}
