import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('web client registers its usage page in DSH plugin settings', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  let loader
  runInNewContext(source, { window: { __ModuleLoader__: { load(entry) { loader = entry } } }, navigator: { language: 'zh-CN' } })
  assert.equal(loader.id, 'dsh-commandcode-subscription')
  const client = loader.factory(name => {
    assert.equal(name, 'react')
    return { createElement: (type, props) => ({ type, props }) }
  })
  assert.deepEqual(Array.from(client.inject), ['slots', 'connection'])
  const registered = []
  client.apply({
    get(name) { assert.equal(name, 'connection'); return { rpc: {} } },
    slots: { inject(_name, callback) { callback() }, register(config, component) { registered.push({ config, component }) } },
    effect() {},
  })
  assert.deepEqual(registered.map(item => item.config.name), ['settings.plugins.tab', 'plugins.bundle.config', 'plugins.row.config'])
  assert.equal(registered[1].config.key, 'dsh-commandcode-subscription')
  assert.equal(registered[2].config.key, 'dsh-commandcode-subscription#commandcode-subscription')
})
