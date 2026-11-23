// Command Code's account endpoints are separate from the generation API.
// Keep the key and all upstream responses on the host; only normalized quota
// figures cross the authenticated DSH connection.
const ORIGIN = 'https://api.commandcode.ai'
const PATHS = ['/alpha/whoami', '/alpha/usage/summary', '/alpha/billing/credits', '/alpha/billing/subscriptions']
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : undefined
const stamp = value => {
  const raw = number(value)
  if (raw !== undefined && raw > 0) return raw < 1e11 ? raw * 1000 : raw
  const date = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(date) ? date : undefined
}

export function normalizeWindow(value) {
  const source = record(value)
  if (!source) return undefined
  const used = number(source.used)
  const cap = number(source.cap)
  const resetAt = stamp(source.resetAt)
  if (used === undefined && cap === undefined && resetAt === undefined && source.exceeded !== true) return undefined
  return {
    ...(used === undefined ? {} : { used }),
    ...(cap === undefined ? {} : { cap }),
    ...(resetAt === undefined ? {} : { resetAt }),
    exceeded: source.exceeded === true,
    ...(cap > 0 && used !== undefined ? { remainingPercent: Math.max(0, Math.min(100, Math.round((cap - used) / cap * 100))) } : {}),
  }
}

async function read(path, key, signal, fetchImpl) {
  try {
    const timeout = AbortSignal.timeout(15_000)
    const response = await fetchImpl(`${ORIGIN}${path}`, {
      method: 'GET', redirect: 'manual',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'x-command-code-version': '1.44.0', 'x-cli-environment': 'production' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok) return { status: response.status }
    const body = record(await response.json())
    const expected = path.startsWith('/alpha/whoami') ? ['user', 'org']
      : path.startsWith('/alpha/usage/summary') ? ['totalCount', 'completedCount', 'failedCount', 'totalCost', 'totalTokens',
        'totalTokensIn', 'totalTokensOut', 'totalCredits', 'totalMonthlyCredits', 'totalPurchasedCredits', 'totalFreeCredits', 'successRate']
        : path.startsWith('/alpha/billing/credits') ? ['credits', 'windowLimits'] : ['data']
    if (!body || body.error !== undefined || !expected.some(field => Object.hasOwn(body, field))) return { status: 502 }
    return { body }
  } catch {
    return { status: 0 }
  }
}

export async function fetchCommandCodeUsage(key, { signal, fetchImpl = fetch } = {}) {
  if (typeof key !== 'string' || !key.trim()) return { ok: false, error: 'missing-key' }
  const whoamiRequest = read(PATHS[0], key, signal, fetchImpl)
  const summaryRequest = read(PATHS[1], key, signal, fetchImpl)
  const creditsRequest = read(PATHS[2], key, signal, fetchImpl)
  const subscriptionRequest = whoamiRequest.then(whoami => {
    const orgId = record(whoami.body?.org)?.id
    const suffix = typeof orgId === 'string' && orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
    return read(PATHS[3] + suffix, key, signal, fetchImpl)
  })
  const [whoami, summary, credits, subscription] = await Promise.all([whoamiRequest, summaryRequest, creditsRequest, subscriptionRequest])
  const responses = [whoami, summary, credits, subscription]
  if (responses.every(item => !item.body)) {
    return { ok: false, error: responses.every(item => item.status === 401 || item.status === 403) ? 'invalid-key' : 'unavailable' }
  }
  const credit = record(credits.body?.credits)
  const limits = record(credits.body?.windowLimits)
  const plan = record(subscription.body?.data)
  const usage = summary.body
  const monthly = number(credit?.monthlyCredits)
  const monthlyUsed = number(usage?.totalMonthlyCredits ?? usage?.totalCredits)
  const monthlyTotal = monthly !== undefined && monthlyUsed !== undefined ? monthly + monthlyUsed : undefined
  return { ok: true, value: {
    fetchedAt: Date.now(),
    plan: typeof plan?.planId === 'string' ? plan.planId : typeof credit?.planId === 'string' ? credit.planId : undefined,
    periodEnd: stamp(plan?.currentPeriodEnd),
    windows: { fiveHour: normalizeWindow(limits?.fiveHour), weekly: normalizeWindow(limits?.weekly) },
    credits: {
      ...(monthly === undefined ? {} : { monthly }),
      ...(number(credit?.purchasedCredits) === undefined ? {} : { purchased: number(credit.purchasedCredits) }),
      ...(number(credit?.freeCredits) === undefined ? {} : { free: number(credit.freeCredits) }),
      ...(monthlyTotal > 0 ? { monthlyTotal, monthlyRemainingPercent: Math.max(0, Math.min(100, Math.round(monthly / monthlyTotal * 100))) } : {}),
    },
    usage: {
      ...(number(usage?.totalCount) === undefined ? {} : { requests: number(usage.totalCount) }),
      ...(number(usage?.totalTokens) === undefined ? {} : { tokens: number(usage.totalTokens) }),
    },
    partial: responses.some(item => !item.body),
  } }
}
