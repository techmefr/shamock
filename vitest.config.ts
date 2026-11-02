import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        typecheck: { enabled: true, include: ['test/**/*.test-d.ts'] },
    },
})
