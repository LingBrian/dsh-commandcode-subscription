import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { createCommandCodeProvider } from './commandcode-provider.js'
import { createCredentialStore } from './credential.js'
import { currentLocale, localize, withRequestLocale } from './locale.js'

export const name = 'commandcode-subscription'
export const inject = ['llm', 'credentials']
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
    // This initial version deliberately does not advertise image attachments.
    maxRequestImageBytes: 0,
    requestImagePixelBudget: 0,
    requestImageMaxBytes: 0,
    maxImageBytes: 0,
    requestImageBudgetCount: 0,
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
  ctx.effect(() => ctx.on?.('credentials/reference-updated', ref => {
    if (ref === KEY_REF) ctx.llm.emitAdaptersUpdated?.()
  }), 'commandcode-subscription: credential changes')
  // DSH owns adapter registration and unwinds it when the plugin is unloaded.
  ctx.effect(() => {
    const controller = new AbortController()
    const provider = createCommandCodeProvider()
    const adapter = createAdapter(ctx, { provider })
    const dispose = ctx.llm.registerAdapter([PROVIDER], adapter)
    void Promise.resolve().then(() => provider.refreshModels?.({ signal: controller.signal }))
      .then(() => { if (!controller.signal.aborted) ctx.llm.emitAdaptersUpdated?.() })
      .catch(() => { /* Offline catalog retains its documented fallback. */ })
    return () => { controller.abort(); dispose?.() }
  }, 'commandcode-subscription: model adapter')
}
