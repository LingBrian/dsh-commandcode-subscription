import assert from 'node:assert/strict'
import test from 'node:test'
import { createCommandCodeProvider, parseCommandCodeModels, convertCommandCodeMessages, convertCommandCodeUsage } from '../src/commandcode-provider.js'

const model = parseCommandCodeModels({ data: [{ id: 'fixture/model', name: 'Fixture', context_length: 8192 }] })[0]
const context = { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }], tools: [{ name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } }] }
const lineStream = (lines, chunkSize = 5) => {
  const bytes = new TextEncoder().encode(lines.join('\n') + '\n')
  return new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += chunkSize) c.enqueue(bytes.slice(i, i + chunkSize)); c.close() } })
}
const drain = async stream => { const events = []; for await (const event of stream) events.push(event); return events }
const makeFetch = (events, inspect) => async (url, init) => {
  inspect?.(url, init)
  return { ok: true, body: lineStream(events.map(event => JSON.stringify(event))) }
}

test('public catalog models do not claim unverified reasoning or image support', () => {
  assert.equal(model.provider, 'commandcode-go')
  assert.deepEqual(model.input, ['text'])
  assert.equal(model.reasoning, false)
  const vision = parseCommandCodeModels({ data: [{ id: 'deepseek/deepseek-v4-flash-vision-exp', name: 'Vision', context_length: 8192 }] })[0]
  assert.deepEqual(vision.input, ['text', 'image'])
  for (const id of ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash-fast', 'deepseek/deepseek-v4.1-flash-ultrafast', 'z-ai/glm-5.3-flash']) {
    assert.deepEqual(parseCommandCodeModels({ data: [{ id, context_length: 8192 }] })[0].input, ['text', 'image'], id)
  }
  assert.deepEqual(parseCommandCodeModels({ data: [{ id: 'deepseek/deepseek-v4-flash', context_length: 8192 }] })[0].input, ['text'])
  assert.equal(parseCommandCodeModels({ data: [{ id: 'bad', context_length: -1 }] }).length, 0)
})

test('native request conversion and split NDJSON tool sequence', async () => {
  let calls = 0
  const provider = createCommandCodeProvider({ fetch: makeFetch([
    { type: 'start' },
    { type: 'text-start', id: 'txt' },
    { type: 'text-delta', id: 'txt', text: 'hello' },
    { type: 'text-end', id: 'txt' },
    { type: 'tool-input-start', id: 'call', toolName: 'echo' },
    { type: 'tool-input-delta', id: 'call', delta: '{"message":' },
    { type: 'tool-input-delta', id: 'call', delta: '"yes"}' },
    { type: 'tool-input-end', id: 'call' },
    { type: 'tool-call', id: 'call', toolName: 'echo', input: { message: 'yes' } },
    { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 21, cachedInputTokens: 4, outputTokens: 3 } },
  ], (url, init) => {
    calls++
    assert.equal(url, 'https://api.commandcode.ai/alpha/generate')
    assert.equal(init.headers.Authorization, 'Bearer user_test')
    const body = JSON.parse(init.body)
    assert.equal(body.params.stream, true)
    assert.equal(body.params.tools[0].input_schema.type, 'object')
    assert.deepEqual(body.params.messages[0], { role: 'user', content: [{ type: 'text', text: 'hello' }] })
  }) })
  const events = await drain(provider.streamSimple(model, context, { apiKey: 'user_test' }))
  assert.equal(calls, 1)
  const done = events.find(event => event.type === 'done')
  assert.equal(done.reason, 'toolUse')
  assert.deepEqual(done.message.content[1].arguments, { message: 'yes' })
  assert.equal(done.message.usage.input, 17)
  assert.equal(done.message.usage.cacheRead, 4)
  assert.equal(done.message.usage.output, 3)
})

test('reasoning chunks and cancellation are propagated without retries', async () => {
  const reasoning = createCommandCodeProvider({ fetch: makeFetch([
    { type: 'reasoning-start', id: 'r' }, { type: 'reasoning-delta', id: 'r', text: 'consider' },
    { type: 'reasoning-end', id: 'r' }, { type: 'finish', finishReason: 'stop' },
  ]) })
  const result = await drain(reasoning.streamSimple(model, context, { apiKey: 'user_test' }))
  assert.equal(result.find(event => event.type === 'thinking_delta').delta, 'consider')
  const controller = new AbortController()
  controller.abort()
  let requests = 0
  const canceled = createCommandCodeProvider({ fetch: async () => { requests++; throw new Error('should not fetch') } })
  const events = await drain(canceled.streamSimple(model, context, { apiKey: 'user_test', signal: controller.signal }))
  assert.equal(requests, 0)
  assert.equal(events.at(-1).reason, 'aborted')
})

test('multi-step stream accepts reused ids and implicit text end', async () => {
  const provider = createCommandCodeProvider({ fetch: makeFetch([
    { type: 'start-step' },
    { type: 'text-start', id: 'text-0' },
    { type: 'text-delta', id: 'text-0', text: 'first' },
    { type: 'finish-step', finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 1 } },
    { type: 'start-step' },
    { type: 'text-start', id: 'text-0' },
    { type: 'text-delta', id: 'text-0', text: 'second' },
    { type: 'text-end', id: 'text-0' },
    { type: 'finish', finishReason: 'stop' },
  ]) })
  const events = await drain(provider.streamSimple(model, context, { apiKey: 'user_test' }))
  const done = events.find(event => event.type === 'done')
  assert.deepEqual(done.message.content.map(part => part.text), ['first', 'second'])
  assert.equal(done.message.usage.input, 3)
})

test('truncation and malformed tool input fail without replay', async () => {
  for (const lines of [
    [{ type: 'start' }, { type: 'text-start', id: 'a' }, { type: 'text-end', id: 'a' }],
    [{ type: 'tool-input-start', id: 'a', toolName: 'echo' }, { type: 'tool-input-delta', id: 'a', delta: '{broken' }, { type: 'tool-input-end', id: 'a' }],
  ]) {
    let calls = 0
    const provider = createCommandCodeProvider({ fetch: makeFetch(lines, () => calls++) })
    const events = await drain(provider.streamSimple(model, context, { apiKey: 'user_test' }))
    assert.equal(events.at(-1).type, 'error')
    assert.equal(calls, 1)
  }
})

test('missing key never contacts upstream and HTTP errors do not expose key', async () => {
  let calls = 0
  const provider = createCommandCodeProvider({ fetch: async () => { calls++; return { ok: false, status: 401 } } })
  assert.equal((await drain(provider.streamSimple(model, context))).at(-1).type, 'error')
  assert.equal(calls, 0)
  const events = await drain(provider.streamSimple(model, context, { apiKey: 'user_test' }))
  assert.equal(calls, 1)
  assert.equal(events.at(-1).type, 'error')
  assert.doesNotMatch(JSON.stringify(events), /user_test/)
})

test('history maps tool result and rejects unsupported content', () => {
  assert.deepEqual(convertCommandCodeMessages([
    { role: 'assistant', content: [{ type: 'toolCall', id: 'id', name: 'echo', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'id', content: [{ type: 'text', text: 'ok' }] },
  ])[1].content[0], { type: 'tool-result', toolCallId: 'id', toolName: 'echo', output: { type: 'text', value: 'ok' } })
  assert.throws(() => convertCommandCodeMessages([{ role: 'toolResult', toolCallId: 'x', content: [{ type: 'image' }] }]))
  assert.equal(convertCommandCodeUsage({ inputTokens: 5, cachedInputTokens: 2, outputTokens: 1 }, model).input, 3)
})
