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
      missing: '请先在 DSH 凭证管理器配置 COMMANDCODE_API_KEY。', invalid: 'API Key 无效或无权查询用量。', unavailable: '用量查询失败，请稍后重试。',
      partial: '部分数据暂不可用，以下为已读取的用量。', remaining: '剩余', fiveHour: '5 小时额度', weekly: '每周额度', monthly: '每月额度',
      purchased: '购买额度余额', free: '免费额度余额', requests: '请求数', tokens: 'Token 数', reset: '重置时间', unknown: '服务商未提供额度上限',
    } : {
      title: 'Command Code usage', summary: 'View account quotas and usage', open: 'View usage', close: 'Close', refresh: 'Refresh', loading: 'Loading usage…',
      missing: 'Configure COMMANDCODE_API_KEY in the DSH credential manager first.', invalid: 'API key is invalid or cannot read usage.', unavailable: 'Usage is unavailable. Try again later.',
      partial: 'Some data is unavailable; showing what was returned.', remaining: 'remaining', fiveHour: '5-hour limit', weekly: 'Weekly limit', monthly: 'Monthly credits',
      purchased: 'Purchased credits', free: 'Free credits', requests: 'Requests', tokens: 'Tokens', reset: 'Resets', unknown: 'No limit reported by provider',
    }
    const format = number => Number(number).toLocaleString(zh ? 'zh-CN' : 'en-US', { maximumFractionDigits: 3 })
    const date = value => new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US')
    const dollars = value => `$${format(value)}`

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
        const signal = controller.current.signal
        setState(previous => ({ ...previous, loading: true, error: undefined }))
        Promise.resolve().then(() => rpc.call('/api', 'commandcode-subscription/usage', {}, signal))
          .then(result => { if (generation.current === current) setState(result?.ok ? { value: result.value } : { error: result?.error ?? 'unavailable' }) })
          .catch(() => { if (generation.current === current) setState({ error: 'unavailable' }) })
      }
      React.useEffect(() => {
        dialog.current?.showModal()
        load()
        return () => { generation.current++; controller.current?.abort(); dialog.current?.close() }
      }, [])
      const error = state.error === 'missing-key' ? copy.missing : state.error === 'invalid-key' ? copy.invalid : copy.unavailable
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
    module.exports.inject = ['slots', 'connection']
    module.exports.apply = ctx => {
      const rpc = ctx.get('connection').rpc
      const page = props => h(Page, { ...props, rpc })
      for (const [name, key] of [
        ['settings.plugins.tab', { id: 'commandcode-subscription' }],
        ['plugins.bundle.config', { key: 'dsh-commandcode-subscription' }],
        ['plugins.row.config', { key: 'dsh-commandcode-subscription#commandcode-subscription' }],
      ]) ctx.slots.inject(name, () => ctx.slots.register({ name, ...key, label: () => copy.title, order: 60 }, page))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = `.ccUsagePage{display:grid;gap:.75rem;justify-items:start}.ccUsagePage p{margin:0}.ccUsagePage button,.ccUsageDialog button{cursor:pointer;border:1px solid currentColor;border-radius:.5rem;padding:.4rem .8rem;background:transparent;color:inherit}.ccUsageDialog{width:min(520px,calc(100vw - 2rem));max-height:calc(100vh - 2rem);overflow:auto;border:1px solid #7776;border-radius:12px;padding:1.25rem;background:var(--color-background,#202124);color:var(--color-foreground,#f8f9fa);box-shadow:0 16px 50px #0007}.ccUsageDialog::backdrop{background:#0009}.ccUsageHead,.ccUsageActions,.ccUsageBarHeading,.ccUsageDetail{display:flex;align-items:center;justify-content:space-between;gap:.75rem}.ccUsageHead h2{font-size:1.15rem;margin:0}.ccUsageHead button{font-size:1.3rem;line-height:1}.ccUsageBody{display:grid;gap:1rem;margin:1.25rem 0}.ccUsageBody p,.ccUsagePlan{margin:0}.ccUsageNotice{opacity:.75}.ccUsageBar{display:grid;gap:.35rem}.ccUsageBar progress{width:100%;height:.55rem;accent-color:#5b8def}.ccUsageDetail{font-size:.8rem;opacity:.75;flex-wrap:wrap}.ccUsageActions{justify-content:flex-end}`
        document.head.append(style)
        return () => style.remove()
      })
    }
    return module.exports
  },
})
