// Keep the API key exclusively in DSH's host-side credentials service.
import { currentLocale, localizedError } from './locale.js'

export function createCredentialStore(credentials, ref, providerId = 'commandcode-go', vault) {
  if (typeof credentials?.resolve !== 'function') throw localizedError(currentLocale(), 'credentialsServiceUnavailable')
  return Object.freeze({
    async read(id, { signal, locale } = {}) {
      if (id !== providerId) throw localizedError(locale ?? currentLocale(), 'unknownCredentialProvider')
      signal?.throwIfAborted()
      let result
      try { result = vault ? { value: await vault.activeKey() } : await credentials.resolve(ref) }
      catch { throw localizedError(locale ?? currentLocale(), 'credentialUnavailable') }
      signal?.throwIfAborted()
      return typeof result?.value === 'string' && result.value.trim()
        ? { type: 'api_key', key: result.value.trim() }
        : undefined
    },
    async list({ signal, locale } = {}) {
      signal?.throwIfAborted()
      return (await this.read(providerId, { signal, locale })) ? [{ providerId, type: 'api_key' }] : []
    },
    async modify(_id, options = {}) { throw localizedError(options.locale ?? currentLocale(), 'modifyCredential') },
    async delete(_id, options = {}) { throw localizedError(options.locale ?? currentLocale(), 'deleteCredential') },
  })
}
