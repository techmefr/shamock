import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
    entries: ['src/index', 'src/enabled'],
    declaration: true,
    rollup: {
        emitCJS: false,
    },
})
