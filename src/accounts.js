import { randomUUID } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

export const ACCOUNTS_KEY = credentialKey('commandcode-subscription', 'accounts')
const LEGACY_ID = 'legacy'
const MAX_ACCOUNTS = 10
export const validKey = value => typeof value === 'string' && value.trim().length >= 8
  && value.trim().length <= 512 && !/\s/u.test(value.trim())
const labelOf = value => {
  const label = typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 80) : ''
  return label || 'Command Code account'
}
const assertRecord = record => {
  if (record?.kind !== 'grant' || record.payload?.version !== 1 || !Array.isArray(record.payload.accounts)
    || record.payload.accounts.length > MAX_ACCOUNTS) throw new Error('Invalid Command Code account record')
  const { accounts, activeId } = record.payload
  const ids = new Set()
  for (const account of accounts) {
    if (typeof account?.id !== 'string' || !account.id || ids.has(account.id)
      || !validKey(account.key) || typeof account.label !== 'string') throw new Error('Invalid Command Code account record')
    ids.add(account.id)
  }
  if (activeId !== null && !ids.has(activeId)) throw new Error('Invalid Command Code active account')
  return { accounts, activeId }
}
const grant = payload => ({ kind: 'grant', payload: { version: 1, ...payload } })

/** Keys stay in DSH's credential store. Only labels and opaque ids cross RPC. */
export function createAccountVault(credentials, legacyRef, { createId = randomUUID } = {}) {
  const read = async () => typeof credentials.readRecord === 'function'
    ? (await credentials.readRecord(ACCOUNTS_KEY)) : undefined
  const legacy = async () => {
    const found = await credentials.resolve(legacyRef)
    const key = found?.value?.trim()
    return validKey(key) ? { id: LEGACY_ID, label: 'Command Code account', key } : undefined
  }
  const snapshot = async () => {
    const record = await read()
    if (record !== undefined) return assertRecord(record)
    const first = await legacy()
    return { accounts: first ? [first] : [], activeId: first?.id ?? null }
  }
  const modify = async change => {
    if (typeof credentials.modifyRecord !== 'function') throw new Error('DSH credential records are unavailable')
    const first = (await read()) === undefined ? await legacy() : undefined
    const result = await credentials.modifyRecord(ACCOUNTS_KEY, async previous => {
      const current = previous === undefined ? { accounts: first ? [first] : [], activeId: first?.id ?? null } : assertRecord(previous)
      return grant(await change(current))
    })
    return assertRecord(result)
  }
  return Object.freeze({
    async status() {
      const state = await snapshot()
      return { activeId: state.activeId, accounts: state.accounts.map(({ id, label }) => ({ id, label, active: id === state.activeId })) }
    },
    async activeKey() {
      const state = await snapshot()
      return state.accounts.find(account => account.id === state.activeId)?.key
    },
    async usageAccounts() {
      const state = await snapshot()
      return state.accounts.map(account => ({ ...account, active: account.id === state.activeId }))
    },
    async add(key, label) {
      if (!validKey(key)) throw new Error('Invalid API key')
      const clean = key.trim()
      const id = createId()
      await modify(current => {
        if (current.accounts.some(account => account.key === clean)) throw new Error('Account already exists')
        if (current.accounts.length >= MAX_ACCOUNTS) throw new Error('Too many accounts')
        return { accounts: [...current.accounts, { id, label: labelOf(label), key: clean }], activeId: id }
      })
      return this.status()
    },
    async select(id) {
      await modify(current => {
        if (!current.accounts.some(account => account.id === id)) throw new Error('Unknown account')
        return { ...current, activeId: id }
      })
      return this.status()
    },
    async logout() {
      await modify(current => {
        const accounts = current.accounts.filter(account => account.id !== current.activeId)
        return { accounts, activeId: accounts[0]?.id ?? null }
      })
      return this.status()
    },
  })
}
