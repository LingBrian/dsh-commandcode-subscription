import { createCredentialStore } from './credential.js'
import { fetchCommandCodeUsage } from './usage.js'

export function registerUsageTransport(connection, credentials, ref, provider, fetchImpl) {
  const store = createCredentialStore(credentials, ref, provider)
  return connection.fetch.register({
    path: '/api/commandcode-subscription/usage', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }
      let body
      try { body = await request.json() } catch { return new Response('invalid JSON', { status: 400 }) }
      if (body?.type !== 'client-request' || typeof body.rpcId !== 'string' || body.method !== 'commandcode-subscription/usage'
        || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload) || Object.keys(body.payload).length !== 0) {
        return new Response('invalid RPC envelope', { status: 400 })
      }
      let result
      try {
        const credential = await store.read(provider, { signal: request.signal })
        result = await fetchCommandCodeUsage(credential?.key, { signal: request.signal, fetchImpl })
      } catch { result = { ok: false, error: 'unavailable' } }
      return Response.json({ type: 'server-response', rpcId: body.rpcId, result })
    },
  })
}
