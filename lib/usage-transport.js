import { createCredentialStore } from './credential.js'
import { fetchCommandCodeUsage, identifyCommandCodeAccount } from './usage.js'
import { validKey } from './accounts.js'

export function registerUsageTransport(connection, credentials, ref, provider, fetchImpl, vault) {
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
        const key = vault ? await vault.activeKey() : (await store.read(provider, { signal: request.signal }))?.key
        result = await fetchCommandCodeUsage(key, { signal: request.signal, fetchImpl })
      } catch { result = { ok: false, error: 'unavailable' } }
      return Response.json({ type: 'server-response', rpcId: body.rpcId, result })
    },
  })
}

const fields = {
  status: ['action'], usage: ['action'], logout: ['action'],
  add: ['action', 'key'], select: ['action', 'id'],
}
const validPayload = payload => {
  const expected = Object.hasOwn(fields, payload?.action) ? fields[payload.action] : undefined
  return expected && Object.keys(payload).length === expected.length && expected.every(key => Object.hasOwn(payload, key))
    && (payload.action !== 'add' || typeof payload.key === 'string')
    && (payload.action !== 'select' || typeof payload.id === 'string')
}

export function registerAccountTransport(connection, vault, fetchImpl) {
  return connection.fetch.register({
    path: '/api/commandcode-subscription/accounts', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json')
        return new Response('content type must be application/json', { status: 415 })
      let body
      try { body = await request.json() } catch { return new Response('invalid JSON', { status: 400 }) }
      if (body?.type !== 'client-request' || typeof body.rpcId !== 'string'
        || body.method !== 'commandcode-subscription/accounts' || !body.payload
        || typeof body.payload !== 'object' || Array.isArray(body.payload) || !validPayload(body.payload))
        return new Response('invalid RPC envelope', { status: 400 })
      const { action } = body.payload
      let result
      try {
        if (action === 'status') result = { ok: true, value: await vault.status() }
        else if (action === 'add') {
          if (!validKey(body.payload.key)) throw new Error('Invalid API key')
          const identity = await identifyCommandCodeAccount(body.payload.key, { signal: request.signal, fetchImpl })
          result = identity.ok ? { ok: true, value: await vault.add(body.payload.key, identity.label) } : identity
        } else if (action === 'select') result = { ok: true, value: await vault.select(body.payload.id) }
        else if (action === 'logout') result = { ok: true, value: await vault.logout() }
        else {
          const accounts = await vault.usageAccounts()
          const entries = await Promise.all(accounts.map(async account => ({ id: account.id,
            ...await fetchCommandCodeUsage(account.key, { signal: request.signal, fetchImpl }) })))
          result = { ok: true, value: entries }
        }
      } catch (error) {
        result = { ok: false, error: error?.message === 'Account already exists' ? 'duplicate'
          : error?.message === 'Too many accounts' ? 'too-many'
            : error?.message === 'Invalid API key' ? 'invalid-key' : 'unavailable' }
      }
      return Response.json({ type: 'server-response', rpcId: body.rpcId, result })
    },
  })
}
