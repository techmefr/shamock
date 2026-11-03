export type SearchRecord = Record<string, unknown>

export interface SearchFilter {
    field?: string
    operator?: string
    value?: unknown
    type?: string
    nested?: SearchFilter[]
}

export interface SearchSort {
    field?: string
    direction?: string
}

export interface SearchResult {
    data: SearchRecord[]
    current_page: number
    last_page: number
    per_page: number
    total: number
    from: number | null
    to: number | null
    meta: []
}

export interface SearchRelation {
    type: 'belongsTo' | 'hasMany'
    foreignKey: string
    records: () => SearchRecord[]
    options: () => SearchOptions
}

export type ScopeFn = (rows: SearchRecord[], params: unknown[]) => SearchRecord[]
export type InstructionFn = (rows: SearchRecord[], fields: Record<string, unknown>) => SearchRecord[]
export type GateFn = (row: SearchRecord) => boolean
export type GateName = 'view' | 'update' | 'delete' | 'restore' | 'forceDelete'

export interface SearchOptions {
    scopes?: Record<string, ScopeFn>
    instructions?: Record<string, InstructionFn>
    gates?: Partial<Record<GateName, GateFn>>
    lomkit?: boolean
    limits?: number[]
    searchable?: string[]
    likeEscape?: boolean
    maxNestingDepth?: number
    relations?: Record<string, SearchRelation>
}

export interface ParsedInclude {
    name: string
    relation: SearchRelation
    search: ParsedSearch
}

export interface ParsedAggregate {
    key: string
    type: string
    field?: string
    filters: SearchFilter[]
    relation: SearchRelation
}

export interface ParsedSearch {
    aggregates: ParsedAggregate[]
    gates: [string, GateFn][]
    prepare: ((rows: SearchRecord[]) => SearchRecord[])[]
    filters: SearchFilter[]
    sorts: SearchSort[]
    selects: string[]
    includes: ParsedInclude[]
    text?: string
    limit?: number
    options: SearchOptions
}
