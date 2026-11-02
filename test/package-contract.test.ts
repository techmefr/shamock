import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

let work = ''
let packageDir = ''

function run(command: string, args: string[], cwd: string): string {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function typecheck(moduleResolution: 'bundler' | 'nodenext'): void {
    const project = join(work, moduleResolution)
    mkdirSync(join(project, 'node_modules'), { recursive: true })
    execFileSync('ln', ['-s', packageDir, join(project, 'node_modules', 'shamock')])
    writeFileSync(
        join(project, 'index.ts'),
        [
            "import { createMock, installMock, isMockEnabled, parseMock } from 'shamock'",
            "import type { MockConfig, MockSeed } from 'shamock'",
            "import { isMockEnabled as enabled } from 'shamock/enabled'",
            'export const seed: MockSeed = { users: [] }',
            "export const config: MockConfig = { baseUrl: 'http://localhost', seed }",
            'export { createMock, installMock, isMockEnabled, parseMock, enabled }',
        ].join('\n'),
    )
    writeFileSync(
        join(project, 'package.json'),
        JSON.stringify({ type: 'module' }),
    )
    writeFileSync(
        join(project, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                target: 'ESNext',
                module: moduleResolution === 'bundler' ? 'ESNext' : 'NodeNext',
                moduleResolution,
                strict: true,
                skipLibCheck: false,
                noEmit: true,
                types: [],
            },
            files: ['index.ts'],
        }),
    )
    run('node', [tsc, '-p', project], project)
}

function declarationFiles(directory: string): string[] {
    return readdirSync(directory).filter((file) => /\.d\.m?ts$/.test(file)).map((file) => join(directory, file))
}

beforeAll(() => {
    run('node', [join(root, 'node_modules', 'unbuild', 'dist', 'cli.mjs')], root)
    work = mkdtempSync(join(tmpdir(), 'shamock-contract-'))
    run('npm', ['pack', '--pack-destination', work, '--ignore-scripts'], root)
    const tarball = readdirSync(work).find((file) => file.endsWith('.tgz'))
    if (!tarball) throw new Error('npm pack produced no tarball')
    run('tar', ['-xzf', join(work, tarball), '-C', work], work)
    packageDir = join(work, 'package')
}, 120_000)

afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true })
})

describe('published declarations', () => {
    it('only import paths that exist next to them', () => {
        const dist = join(packageDir, 'dist')
        for (const file of declarationFiles(dist)) {
            const source = readFileSync(file, 'utf8')
            for (const match of source.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
                const target = resolve(dirname(file), match[1] ?? '')
                const candidates = [target, target.replace(/\.js$/, '.d.ts'), target.replace(/\.mjs$/, '.d.mts')]
                expect(candidates.some((candidate) => existsSync(candidate) && /\.d\.m?ts$/.test(candidate)), `${file} -> ${match[1]}`).toBe(true)
            }
        }
    })

    it('point every export types condition at an existing file', () => {
        const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { exports: Record<string, { types: string }>; types: string }
        const declared = [manifest.types, ...Object.values(manifest.exports).map((entry) => entry.types)]
        for (const path of declared) expect(existsSync(join(packageDir, path)), path).toBe(true)
    })

    it('typecheck without skipLibCheck under bundler resolution', () => {
        expect(() => typecheck('bundler')).not.toThrow()
    }, 60_000)

    it('typecheck without skipLibCheck under nodenext resolution', () => {
        expect(() => typecheck('nodenext')).not.toThrow()
    }, 60_000)
})
