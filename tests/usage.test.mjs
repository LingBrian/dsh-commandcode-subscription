import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchCommandCodeUsage, normalizeWindow } from '../src/usage.js'
import { registerUsageTransport } from '../src/usage-transport.js'

test('usage report normalizes windows, monthly balance, and partial failures without returning a key', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/alpha/whoami')) return Response.json({ user: { email: 'private@example.com' }, org: { id: 'org 1' } })
    if (url.endsWith('/alpha/usage/summary')) return Response.json({ totalCount: 12, totalMonthlyCredits: 4 })
    if (url.endsWith('/alpha/billing/credits')) return Response.json({ credits: { monthlyCredits: 6, purchasedCredits: 3 }, windowLimits: { fiveHour: { used: 2, cap: 8, resetAt: 1800000000000 }, weekly: { used: 1 } } })
    return new Response('unavailable', { status: 503 })
  }
  const result = await fetchCommandCodeUsage('user_secret', { fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.value.windows.fiveHour.remainingPercent, 75)
  assert.equal(result.value.windows.weekly.remainingPercent, undefined)
  assert.equal(result.value.credits.monthlyRemainingPercent, 60)
  assert.equal(result.value.partial, true)
  assert.match(calls[3].url, /orgId=org%201/)
  assert.ok(calls.every(call => call.init.headers.authorization === 'Bearer user_secret' && call.url.startsWith('https://api.commandcode.ai/alpha/')))
  assert.doesNotMatch(JSON.stringify(result), /user_secret|private@example.com/)
})

test('unknown caps do not create a misleading zero-percent bar', () => {
  assert.equal(normalizeWindow({ used: '3', cap: 0 }).remainingPercent, undefined)
  assert.equal(normalizeWindow({ used: '3', cap: '12' }).remainingPercent, 75)
})

test('transport validates the RPC envelope and reads credentials only on request', async () => {
  let route
  let resolveCount = 0
  const dispose = registerUsageTransport({ fetch: { register(value) { route = value; return () => {} } } }, {
    async resolve() { resolveCount++; return { value: 'user_secret' } },
  }, 'COMMANDCODE_API_KEY', 'commandcode-go', async () => new Response('no', { status: 401 }))
  assert.equal(resolveCount, 0)
  const invalid = await route.fetch(new Request('http://localhost/api/commandcode-subscription/usage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'a', method: 'commandcode-subscription/usage', payload: { key: 'leak' } }) }))
  assert.equal(invalid.status, 400)
  assert.equal(resolveCount, 0)
  const valid = await route.fetch(new Request('http://localhost/api/commandcode-subscription/usage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'b', method: 'commandcode-subscription/usage', payload: {} }) }))
  assert.equal(resolveCount, 1)
  assert.deepEqual(await valid.json(), { type: 'server-response', rpcId: 'b', result: { ok: false, error: 'invalid-key' } })
  dispose()
})
