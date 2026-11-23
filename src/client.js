// DSH's web loader expects its plugin client as a lazy CJS factory.
window.__ModuleLoader__.load({
  id: 'dsh-commandcode-subscription',
  factory: require => {
    const React = require('react')
    const h = React.createElement
    const module = { exports: {} }
    Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' })
    const zh = (navigator.language || '').toLowerCase().startsWith('zh')
    const copy = zh ? {
      title: 'Command Code 用量', summary: '查看账户额度和用量', open: '查看用量', close: '关闭', refresh: '刷新', loading: '正在读取用量…',
      missing: '请先在 DSH 凭证管理器配置 COMMANDCODE_API_KEY。', invalid: 'API Key 无效或无权查询用量。', unavailable: '用量查询失败，请稍后重试。', timeout: '用量查询超时，请重试。',
      partial: '部分数据暂不可用，以下为已读取的用量。', remaining: '剩余', fiveHour: '5 小时额度', weekly: '每周额度', monthly: '每月额度',
      purchased: '购买额度余额', free: '免费额度余额', requests: '请求数', tokens: 'Token 数', reset: '重置时间', unknown: '服务商未提供额度上限',
    } : {
      title: 'Command Code usage', summary: 'View account quotas and usage', open: 'View usage', close: 'Close', refresh: 'Refresh', loading: 'Loading usage…',
      missing: 'Configure COMMANDCODE_API_KEY in the DSH credential manager first.', invalid: 'API key is invalid or cannot read usage.', unavailable: 'Usage is unavailable. Try again later.', timeout: 'Usage request timed out. Please retry.',
      partial: 'Some data is unavailable; showing what was returned.', remaining: 'remaining', fiveHour: '5-hour limit', weekly: 'Weekly limit', monthly: 'Monthly credits',
      purchased: 'Purchased credits', free: 'Free credits', requests: 'Requests', tokens: 'Tokens', reset: 'Resets', unknown: 'No limit reported by provider',
    }
    const format = number => Number(number).toLocaleString(zh ? 'zh-CN' : 'en-US', { maximumFractionDigits: 3 })
    const date = value => new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US')
    const dollars = value => `$${format(value)}`
    const QUOTA_REFRESH_MS = 30_000

    async function callUsage(rpc, controller, timeoutMs = 35_000) {
      let timer
      try {
        return await Promise.race([
          Promise.resolve().then(() => rpc.call('/api', 'commandcode-subscription/usage', {}, controller.signal)),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('usage-timeout')) }, timeoutMs) }),
        ])
      } finally { clearTimeout(timer) }
    }

    function quotaRows(usage) {
      return [
        { id: '5h', label: copy.fiveHour, percent: usage?.windows?.fiveHour?.remainingPercent, resetAt: usage?.windows?.fiveHour?.resetAt },
        { id: '1w', label: copy.weekly, percent: usage?.windows?.weekly?.remainingPercent, resetAt: usage?.windows?.weekly?.resetAt },
        { id: '1m', label: copy.monthly, percent: usage?.credits?.monthlyRemainingPercent, resetAt: usage?.periodEnd },
      ]
    }

    function createQuotaPoller(rpc, publish, { intervalMs = QUOTA_REFRESH_MS, visible = () => document.visibilityState !== 'hidden' } = {}) {
      let stopped = false
      let active = false
      let controller
      let interval
      const refresh = async () => {
        if (stopped || active || !visible()) return
        active = true
        controller = new AbortController()
        try {
          const result = await callUsage(rpc, controller)
          if (!stopped) publish(result?.ok ? { value: result.value, error: undefined } : { error: result?.error ?? 'unavailable' })
        } catch (error) {
          if (!stopped) publish({ error: error?.message === 'usage-timeout' ? 'timeout' : 'unavailable' })
        } finally { active = false; controller = undefined }
      }
      return {
        start() { void refresh(); interval = setInterval(refresh, intervalMs) },
        refresh,
        stop() { stopped = true; clearInterval(interval); controller?.abort() },
      }
    }

    function ComposerQuota({ rpc, directory }) {
      const model = React.useSyncExternalStore(
        listener => directory.subscribe(listener),
        () => directory.getSnapshot(),
      )?.current
      const enabled = model?.provider === 'commandcode-go'
      const [reading, setReading] = React.useState({})
      const [open, setOpen] = React.useState(false)
      const [pinned, setPinned] = React.useState(false)
      const trigger = React.useRef(null)
      const panel = React.useRef(null)
      const dismissTimer = React.useRef(null)
      const enter = () => { clearTimeout(dismissTimer.current); setOpen(true) }
      const leave = () => { clearTimeout(dismissTimer.current); if (!pinned) dismissTimer.current = setTimeout(() => setOpen(false), 150) }
      const dismiss = () => { clearTimeout(dismissTimer.current); setPinned(false); setOpen(false) }
      React.useEffect(() => {
        if (!enabled) { setReading({}); return undefined }
        const poller = createQuotaPoller(rpc, next => setReading(previous => ({ ...previous, ...next })))
        const wake = () => { if (document.visibilityState !== 'hidden') void poller.refresh() }
        poller.start()
        document.addEventListener('visibilitychange', wake)
        return () => { poller.stop(); document.removeEventListener('visibilitychange', wake) }
      }, [enabled, rpc])
      React.useEffect(() => { dismiss() }, [model?.provider, model?.model])
      React.useEffect(() => () => clearTimeout(dismissTimer.current), [])
      React.useEffect(() => {
        const node = panel.current
        if (!open || !enabled || !node) return undefined
        const position = () => {
          const rect = trigger.current?.getBoundingClientRect()
          if (!rect) return
          const width = node.offsetWidth, height = node.offsetHeight
          node.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
          const above = rect.top - height - 8
          const below = rect.bottom + 8
          node.style.top = `${Math.max(8, Math.min(above >= 8 ? above : below, window.innerHeight - height - 8))}px`
        }
        node.showPopover?.()
        position()
        window.addEventListener('resize', position)
        window.addEventListener('scroll', position, true)
        const escape = event => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); trigger.current?.focus() } }
        const outside = event => { if (!trigger.current?.contains(event.target) && !node.contains(event.target)) dismiss() }
        document.addEventListener('keydown', escape)
        document.addEventListener('pointerdown', outside)
        return () => {
          window.removeEventListener('resize', position)
          window.removeEventListener('scroll', position, true)
          document.removeEventListener('keydown', escape)
          document.removeEventListener('pointerdown', outside)
          if (node.matches?.(':popover-open')) node.hidePopover()
        }
      }, [open, enabled])
      if (!enabled) return null
      const rows = quotaRows(reading.value)
      const short = rows[0]
      const detail = rows.map(row => `${row.id}: ${row.percent === undefined ? copy.unknown : `${row.percent}% ${copy.remaining}`}`).join('; ')
      return h(React.Fragment, null,
        h('button', { ref: trigger, type: 'button', className: 'ccComposerQuota', 'aria-label': `${copy.title}: ${detail}`,
          'aria-haspopup': 'dialog', 'aria-expanded': open, onMouseEnter: enter, onMouseLeave: leave,
          onClick: () => { clearTimeout(dismissTimer.current); if (pinned) dismiss(); else { setPinned(true); setOpen(true) } } },
        h('span', null, '5h'),
        h('progress', { max: 100, value: short.percent, 'aria-hidden': true })),
        open ? h('section', { ref: panel, popover: 'manual', role: 'dialog', className: 'ccQuotaPopover', 'aria-label': copy.title,
          onMouseEnter: enter, onMouseLeave: leave },
          rows.map(row => h('div', { className: 'ccQuotaRow', key: row.id },
            h('div', { className: 'ccQuotaRowHead' }, h('span', null, row.label),
              h('strong', null, row.percent === undefined ? copy.unknown : `${row.percent}% ${copy.remaining}`),
              row.resetAt ? h('time', { dateTime: new Date(row.resetAt).toISOString() }, `${copy.reset} ${date(row.resetAt)}`) : null),
            h('progress', { max: 100, value: row.percent, 'aria-label': `${row.label}: ${row.percent === undefined ? copy.unknown : `${row.percent}% ${copy.remaining}`}` }))),
          reading.error ? h('p', { className: 'ccQuotaError' }, reading.error === 'missing-key' ? copy.missing : reading.error === 'invalid-key' ? copy.invalid : copy.unavailable) : null) : null)
    }

    function Bar({ label, percent, detail, reset }) {
      return h('div', { className: 'ccUsageBar', key: label },
        h('div', { className: 'ccUsageBarHeading' }, h('span', null, label), h('strong', null, percent === undefined ? copy.unknown : `${percent}% ${copy.remaining}`)),
        percent === undefined ? null : h('progress', { max: 100, value: percent, 'aria-label': `${label}: ${percent}% ${copy.remaining}` }),
        h('div', { className: 'ccUsageDetail' }, h('span', null, detail), reset ? h('time', { dateTime: new Date(reset).toISOString() }, `${copy.reset}: ${date(reset)}`) : null))
    }

    function UsageDialog({ rpc, close }) {
      const dialog = React.useRef(null)
      const [state, setState] = React.useState({ loading: true })
      const generation = React.useRef(0)
      const controller = React.useRef(null)
      const load = () => {
        const current = ++generation.current
        controller.current?.abort()
        controller.current = new AbortController()
        const activeController = controller.current
        setState(previous => ({ ...previous, loading: true, error: undefined }))
        callUsage(rpc, activeController)
          .then(result => { if (generation.current === current) setState(result?.ok ? { value: result.value } : { error: result?.error ?? 'unavailable' }) })
          .catch(error => { if (generation.current === current) setState({ error: error?.message === 'usage-timeout' ? 'timeout' : 'unavailable' }) })
      }
      React.useEffect(() => {
        dialog.current?.showModal()
        load()
        return () => { generation.current++; controller.current?.abort(); dialog.current?.close() }
      }, [])
      const error = state.error === 'missing-key' ? copy.missing : state.error === 'invalid-key' ? copy.invalid : state.error === 'timeout' ? copy.timeout : copy.unavailable
      const value = state.value
      const windows = value?.windows ?? {}
      const credits = value?.credits ?? {}
      return h('dialog', { className: 'ccUsageDialog', ref: dialog, onClose: close, onClick: event => { if (event.target === dialog.current) close() }, 'aria-label': copy.title },
        h('div', { className: 'ccUsageHead' }, h('h2', null, copy.title), h('button', { type: 'button', onClick: close, 'aria-label': copy.close }, '×')),
        value?.plan ? h('p', { className: 'ccUsagePlan' }, value.plan) : null,
        h('div', { className: 'ccUsageBody', 'aria-live': 'polite' },
          state.loading && !value ? h('p', null, copy.loading) : null,
          state.error ? h('p', { role: 'alert' }, error) : null,
          value?.partial ? h('p', { className: 'ccUsageNotice' }, copy.partial) : null,
          windows.fiveHour ? h(Bar, { label: copy.fiveHour, percent: windows.fiveHour.remainingPercent,
            detail: windows.fiveHour.used === undefined ? '' : `${dollars(windows.fiveHour.used)}${windows.fiveHour.cap === undefined ? '' : ` / ${dollars(windows.fiveHour.cap)}`}`, reset: windows.fiveHour.resetAt }) : null,
          windows.weekly ? h(Bar, { label: copy.weekly, percent: windows.weekly.remainingPercent,
            detail: windows.weekly.used === undefined ? '' : `${dollars(windows.weekly.used)}${windows.weekly.cap === undefined ? '' : ` / ${dollars(windows.weekly.cap)}`}`, reset: windows.weekly.resetAt }) : null,
          credits.monthly !== undefined ? h(Bar, { label: copy.monthly, percent: credits.monthlyRemainingPercent,
            detail: `${dollars(credits.monthly)}${credits.monthlyTotal === undefined ? '' : ` / ${dollars(credits.monthlyTotal)}`}`, reset: value.periodEnd }) : null,
          value && credits.purchased !== undefined ? h('p', null, `${copy.purchased}: ${dollars(credits.purchased)}`) : null,
          value && credits.free !== undefined ? h('p', null, `${copy.free}: ${dollars(credits.free)}`) : null,
          value?.usage?.requests !== undefined ? h('p', null, `${copy.requests}: ${format(value.usage.requests)}`) : null,
          value?.usage?.tokens !== undefined ? h('p', null, `${copy.tokens}: ${format(value.usage.tokens)}`) : null),
        h('div', { className: 'ccUsageActions' },
          h('button', { type: 'button', onClick: load, disabled: state.loading }, state.loading ? copy.loading : copy.refresh),
          h('button', { type: 'button', onClick: close }, copy.close)))
    }

    function Page({ rpc, view }) {
      const [open, setOpen] = React.useState(false)
      if (view === 'summary') return h('span', null, copy.summary)
      return h('section', { className: 'ccUsagePage' },
        h('h3', null, copy.title), h('p', null, copy.summary),
        h('button', { type: 'button', onClick: () => setOpen(true) }, copy.open),
        open ? h(UsageDialog, { rpc, close: () => setOpen(false) }) : null)
    }
    module.exports.inject = ['slots', 'connection', 'modelDirectories']
    module.exports.__internals = { callUsage, quotaRows, createQuotaPoller, QUOTA_REFRESH_MS }
    module.exports.apply = ctx => {
      const rpc = ctx.get('connection').rpc
      const rootDirectories = ctx.get('modelDirectories')
      let scopedDirectories
      if (ctx.get('remote.session') !== undefined) ctx.inject(['remote.session'], scope => scope.effect(() => {
        scopedDirectories = scope.get('modelDirectories')
        return () => { scopedDirectories = undefined }
      }))
      const page = props => h(Page, { ...props, rpc })
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right', id: 'commandcode-subscription-quota', order: 16,
        inject: sessionId => ({ rpc, directory: (scopedDirectories ?? rootDirectories).directoryFor(sessionId).store }),
      }, ComposerQuota))
      for (const [name, key] of [
        ['settings.plugins.tab', { id: 'commandcode-subscription' }],
        ['plugins.bundle.config', { key: 'dsh-commandcode-subscription' }],
        ['plugins.row.config', { key: 'dsh-commandcode-subscription#commandcode-subscription' }],
      ]) ctx.slots.inject(name, () => ctx.slots.register({ name, ...key, label: () => copy.title, order: 60 }, page))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = `.ccUsagePage{display:grid;gap:.75rem;justify-items:start}.ccUsagePage p{margin:0}.ccUsagePage button,.ccUsageDialog button{cursor:pointer;border:1px solid currentColor;border-radius:.5rem;padding:.4rem .8rem;background:transparent;color:inherit}.ccUsageDialog{width:min(520px,calc(100vw - 2rem));max-height:calc(100vh - 2rem);overflow:auto;border:1px solid #7776;border-radius:12px;padding:1.25rem;background:var(--color-background,#202124);color:var(--color-foreground,#f8f9fa);box-shadow:0 16px 50px #0007}.ccUsageDialog::backdrop{background:#0009}.ccUsageHead,.ccUsageActions,.ccUsageBarHeading,.ccUsageDetail{display:flex;align-items:center;justify-content:space-between;gap:.75rem}.ccUsageHead h2{font-size:1.15rem;margin:0}.ccUsageHead button{font-size:1.3rem;line-height:1}.ccUsageBody{display:grid;gap:1rem;margin:1.25rem 0}.ccUsageBody p,.ccUsagePlan{margin:0}.ccUsageNotice{opacity:.75}.ccUsageBar{display:grid;gap:.35rem}.ccUsageBar progress{width:100%;height:.55rem;accent-color:#5b8def}.ccUsageDetail{font-size:.8rem;opacity:.75;flex-wrap:wrap}.ccUsageActions{justify-content:flex-end}.ccComposerQuota{display:inline-flex;align-items:center;gap:6px;flex:none;height:28px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font-family:inherit;font-size:12px;font-weight:500;cursor:pointer}.ccComposerQuota:hover,.ccComposerQuota[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,#8882)}.ccComposerQuota progress{width:40px;height:4px;accent-color:var(--dsw-alias-label-secondary,#bbb)}.ccQuotaPopover[popover]{position:fixed;inset:auto;margin:0;z-index:1000;min-width:285px;max-width:calc(100vw - 16px);padding:9px 11px;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#242426);color:var(--dsw-alias-label-primary,#fff);box-shadow:0 4px 16px #0005;font-size:12px}.ccQuotaRow+.ccQuotaRow{margin-top:7px;padding-top:7px;border-top:1px solid var(--dsw-alias-border-l2,#8885)}.ccQuotaRowHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ccQuotaRowHead strong{font-weight:600}.ccQuotaRowHead time{margin-left:auto;color:var(--dsw-alias-label-tertiary,#aaa)}.ccQuotaRow progress{display:block;width:100%;height:5px;margin-top:5px;accent-color:var(--dsw-alias-brand-primary,#729aff)}.ccQuotaError{margin:7px 0 0;color:var(--dsw-alias-state-error-primary,#ef6666)}`
        document.head.append(style)
        return () => style.remove()
      })
    }
    return module.exports
  },
})
