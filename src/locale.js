// Explicit request locale only. No DSH UI locale bridge is assumed.
import { AsyncLocalStorage } from 'node:async_hooks'

const translations = Object.freeze({
  en: Object.freeze({
    missingCredential: 'Command Code API key is missing; configure COMMANDCODE_API_KEY in DSH credentials',
    credentialUnavailable: 'Unable to read the Command Code API key from DSH credentials',
    credentialsServiceUnavailable: 'DSH credentials service is unavailable',
    unknownCredentialProvider: 'Unknown credential provider',
    modifyCredential: 'Use the DSH credential manager to change the Command Code key',
    deleteCredential: 'Use the DSH credential manager to remove the Command Code key',
    invalidApiKey: 'Invalid Command Code API key',
    requestAborted: 'Command Code request aborted',
    httpError: 'Command Code HTTP {status}',
    emptyResponse: 'Command Code response has no body',
    streamTruncated: 'Command Code stream ended without a finish event',
    streamError: 'Command Code upstream stream error',
    malformedLine: 'Malformed Command Code NDJSON line {line}',
    invalidChunk: 'Invalid Command Code response chunk',
    bodyLimit: 'Command Code response exceeds body limit',
    lineLimit: 'Command Code line exceeds limit',
    transportFailed: 'Command Code request failed',
  }),
  zh: Object.freeze({
    missingCredential: '缺少 Command Code API key；请在 DSH 凭证中配置 COMMANDCODE_API_KEY',
    credentialUnavailable: '无法从 DSH 凭证读取 Command Code API key',
    credentialsServiceUnavailable: 'DSH 凭证服务不可用',
    unknownCredentialProvider: '未知的凭证提供方',
    modifyCredential: '请使用 DSH 凭证管理器修改 Command Code key',
    deleteCredential: '请使用 DSH 凭证管理器移除 Command Code key',
    invalidApiKey: '无效的 Command Code API key',
    requestAborted: 'Command Code 请求已取消',
    httpError: 'Command Code HTTP {status}',
    emptyResponse: 'Command Code 响应没有正文',
    streamTruncated: 'Command Code 数据流结束，但未收到 finish 事件',
    streamError: 'Command Code 上游数据流出错',
    malformedLine: 'Command Code NDJSON 第 {line} 行格式错误',
    invalidChunk: '无效的 Command Code 响应数据块',
    bodyLimit: 'Command Code 响应超过大小限制',
    lineLimit: 'Command Code 数据行超过大小限制',
    transportFailed: 'Command Code 请求失败',
  }),
})

const requestLocale = new AsyncLocalStorage()
const trustedErrors = new WeakMap()
export function normalizeLocale(locale) {
  if (typeof locale !== 'string') return 'en'
  const tag = locale.trim().toLowerCase().replaceAll('_', '-')
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh'
  return 'en'
}
export function currentLocale() { return requestLocale.getStore() ?? 'en' }
export function localize(locale, key, params = {}) {
  const template = translations[normalizeLocale(locale)][key] ?? translations.en[key]
  if (!template) throw new Error(`Unknown localization key: ${key}`)
  return template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ''))
}
export function localizedError(locale, key, params) {
  const error = new Error(localize(locale, key, params))
  trustedErrors.set(error, { key, params })
  return error
}
export function safeErrorMessage(locale, error) {
  const trusted = error instanceof Error ? trustedErrors.get(error) : undefined
  return trusted ? localize(locale, trusted.key, trusted.params) : localize(locale, 'transportFailed')
}
// Async iterator steps must each enter their own context: consumers resume generators
// from different async contexts, and concurrent requests must not share a locale.
export async function* withRequestLocale(locale, stream) {
  const selected = normalizeLocale(locale)
  const iterator = stream[Symbol.asyncIterator]()
  let done = false
  try {
    while (true) {
      const step = await requestLocale.run(selected, () => iterator.next())
      if (step.done) { done = true; return step.value }
      yield step.value
    }
  } finally {
    if (!done) await requestLocale.run(selected, () => iterator.return?.())
  }
}
