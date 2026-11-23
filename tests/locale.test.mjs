import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdapter, PROVIDER } from '../src/index.js'
import { createCredentialStore } from '../src/credential.js'
import { createCommandCodeProvider } from '../src/commandcode-provider.js'
import { localize, normalizeLocale } from '../src/locale.js'

const model = createCommandCodeProvider().getModels()[0]
const context = { messages: [{ role: 'user', content: 'hello' }] }
const request = locale => ({ provider: PROVIDER, model: model.id, messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], ...(locale === undefined ? {} : { locale }) })
const drain = async stream => { const result = []; for await (const event of stream) result.push(event); return result }
const errorText = async stream => { const last = (await drain(stream)).at(-1); return last.error?.errorMessage ?? last.reason?.failure?.message }
const body = event => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n')); controller.close() } })

// Request locale is explicit; unrelated hosts' UI preferences are not consulted.
test('locale lookup defaults to English and supports Chinese tags and unknown fallback', () => {
  assert.equal(normalizeLocale('zh-CN'), 'zh')
  assert.equal(normalizeLocale('ZH_hans'), 'zh')
  assert.equal(normalizeLocale('fr'), 'en')
  assert.match(localize(undefined, 'transportFailed'), /network/i)
  assert.match(localize('zh-CN', 'transportFailed'), /network/i)
  assert.equal(localize(undefined, 'requestFailed'), 'Command Code request failed')
})

test('provider localizes HTTP, stream, missing-key and abort errors without reflecting secrets', async () => {
  const key = 'SECRET_key_123'
  for (const [response, fragment] of [
    [{ ok: false, status: 401, body: { cancel: async () => {} } }, 'HTTP 401'],
    [{ ok: true, body: body({ type: 'error', message: key, details: key }) }, '上游数据流出错'],
    [{ ok: true, body: body({ type: 'start' }) }, '未收到 finish'],
  ]) {
    const provider = createCommandCodeProvider({ fetch: async () => response })
    const events = await drain(provider.streamSimple(model, context, { locale: 'zh-CN', apiKey: key }))
    assert.match(events.at(-1).error.errorMessage, new RegExp(fragment))
    assert.doesNotMatch(JSON.stringify(events), new RegExp(key))
  }
  const failed = createCommandCodeProvider({ fetch: async () => { throw new Error(`network failure ${key}`) } })
  assert.equal(await errorText(failed.streamSimple(model, context, { apiKey: key, locale: 'zh' })), localize('zh', 'transportFailed'))
  const forged = createCommandCodeProvider({ fetch: async () => { throw Object.assign(new Error('private'), { localizationKey: 'httpError', localizationParams: { status: key } }) } })
  assert.equal(await errorText(forged.streamSimple(model, context, { apiKey: key, locale: 'zh' })), localize('zh', 'transportFailed'))
  const badRequest = createCommandCodeProvider({ fetch: async () => { throw new Error('should not fetch') } })
  assert.equal(await errorText(badRequest.streamSimple(model, { messages: [{ role: 'unknown', content: key }] }, { apiKey: key, locale: 'zh' })), localize('zh', 'requestPreparation'))
  const badStream = createCommandCodeProvider({ fetch: async () => ({ ok: true, body: body({ type: 'text-delta', id: 'missing', text: key }) }) })
  assert.equal(await errorText(badStream.streamSimple(model, context, { apiKey: key, locale: 'zh' })), localize('zh', 'responseStream'))
  assert.equal(await errorText(failed.streamSimple(model, context, { locale: 'zh' })), localize('zh', 'invalidApiKey'))
  const controller = new AbortController(); controller.abort()
  assert.equal(await errorText(failed.streamSimple(model, context, { locale: 'zh', apiKey: key, signal: controller.signal })), localize('zh', 'requestAborted'))
})

test('credential failures are localized and never expose credential resolver errors', async () => {
  const store = createCredentialStore({ resolve: async () => { throw new Error('SECRET_key_123') } }, 'ref')
  await assert.rejects(store.read('commandcode-go', { locale: 'zh' }), error => error.message === localize('zh', 'credentialUnavailable'))
  await assert.rejects(store.read('commandcode-go'), error => error.message === localize('en', 'credentialUnavailable'))
})

test('adapter request locale selects missing-credential error per concurrent request', async () => {
  const adapter = createAdapter({ credentials: { resolve: async () => undefined } }, { provider: createCommandCodeProvider({ fetch: async () => { throw new Error('unexpected fetch') } }) })
  const outcomes = await Promise.all([request('zh-CN'), request('en'), request('unknown'), request()].map(async options => {
    try { await drain(adapter.stream(options)); return 'unexpected success' } catch (error) { return error.message }
  }))
  assert.equal(outcomes[0], localize('zh', 'missingCredential'))
  assert.deepEqual(outcomes.slice(1), Array(3).fill(localize('en', 'missingCredential')))
})

test('actual PiAiAdapter classifies fetch transport failures as TRANSPORT without exposing causes', async () => {
  const secret = 'private-network-detail-and-key'
  const provider = createCommandCodeProvider({ fetch: async () => { throw Object.assign(new Error(secret), { code: 'ECONNRESET' }) } })
  const adapter = createAdapter({ credentials: { resolve: async () => ({ value: 'user_fixture' }) } }, { provider })
  const chunks = await drain(adapter.stream(request('en')))
  const failure = chunks.find(chunk => chunk.reason?.failure)?.reason.failure
  assert.equal(failure?.code, 'TRANSPORT', JSON.stringify(chunks))
  assert.match(failure.message, /network/i)
  assert.doesNotMatch(JSON.stringify(chunks), new RegExp(secret))
})

test('adapter transports use request-local locale, including prepareCall streams', async () => {
  const provider = createCommandCodeProvider({ fetch: async () => ({ ok: false, status: 503 }) })
  const adapter = createAdapter({ credentials: { resolve: async () => ({ value: 'SECRET_key_123' }) } }, { provider })
  const [zh, en] = await Promise.all([
    errorText(adapter.stream(request('zh'))),
    errorText(adapter.stream(request())),
  ])
  assert.equal(zh, localize('zh', 'httpError', { status: 503 }))
  assert.equal(en, localize('en', 'httpError', { status: 503 }))
  const prepared = await adapter.prepareCall(PROVIDER, model.id)
  assert.equal(await errorText(prepared.stream(request('zh'))), zh)
})
