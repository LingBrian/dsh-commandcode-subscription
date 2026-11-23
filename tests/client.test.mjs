import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('web client registers its usage page in DSH plugin settings', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  let loader
  runInNewContext(source, { window: { __ModuleLoader__: { load(entry) { loader = entry } } }, navigator: { language: 'zh-CN' }, setTimeout, clearTimeout, AbortController })
  assert.equal(loader.id, 'dsh-commandcode-subscription')
  const client = loader.factory(name => {
    assert.equal(name, 'react')
    return { createElement: (type, props) => ({ type, props }) }
  })
  assert.deepEqual(Array.from(client.inject), ['slots', 'connection', 'modelDirectories'])
  const registered = []
  client.apply({
    get(name) {
      if (name === 'connection') return { rpc: {} }
      if (name === 'modelDirectories') return { directoryFor() { return { store: {} } } }
      if (name === 'remote.session') return undefined
      throw new Error(`unexpected service: ${name}`)
    },
    slots: { inject(_name, callback) { callback() }, register(config, component) { registered.push({ config, component }) } },
    effect() {},
  })
  assert.deepEqual(registered.map(item => item.config.name), ['conversation.input.right', 'conversation.input.right', 'settings.plugins.tab', 'plugins.bundle.config', 'plugins.row.config'])
  assert.equal(registered[0].config.id, 'commandcode-subscription-quota')
  assert.equal(registered[1].config.id, 'commandcode-subscription-model-options')
  assert.equal(registered[3].config.key, 'dsh-commandcode-subscription')
  assert.equal(registered[4].config.key, 'dsh-commandcode-subscription#commandcode-subscription')
})

test('composer quota maps 5h, 1w, 1m and polls every 30 seconds without overlap', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  let loader, tick, intervalMs, cleared = false
  runInNewContext(source, {
    window: { __ModuleLoader__: { load(entry) { loader = entry } } }, navigator: { language: 'zh-CN' },
    setTimeout, clearTimeout,
    setInterval(callback, ms) { tick = callback; intervalMs = ms; return 1 },
    clearInterval() { cleared = true }, AbortController,
  })
  const client = loader.factory(() => ({ createElement() {} }))
  const rows = client.__internals.quotaRows({
    windows: { fiveHour: { remainingPercent: 77, resetAt: 100 }, weekly: { remainingPercent: 72 } },
    credits: { monthlyRemainingPercent: 64 }, periodEnd: 200,
  })
  assert.deepEqual(Array.from(rows, row => [row.id, row.percent]), [['5h', 77], ['1w', 72], ['1m', 64]])
  let resolveRequest, calls = 0, updates = 0
  const poller = client.__internals.createQuotaPoller({ call() { calls++; return new Promise(resolve => { resolveRequest = resolve }) } }, () => updates++, { visible: () => true })
  poller.start()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(intervalMs, 30_000)
  tick()
  assert.equal(calls, 1, 'a slow request must not start a second fetch')
  resolveRequest({ ok: true, value: {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(updates, 1)
  tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 2)
  resolveRequest({ ok: true, value: {} })
  await new Promise(resolve => setImmediate(resolve))
  poller.stop()
  assert.equal(cleared, true)
})

test('usage client exits the loading state when RPC never responds', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  let loader
  runInNewContext(source, { window: { __ModuleLoader__: { load(entry) { loader = entry } } }, navigator: { language: 'zh-CN' }, setTimeout, clearTimeout, AbortController })
  const client = loader.factory(() => ({ createElement() {} }))
  const controller = new AbortController()
  await assert.rejects(client.__internals.callUsage({ call() { return new Promise(() => {}) } }, controller, 5), /usage-timeout/)
  assert.equal(controller.signal.aborted, true)
})

test('speed options only include catalog-listed deployments of the same model family', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  let loader
  runInNewContext(source, { window: { __ModuleLoader__: { load(entry) { loader = entry } } }, navigator: { language: 'zh-CN' }, setTimeout, clearTimeout, AbortController })
  const client = loader.factory(() => ({ createElement() {} }))
  const models = ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash-fast', 'unrelated'].map(id => ({ id }))
  assert.deepEqual(Array.from(client.__internals.speedChoices('deepseek/deepseek-v4.1-flash', models), item => item.id),
    ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash-fast'])
  assert.equal(client.__internals.speedChoices('unrelated', models).length, 0)
})
