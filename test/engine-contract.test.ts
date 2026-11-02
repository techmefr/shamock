import { lomkit } from '../src/lomkit.ts'
import { rest } from '../src/rest.ts'
import { echoEngine, engineContract } from './engine-contract.ts'

engineContract({
    name: 'a fake engine of fifteen lines',
    engine: echoEngine,
    list: { method: 'GET', path: '/users' },
    create: { method: 'POST', path: '/users', body: { name: 'Linus' } },
    rows: body => body as unknown[],
})

engineContract({
    name: 'rest',
    engine: () => rest(),
    list: { method: 'GET', path: '/users' },
    create: { method: 'POST', path: '/users', body: { name: 'Linus' } },
    rows: body => body as unknown[],
})

engineContract({
    name: 'lomkit',
    engine: () => lomkit(),
    list: { method: 'POST', path: '/users/search', body: {} },
    create: { method: 'POST', path: '/users/mutate', body: { mutate: [{ operation: 'create', attributes: { name: 'Linus' } }] } },
    rows: body => (body as { data: unknown[] }).data,
})
