import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'lib')
await mkdir(output, { recursive: true })
for (const name of ['index.js', 'credential.js', 'commandcode-provider.js', 'locale.js', 'usage.js', 'usage-transport.js', 'client.js']) {
  await copyFile(join(root, 'src', name), join(output, name))
}
console.log('Built host and web client plugin in lib/')
