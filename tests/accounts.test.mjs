import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccountVault, ACCOUNTS_KEY } from '../src/accounts.js'
import { registerAccountTransport, registerUsageTransport } from '../src/usage-transport.js'
import { createAdapter, PROVIDER } from '../src/index.js'
import { parseCommandCodeModels } from '../src/commandcode-provider.js'

function credentialFixture(legacy = 'user_legacy_key') {
  let record
  const credentials = {
    async resolve() { return legacy ? { value: legacy } : undefined },
    async readRecord(key) { assert.equal(key, ACCOUNTS_KEY); return structuredClone(record) },
    async modifyRecord(key, mutate) {
      assert.equal(key, ACCOUNTS_KEY)
      const next = await mutate(structuredClone(record))
      if (next !== undefined) record = structuredClone(next)
      return structuredClone(record)
    },
  }
  return { credentials, setLegacy: value => { legacy = value }, record: () => record }
}

test('account vault imports the existing DSH key, switches generation key, and logs out without exposing secrets', async () => {
  const host = credentialFixture()
  const vault = createAccountVault(host.credentials, 'COMMANDCODE_API_KEY', { createId: () => 'second' })
  assert.equal((await vault.status()).activeId, 'legacy')
  assert.equal(await vault.activeKey(), 'user_legacy_key')
  await vault.add('user_second_key', 'Second')
  assert.equal(await vault.activeKey(), 'user_second_key')
  assert.deepEqual((await vault.status()).accounts.map(account => account.id), ['legacy', 'second'])
  assert.doesNotMatch(JSON.stringify(await vault.status()), /user_legacy_key|user_second_key/)
  await assert.rejects(vault.add('user_second_key', 'Duplicate'), /already exists/)
  await vault.select('legacy')
  assert.equal(await vault.activeKey(), 'user_legacy_key')
  await vault.logout()
  assert.equal(await vault.activeKey(), 'user_second_key')
  await vault.logout()
  assert.equal(await vault.activeKey(), undefined)
  host.setLegacy('user_legacy_key')
  assert.deepEqual((await vault.status()).accounts, [], 'logging out must not reactivate an environment fallback')
  assert.doesNotMatch(JSON.stringify(host.record()?.payload.accounts), /user_legacy_key|user_second_key/)
})

test('account RPC validates payloads, verifies login and returns separate quotas without keys', async () => {
  const host = credentialFixture()
  const vault = createAccountVault(host.credentials, 'COMMANDCODE_API_KEY', { createId: () => 'new' })
  let route
  const calls = []
  const upstream = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization })
    if (url.endsWith('/alpha/whoami')) return Response.json({ user: { userName: init.headers.authorization.endsWith('new_key') ? 'New account' : 'Old account' } })
    if (url.endsWith('/alpha/usage/summary')) return Response.json({ totalMonthlyCredits: 2 })
    if (url.endsWith('/alpha/billing/credits')) return Response.json({ credits: { monthlyCredits: 8, planId: 'individual-goat' }, windowLimits: {
      fiveHour: { used: 1, cap: 10 }, weekly: { used: 2, cap: 10 },
    } })
    return Response.json({ data: { planId: 'individual-goat' } })
  }
  registerAccountTransport({ fetch: { register(value) { route = value; return () => {} } } }, vault, upstream)
  const rpc = async (id, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/commandcode-subscription/accounts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: id, method: 'commandcode-subscription/accounts', payload }),
    }))
    return response.status === 200 ? (await response.json()).result : response.status
  }
  assert.equal(await rpc('bad', { action: 'add', key: 'user_new_key', extra: true }), 400)
  assert.equal(await rpc('prototype', { action: 'constructor' }), 400)
  assert.equal(calls.length, 0)
  assert.deepEqual(await rpc('short', { action: 'add', key: 'x' }), { ok: false, error: 'invalid-key' })
  assert.equal(calls.length, 0)
  const added = await rpc('add', { action: 'add', key: 'user_new_key' })
  assert.equal(added.ok, true)
  assert.equal(added.value.activeId, 'new')
  const usage = await rpc('usage', { action: 'usage' })
  assert.equal(usage.ok, true)
  assert.deepEqual(usage.value.map(item => item.value.plan), ['GOAT', 'GOAT'])
  assert.equal(usage.value[1].value.windows.fiveHour.remainingPercent, 90)
  assert.equal(usage.value[1].value.windows.weekly.remainingPercent, 80)
  assert.equal(usage.value[1].value.credits.monthlyRemainingPercent, 80)
  assert.doesNotMatch(JSON.stringify({ added, usage }), /user_new_key|user_legacy_key/)
  assert.ok(calls.every(call => call.url.startsWith('https://api.commandcode.ai/')))
})

test('DSH adapter uses the selected vault key for each request', async () => {
  const host = credentialFixture()
  const vault = createAccountVault(host.credentials, 'COMMANDCODE_API_KEY', { createId: () => 'second' })
  const model = parseCommandCodeModels({ data: [{ id: 'fixture/model', context_length: 8192 }] })[0]
  const keys = []
  const provider = {
    id: PROVIDER, getModels: () => [model], getModel: id => id === model.id ? model : undefined,
    async *streamSimple(_model, _context, options) {
      keys.push(options.apiKey)
      yield { type: 'done', reason: 'stop', message: { role: 'assistant', content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }
    },
  }
  const adapter = createAdapter({ credentials: host.credentials }, { provider })
  const send = async () => { for await (const _ of adapter.stream({ provider: PROVIDER, model: model.id, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) { /* drain */ } }
  await send()
  await vault.add('user_second_key', 'Second')
  await send()
  await vault.select('legacy')
  await send()
  assert.deepEqual(keys, ['user_legacy_key', 'user_second_key', 'user_legacy_key'])
})

test('legacy usage dialog and quota strip query the selected account', async () => {
  const host = credentialFixture()
  const vault = createAccountVault(host.credentials, 'COMMANDCODE_API_KEY', { createId: () => 'second' })
  let route
  const seen = []
  registerUsageTransport({ fetch: { register(value) { route = value; return () => {} } } },
    host.credentials, 'COMMANDCODE_API_KEY', PROVIDER, async (_url, init) => {
      seen.push(init.headers.authorization)
      return new Response('no', { status: 401 })
    }, vault)
  const read = async id => route.fetch(new Request('http://localhost/api/commandcode-subscription/usage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: id, method: 'commandcode-subscription/usage', payload: {} }),
  }))
  await read('first')
  await vault.add('user_second_key', 'Second')
  await read('second')
  assert.deepEqual(new Set(seen), new Set(['Bearer user_legacy_key', 'Bearer user_second_key']))
  assert.equal(seen.at(-1), 'Bearer user_second_key')
})
