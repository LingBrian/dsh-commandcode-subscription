import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdapter, PROVIDER } from '../src/index.js'
import { createCommandCodeProvider } from '../src/commandcode-provider.js'

const encode = events => new ReadableStream({ start(controller) {
  const bytes = new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n') + '\n')
  controller.enqueue(bytes)
  controller.close()
} })

test('real DSH adapter translates provider NDJSON into host stream', async () => {
  let request
  const model = 'fixture/model'
  const provider = createCommandCodeProvider({
    resolveModels: async () => [{ provider: PROVIDER, id: model, name: 'Fixture', api: 'commandcode-generate', baseUrl: 'https://api.commandcode.ai', reasoning: false, input: ['text'], contextWindow: 8192, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    fetch: async (_url, init) => {
      request = init
      return { ok: true, body: encode([
        { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', text: 'reply' },
        { type: 'text-end', id: 't' }, { type: 'finish', finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 1 } },
      ]) }
    },
  })
  await provider.refreshModels()
  const ctx = { credentials: { async resolve() { return { value: 'user_fixture' } } } }
  const adapter = createAdapter(ctx, { provider })
  const events = []
  for await (const event of adapter.stream({ provider: PROVIDER, model, messages: [
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    { role: 'developer', content: [{ type: 'text', text: 'answer briefly' }] },
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  ] })) events.push(event)
  assert.equal(request.headers.Authorization, 'Bearer user_fixture')
  const payload = JSON.parse(request.body)
  assert.match(payload.params.system, /answer briefly/)
  assert.deepEqual(payload.params.messages.map(message => message.role), ['user', 'user'])
  assert.ok(events.some(event => JSON.stringify(event).includes('reply')))
  assert.doesNotMatch(JSON.stringify(events), /user_fixture/)
})
