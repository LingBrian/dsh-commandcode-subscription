import assert from 'node:assert/strict'
import test from 'node:test'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { apply, createAdapter, watchModelCatalog, KEY_REF, PROVIDER } from '../src/index.js'
import { createCommandCodeProvider, parseCommandCodeModels } from '../src/commandcode-provider.js'

const MODEL = parseCommandCodeModels({ data: [{ id: 'fixture/model', name: 'Fixture', context_length: 8192 }] })[0]

function fakeContext(value) {
  const registered = []
  const disposed = []
  const effects = new Map()
  const resolutions = []
  const usageRoutes = []
  const ctx = {
    connection: { fetch: { register(route) { usageRoutes.push(route); return () => usageRoutes.splice(usageRoutes.indexOf(route), 1) } } },
    credentials: {
      async resolve(ref) {
        resolutions.push(ref)
        return value === undefined ? undefined : { value }
      },
    },
    llm: {
      registerAdapter(providers, adapter) {
        registered.push({ providers, adapter })
        return () => disposed.push(adapter)
      },
    },
    effect(register, label) {
      const dispose = register()
      effects.set(label, dispose)
      return dispose
    },
    inject(_services, register) { register({ connection: ctx.connection, effect: ctx.effect }) },
  }
  return { ctx, registered, disposed, effects, resolutions, usageRoutes }
}

function mockProvider(onStream = () => { throw new Error('synthetic stop') }) {
  return {
    id: PROVIDER,
    getModels: () => [MODEL],
    getModel: id => id === MODEL.id ? MODEL : undefined,
    streamSimple: onStream,
  }
}

const request = () => ({
  provider: PROVIDER,
  model: MODEL.id,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }],
})
const drain = async stream => { const events = []; for await (const event of stream) events.push(event); return events }

test('apply registers the Command Code route synchronously and disposal unregisters it', async t => {
  // The real provider refreshes a public catalog after registration. Prevent test network access.
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline fixture') })
  const host = fakeContext()
  apply(host.ctx)
  assert.equal(host.registered.length, 1, 'startup must not wait for a credential or catalog request')
  assert.deepEqual(host.registered[0].providers, [PROVIDER])
  assert.equal(host.registered[0].adapter.current().profiles.get(PROVIDER).provider, PROVIDER)
  assert.equal(host.resolutions.length, 0, 'registration must not read the key')
  assert.equal(host.usageRoutes.length, 2)
  assert.equal(host.usageRoutes[0].path, '/api/commandcode-subscription/usage')
  assert.equal(host.usageRoutes[1].path, '/api/commandcode-subscription/accounts')
  host.effects.get('commandcode-subscription: read-only usage')()
  host.effects.get('commandcode-subscription: accounts')()
  assert.equal(host.usageRoutes.length, 0)
  const dispose = host.effects.get('commandcode-subscription: model adapter')
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.deepEqual(host.disposed, [host.registered[0].adapter])
  await new Promise(resolve => setImmediate(resolve))
})

test('catalog refresh retries after a transient startup failure and notifies DSH', async () => {
  const controller = new AbortController()
  let attempts = 0
  let updates = 0
  const stop = watchModelCatalog({ async refreshModels() {
    attempts++
    if (attempts === 1) throw new Error('temporary catalog failure')
  } }, () => { updates++ }, { signal: controller.signal, retryMs: 1, refreshMs: 60_000 })
  try {
    for (let i = 0; i < 50 && updates === 0; i++) await new Promise(resolve => setTimeout(resolve, 2))
    assert.equal(attempts, 2)
    assert.equal(updates, 1)
  } finally { controller.abort(); stop() }
})

test('adapter lists models only after the DSH credential is present', async () => {
  const host = fakeContext()
  const adapter = createAdapter(host.ctx, { provider: mockProvider() })
  assert.deepEqual(await adapter.listModels(PROVIDER), [])
  assert.ok(host.resolutions.length >= 1)
  const authenticated = fakeContext('user_fixture_key')
  const ready = createAdapter(authenticated.ctx, { provider: mockProvider() })
  assert.deepEqual((await ready.listModels(PROVIDER)).map(model => model.id), [MODEL.id])
  assert.equal((await ready.resolveModel(PROVIDER, MODEL.id)).id, MODEL.id)
})

test('generation resolves the DSH-managed credential reference, not an environment key', async () => {
  const host = fakeContext(' user_fixture_key ')
  let options
  const adapter = createAdapter(host.ctx, { provider: mockProvider((_model, _context, actual) => {
    options = actual
    throw new Error('synthetic stop')
  }) })
  await drain(adapter.stream(request()))
  assert.deepEqual(KEY_REF, credentialRef('COMMANDCODE_API_KEY'))
  assert.ok(host.resolutions.length >= 1)
  for (const ref of host.resolutions) assert.deepEqual(ref, KEY_REF)
  assert.equal(options?.apiKey, 'user_fixture_key')
})

test('missing key fails closed before the provider transport is invoked', async () => {
  const host = fakeContext()
  let transports = 0
  const adapter = createAdapter(host.ctx, { provider: mockProvider(() => { transports++; throw new Error('transport must not run') }) })
  await assert.rejects(() => drain(adapter.stream(request())), error => error.code === 'MISSING_CREDENTIAL')
  assert.equal(transports, 0)
  assert.ok(host.resolutions.length >= 1)
})
