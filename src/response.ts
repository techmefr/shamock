export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

export const notFound = (): Response => json({ message: 'Not found', errors: {} }, 404)
