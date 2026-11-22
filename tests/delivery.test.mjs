import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const load = path => readFile(new URL(path, root), 'utf8')

test('plugin card locale manifests are bilingual and point at packaged details', async () => {
  const pkg = JSON.parse(await load('package.json'))
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.ok(pkg.files.includes('locale/*.json'))
  assert.ok(pkg.files.includes('docs/plugin/*.md'))
  for (const language of ['zh', 'en']) {
    const { meta } = JSON.parse(await load(`locale/${language}.json`))
    assert.ok(meta.title && meta.description)
    assert.match(meta.description, /API [Kk]ey/)
    assert.match(meta.detail, /^docs\/plugin\/DETAIL(?:\.zh)?\.md$/)
    assert.ok((await load(meta.detail)).includes('COMMANDCODE_API_KEY'))
  }
})

test('README languages cross-link and do not imply npm publication or OAuth', async () => {
  const zh = await load('README.md')
  const en = await load('README.en.md')
  assert.ok(zh.includes('[English](README.en.md)'))
  assert.ok(en.includes('[中文](README.md)'))
  for (const readme of [zh, en]) {
    assert.ok(readme.includes('pnpm pack --pack-destination .artifacts'))
    assert.ok(readme.includes('dsh plugin --profile web add ./.artifacts/dsh-commandcode-subscription-0.1.0.tgz'))
    assert.ok(readme.includes('COMMANDCODE_API_KEY'))
    assert.ok(readme.includes('/alpha/generate'))
  }
})
