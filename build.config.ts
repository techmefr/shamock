import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
    entries: ['src/index', 'src/core', 'src/lomkit', 'src/rest', 'src/enabled'],
    declaration: true,
    rollup: {
        emitCJS: false,
    },
})
