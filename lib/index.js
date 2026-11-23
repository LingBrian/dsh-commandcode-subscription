import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { createCommandCodeProvider } from './commandcode-provider.js'
import { createCredentialStore } from './credential.js'
import { currentLocale, localize, withRequestLocale } from './locale.js'
import { registerUsageTransport } from './usage-transport.js'

// A transient catalog failure at startup must not leave the single offline
// placeholder in the model picker for the entire DSH session.
export function watchModelCatalog(provider, notify, { signal, retryMs = 10_000, refreshMs = 30 * 60_000 } = {}) {
  let timer
  let failures = 0
  const refresh = async () => {
    if (signal?.aborted) return
    try {
      await provider.refreshModels({ signal })
      if (signal?.aborted) return
      failures = 0
      notify()
      if (signal?.aborted) return
      timer = setTimeout(refresh, refreshMs)
    } catch {
      if (signal?.aborted) return
      failures++
      timer = setTimeout(refresh, Math.min(retryMs * 2 ** Math.min(failures - 1, 3), 60_000))
    }
  }
  void refresh()
  return () => clearTimeout(timer)
}

export const name = 'commandcode-subscription'
export const inject = ['llm', 'credentials', 'attachments']
export const PROVIDER = 'commandcode-go'
export const KEY_REF = credentialRef('COMMANDCODE_API_KEY')

// PiAiAdapter builds a request-local pi-ai Models instance. Its auth bridge
// consumes only the key resolved by the DSH credentials service for that turn.
export function createAdapter(ctx, { provider = createCommandCodeProvider(), ref = KEY_REF } = {}) {
  const credentials = createCredentialStore(ctx.credentials, ref, PROVIDER)
  const managedProvider = {
    ...provider,
    auth: {
      ...provider.auth,
      apiKey: {
        name: 'DSH-managed Command Code API key',
        async resolve({ credential }) {
          if (credential?.type !== 'api_key' || !credential.key) return undefined
          return { auth: { apiKey: credential.key }, source: 'DSH credential service' }
        },
      },
    },
  }
  const profile = Object.freeze({
    provider: PROVIDER,
    displayName: 'Command Code Go',
    piProvider: managedProvider,
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
    transport: 'ndjson',
    streamIdleTimeoutMs: 5 * 60 * 1000,
    maxRequestImageBytes: 20 * 1024 * 1024,
    requestImagePixelBudget: 2048 * 2048,
    requestImageMaxBytes: 1024 * 1024,
    maxImageBytes: 1024 * 1024,
    requestImageBudgetCount: 20,
  })
  const adapter = new PiAiAdapter({
    profiles: () => new Map([[PROVIDER, profile]]),
    auth: {
      credentials,
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
    resolveApiKey: async () => {
      const current = await credentials.read(PROVIDER)
      if (!current) {
        throw new LlmError(localize(currentLocale(), 'missingCredential'), 'MISSING_CREDENTIAL')
      }
      return current.key
    },
    resolveAttachments: () => ctx.get?.('attachments'),
    // Images are sent as bounded base64 request content. No host path is
    // exposed to the upstream model or required for visual understanding.
    resolveImageAccess: () => undefined,
  })
  // PiAiAdapter currently forwards no locale to streamSimple or resolveApiKey.
  // Scope each iterator step to the caller's explicit locale without changing wire payloads.
  const stream = adapter.stream.bind(adapter)
  adapter.stream = options => withRequestLocale(options?.locale, stream(options))
  const prepareCall = adapter.prepareCall.bind(adapter)
  adapter.prepareCall = async (...args) => {
    const prepared = await prepareCall(...args)
    return { ...prepared, stream: options => withRequestLocale(options?.locale, prepared.stream(options)) }
  }
  return adapter
}

export function apply(ctx) {
  ctx.inject(['connection'], scope => scope.effect(
    () => registerUsageTransport(scope.connection, ctx.credentials, KEY_REF, PROVIDER),
    'commandcode-subscription: read-only usage',
  ))
  ctx.effect(() => ctx.on?.('credentials/reference-updated', ref => {
    if (ref === KEY_REF) ctx.llm.emitAdaptersUpdated?.()
  }), 'commandcode-subscription: credential changes')
  // DSH owns adapter registration and unwinds it when the plugin is unloaded.
  ctx.effect(() => {
    const controller = new AbortController()
    const provider = createCommandCodeProvider()
    const adapter = createAdapter(ctx, { provider })
    const dispose = ctx.llm.registerAdapter([PROVIDER], adapter)
    const stopCatalog = watchModelCatalog(provider, () => ctx.llm.emitAdaptersUpdated?.(), { signal: controller.signal })
    return () => { controller.abort(); stopCatalog(); dispose?.() }
  }, 'commandcode-subscription: model adapter')
}
