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
      modelSettings: '模型设置', model: '模型', effort: '思考等级', speed: '速度', standard: '标准', fast: '快速', ultrafast: '极速',
      providerDefault: '模型默认', back: '返回', searchModels: '搜索模型', noMatch: '没有匹配的模型', selectFailed: '切换模型失败，请重试。',
      accounts: 'Command Code 账户', login: '登录', logout: '登出', active: '当前使用', addKey: '添加 API Key', keyHint: '输入 Command Code API Key',
      add: '保存并使用', cancel: '取消', confirmLogout: '确认登出', noAccounts: '尚未添加账户', accountLoading: '正在读取账户…',
      accountFailed: '账户操作失败，请重试。', duplicate: '这个 API Key 已存在。', tooMany: '最多保存 10 个账户。',
      planUnknown: '订阅类型未知', refreshAccounts: '刷新用量',
    } : {
      title: 'Command Code usage', summary: 'View account quotas and usage', open: 'View usage', close: 'Close', refresh: 'Refresh', loading: 'Loading usage…',
      missing: 'Configure COMMANDCODE_API_KEY in the DSH credential manager first.', invalid: 'API key is invalid or cannot read usage.', unavailable: 'Usage is unavailable. Try again later.', timeout: 'Usage request timed out. Please retry.',
      partial: 'Some data is unavailable; showing what was returned.', remaining: 'remaining', fiveHour: '5-hour limit', weekly: 'Weekly limit', monthly: 'Monthly credits',
      purchased: 'Purchased credits', free: 'Free credits', requests: 'Requests', tokens: 'Tokens', reset: 'Resets', unknown: 'No limit reported by provider',
      modelSettings: 'Model settings', model: 'Model', effort: 'Reasoning effort', speed: 'Speed', standard: 'Standard', fast: 'Fast', ultrafast: 'Ultrafast',
      providerDefault: 'Model default', back: 'Back', searchModels: 'Search models', noMatch: 'No matching models', selectFailed: 'Could not switch model. Try again.',
      accounts: 'Command Code accounts', login: 'Log in', logout: 'Log out', active: 'Active', addKey: 'Add API key', keyHint: 'Enter Command Code API key',
      add: 'Save and use', cancel: 'Cancel', confirmLogout: 'Confirm logout', noAccounts: 'No accounts added', accountLoading: 'Loading accounts…',
      accountFailed: 'Account operation failed. Try again.', duplicate: 'This API key is already saved.', tooMany: 'Up to 10 accounts can be saved.',
      planUnknown: 'Plan unavailable', refreshAccounts: 'Refresh usage',
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

    async function callAccounts(rpc, payload, timeoutMs = 35_000) {
      const controller = new AbortController()
      let timer
      try {
        return await Promise.race([
          Promise.resolve().then(() => rpc.call('/api', 'commandcode-subscription/accounts', payload, controller.signal)),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('account-timeout')) }, timeoutMs) }),
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

    const SPEED_FAMILIES = [
      { standard: 'deepseek/deepseek-v4-flash', fast: 'deepseek/deepseek-v4-flash-fast' },
      { standard: 'deepseek/deepseek-v4.1-flash', fast: 'deepseek/deepseek-v4.1-flash-fast', ultrafast: 'deepseek/deepseek-v4.1-flash-ultrafast' },
      { standard: 'zai-org/GLM-5.2', fast: 'zai-org/GLM-5.2-Fast' },
      { standard: 'moonshotai/Kimi-K2.7-Code', fast: 'moonshotai/Kimi-K2.7-Code-Highspeed' },
      { standard: 'xiaomi/mimo-v2.6-pro', ultrafast: 'xiaomi/mimo-v2.6-pro-ultraspeed' },
    ]
    function speedChoices(modelId, models) {
      const family = SPEED_FAMILIES.find(group => Object.values(group).includes(modelId))
      if (!family) return []
      const available = new Set(models.map(model => model.id))
      const choices = Object.entries(family).filter(([, id]) => available.has(id)).map(([speed, id]) => ({ id, label: copy[speed] }))
      return choices.length > 1 ? choices : []
    }

    function ComposerModelOptions({ directory }) {
      const state = React.useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)
      const current = state?.current
      const [open, setOpen] = React.useState(false)
      const [pane, setPane] = React.useState('root')
      const [query, setQuery] = React.useState('')
      const [error, setError] = React.useState('')
      const trigger = React.useRef(null)
      const panel = React.useRef(null)
      const models = state?.groups?.find(group => group.id === 'commandcode-go')?.models ?? []
      const selected = models.find(model => model.id === current?.model)
      const effortChoices = selected?.reasoning?.efforts ?? []
      const speeds = speedChoices(current?.model, models)
      const currentSpeed = speeds.find(choice => choice.id === current?.model)?.label
      const currentEffort = effortChoices.find(level => level.id === current?.reasoningEffort)?.name ?? copy.providerDefault
      const dismiss = () => { setOpen(false); setPane('root'); setQuery('') }
      const choose = async selection => {
        setError('')
        try {
          const result = await directory.select(selection)
          if (result?.ok === false) throw new Error('selection rejected')
          dismiss()
        } catch { setError(copy.selectFailed) }
      }
      React.useEffect(() => { if (current?.provider !== 'commandcode-go') dismiss() }, [current?.provider])
      React.useEffect(() => {
        const node = panel.current
        if (!open || !node) return undefined
        const position = () => {
          const rect = trigger.current?.getBoundingClientRect()
          if (!rect) return
          const width = node.offsetWidth, height = node.offsetHeight
          node.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`
          const above = rect.top - height - 8
          node.style.top = `${Math.max(8, Math.min(above >= 8 ? above : rect.bottom + 8, window.innerHeight - height - 8))}px`
        }
        node.showPopover?.()
        position()
        const outside = event => { if (!node.contains(event.target) && !trigger.current?.contains(event.target)) dismiss() }
        const escape = event => { if (event.key === 'Escape') { event.preventDefault(); if (pane === 'root') dismiss(); else setPane('root') } }
        document.addEventListener('pointerdown', outside)
        document.addEventListener('keydown', escape)
        window.addEventListener('resize', position)
        return () => {
          document.removeEventListener('pointerdown', outside)
          document.removeEventListener('keydown', escape)
          window.removeEventListener('resize', position)
          if (node.matches?.(':popover-open')) node.hidePopover()
        }
      }, [open, pane])
      if (current?.provider !== 'commandcode-go') return null
      const cell = (label, value, next) => h('button', { type: 'button', className: 'ccModelCell', role: 'menuitem', onClick: () => { setError(''); setPane(next) } },
        h('span', null, label), h('span', { className: 'ccModelCellValue' }, value), h('span', { 'aria-hidden': true }, '›'))
      const option = (label, active, onClick, key) => h('button', { type: 'button', className: 'ccModelChoice', role: 'menuitemradio',
        'aria-checked': active, onClick, key }, h('span', null, label), active ? h('span', { 'aria-hidden': true }, '✓') : null)
      const shown = models.filter(model => `${model.name} ${model.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      return h(React.Fragment, null,
        h('button', { ref: trigger, type: 'button', className: 'ccComposerModelSettings', 'aria-label': copy.modelSettings,
          'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => { setPane('root'); setOpen(value => !value) } }, '⚙'),
        open ? h('div', { ref: panel, popover: 'manual', className: 'ccModelMenu', role: 'menu', 'aria-label': copy.modelSettings },
          pane === 'root' ? h(React.Fragment, null,
            cell(copy.model, selected?.name ?? current.model, 'model'),
            effortChoices.length ? cell(copy.effort, currentEffort, 'effort') : null,
            speeds.length ? cell(copy.speed, currentSpeed, 'speed') : null) : h(React.Fragment, null,
            h('button', { type: 'button', className: 'ccModelBack', onClick: () => setPane('root') }, `‹ ${copy.back}`),
            pane === 'model' ? h(React.Fragment, null,
              h('input', { className: 'ccModelSearch', type: 'search', value: query, placeholder: copy.searchModels,
                'aria-label': copy.searchModels, onChange: event => setQuery(event.target.value) }),
              shown.length ? shown.map(model => option(model.name, model.id === current.model,
                () => void choose({ provider: 'commandcode-go', model: model.id }), model.id)) : h('p', null, copy.noMatch)) : null,
            pane === 'effort' ? h(React.Fragment, null,
              option(copy.providerDefault, current.reasoningEffort === undefined,
                () => void choose({ provider: 'commandcode-go', model: current.model }), 'default'),
              effortChoices.map(level => option(level.name, level.id === current.reasoningEffort,
                () => void choose({ provider: 'commandcode-go', model: current.model, reasoningEffort: level.id }), level.id))) : null,
            pane === 'speed' ? speeds.map(choice => option(choice.label, choice.id === current.model,
              () => void choose({ provider: 'commandcode-go', model: choice.id }), choice.id)) : null),
          error ? h('p', { role: 'alert', className: 'ccModelError' }, error) : null) : null)
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
        window.addEventListener('commandcode-subscription:account-changed', wake)
        return () => { poller.stop(); document.removeEventListener('visibilitychange', wake)
          window.removeEventListener('commandcode-subscription:account-changed', wake) }
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

    function AccountsPage({ rpc }) {
      const [status, setStatus] = React.useState({ accounts: [], activeId: null, loading: true })
      const [entries, setEntries] = React.useState({})
      const [key, setKey] = React.useState('')
      const [adding, setAdding] = React.useState(false)
      const [confirm, setConfirm] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const live = React.useRef(true)
      const flight = React.useRef(false)
      const generation = React.useRef(0)
      const refresh = async () => {
        if (!live.current || flight.current || document.visibilityState === 'hidden') return
        flight.current = true
        const version = generation.current
        try {
          const accounts = await callAccounts(rpc, { action: 'status' })
          if (!accounts?.ok) throw new Error(accounts?.error)
          if (live.current && version === generation.current) setStatus({ ...accounts.value, loading: false })
          const usage = accounts.value.accounts.length ? await callAccounts(rpc, { action: 'usage' }) : { ok: true, value: [] }
          if (!usage?.ok) throw new Error(usage?.error)
          if (live.current && version === generation.current) {
            setEntries(Object.fromEntries(usage.value.map(entry => [entry.id, entry])))
            setError('')
          }
        } catch {
          if (live.current && version === generation.current) {
            setStatus(previous => ({ ...previous, loading: false }))
            setError(copy.accountFailed)
          }
        } finally { flight.current = false }
      }
      React.useEffect(() => {
        live.current = true
        void refresh()
        const timer = setInterval(() => void refresh(), QUOTA_REFRESH_MS)
        const wake = () => { if (document.visibilityState !== 'hidden') void refresh() }
        document.addEventListener('visibilitychange', wake)
        return () => { live.current = false; generation.current++; clearInterval(timer); document.removeEventListener('visibilitychange', wake) }
      }, [rpc])
      const change = async payload => {
        setBusy(true); setError('')
        try {
          const result = await callAccounts(rpc, payload)
          if (!result?.ok) throw new Error(result?.error)
          generation.current++
          setStatus({ ...result.value, loading: false })
          setEntries({})
          window.dispatchEvent(new Event('commandcode-subscription:account-changed'))
          setAdding(false); setConfirm(false); setKey('')
          // A previous slow quota read may still be in flight; refresh again
          // once it settles, while the next 30-second tick remains a fallback.
          const retry = () => { if (!live.current) return; if (flight.current) setTimeout(retry, 100); else void refresh() }
          retry()
        } catch (cause) {
          setError(cause?.message === 'duplicate' ? copy.duplicate : cause?.message === 'too-many' ? copy.tooMany
            : cause?.message === 'invalid-key' ? copy.invalid : copy.accountFailed)
        } finally { setBusy(false) }
      }
      return h('section', { className: 'ccAccountsPage' },
        h('div', { className: 'ccAccountsHeader' }, h('h2', null, copy.accounts),
          h('div', { className: 'ccAccountsActions' },
            h('button', { type: 'button', disabled: busy, onClick: () => { setAdding(true); setConfirm(false) } }, copy.login),
            status.accounts.length ? h('button', { type: 'button', disabled: busy, onClick: () => { setConfirm(true); setAdding(false) } }, copy.logout) : null,
            h('button', { type: 'button', disabled: busy, onClick: () => void refresh() }, copy.refreshAccounts))),
        adding ? h('form', { className: 'ccAccountsForm', onSubmit: event => { event.preventDefault(); if (key.trim()) void change({ action: 'add', key: key.trim() }) } },
          h('label', null, copy.addKey, h('input', { type: 'password', value: key, autoComplete: 'off', spellCheck: false,
            placeholder: copy.keyHint, onChange: event => setKey(event.target.value) })),
          h('button', { type: 'submit', disabled: busy || !key.trim() }, copy.add),
          h('button', { type: 'button', onClick: () => { setAdding(false); setKey('') } }, copy.cancel)) : null,
        confirm ? h('div', { className: 'ccAccountsConfirm' },
          h('button', { type: 'button', disabled: busy, onClick: () => void change({ action: 'logout' }) }, copy.confirmLogout),
          h('button', { type: 'button', onClick: () => setConfirm(false) }, copy.cancel)) : null,
        error ? h('p', { role: 'alert', className: 'ccAccountError' }, error) : null,
        status.loading ? h('p', null, copy.accountLoading) : status.accounts.length === 0 ? h('p', null, copy.noAccounts) :
          h('div', { className: 'ccAccountCards' }, status.accounts.map(account => {
            const entry = entries[account.id]
            const rows = quotaRows(entry?.value)
            return h('article', { key: account.id, className: 'ccAccountCard', 'data-active': account.active },
              h('div', { className: 'ccAccountIdentity' },
                h('input', { type: 'checkbox', checked: account.active, disabled: busy, 'aria-label': `${copy.active}: ${account.label}`,
                  onChange: () => { if (!account.active) void change({ action: 'select', id: account.id }) } }),
                h('strong', null, entry?.value?.account ?? account.label), h('span', null, entry?.value?.plan ?? copy.planUnknown),
                account.active ? h('small', null, copy.active) : null),
              h('div', { className: 'ccAccountQuotas' }, rows.map(row => h('div', { key: row.id, className: 'ccAccountQuota' },
                h('span', null, row.id), h('progress', { max: 100, ...(row.percent === undefined ? {} : { value: row.percent }),
                  'aria-label': `${row.label}: ${row.percent === undefined ? copy.unknown : `${row.percent}% ${copy.remaining}`}` }),
                h('span', null, row.percent === undefined ? '—' : `${row.percent}%`)))),
              entry?.error ? h('p', { className: 'ccAccountError' }, entry.error === 'invalid-key' ? copy.invalid : copy.unavailable) : null)
          })))
    }
    module.exports.inject = ['slots', 'connection', 'modelDirectories']
    module.exports.__internals = { callUsage, quotaRows, createQuotaPoller, speedChoices, QUOTA_REFRESH_MS }
    module.exports.apply = ctx => {
      const rpc = ctx.get('connection').rpc
      const rootDirectories = ctx.get('modelDirectories')
      let scopedDirectories
      if (ctx.get('remote.session') !== undefined) ctx.inject(['remote.session'], scope => scope.effect(() => {
        scopedDirectories = scope.get('modelDirectories')
        return () => { scopedDirectories = undefined }
      }))
      const page = props => h(Page, { ...props, rpc })
      const accountsPage = props => h(AccountsPage, { ...props, rpc })
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'commandcode-subscription', order: 16, label: () => copy.accounts,
      }, accountsPage))
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right', id: 'commandcode-subscription-quota', order: 16,
        inject: sessionId => ({ rpc, directory: (scopedDirectories ?? rootDirectories).directoryFor(sessionId).store }),
      }, ComposerQuota))
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right', id: 'commandcode-subscription-model-options', order: 17,
        inject: sessionId => ({ directory: (scopedDirectories ?? rootDirectories).directoryFor(sessionId) }),
      }, ComposerModelOptions))
      for (const [name, key] of [
        ['settings.plugins.tab', { id: 'commandcode-subscription' }],
        ['plugins.bundle.config', { key: 'dsh-commandcode-subscription' }],
        ['plugins.row.config', { key: 'dsh-commandcode-subscription#commandcode-subscription' }],
      ]) ctx.slots.inject(name, () => ctx.slots.register({ name, ...key, label: () => copy.title, order: 60 }, page))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = `.ccUsagePage{display:grid;gap:.75rem;justify-items:start}.ccUsagePage p{margin:0}.ccUsagePage button,.ccUsageDialog button{cursor:pointer;border:1px solid currentColor;border-radius:.5rem;padding:.4rem .8rem;background:transparent;color:inherit}.ccUsageDialog{width:min(520px,calc(100vw - 2rem));max-height:calc(100vh - 2rem);overflow:auto;border:1px solid #7776;border-radius:12px;padding:1.25rem;background:var(--color-background,#202124);color:var(--color-foreground,#f8f9fa);box-shadow:0 16px 50px #0007}.ccUsageDialog::backdrop{background:#0009}.ccUsageHead,.ccUsageActions,.ccUsageBarHeading,.ccUsageDetail{display:flex;align-items:center;justify-content:space-between;gap:.75rem}.ccUsageHead h2{font-size:1.15rem;margin:0}.ccUsageHead button{font-size:1.3rem;line-height:1}.ccUsageBody{display:grid;gap:1rem;margin:1.25rem 0}.ccUsageBody p,.ccUsagePlan{margin:0}.ccUsageNotice{opacity:.75}.ccUsageBar{display:grid;gap:.35rem}.ccUsageBar progress{width:100%;height:.55rem;accent-color:#5b8def}.ccUsageDetail{font-size:.8rem;opacity:.75;flex-wrap:wrap}.ccUsageActions{justify-content:flex-end}.ccComposerQuota{display:inline-flex;align-items:center;gap:6px;flex:none;height:28px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font-family:inherit;font-size:12px;font-weight:500;cursor:pointer}.ccComposerQuota:hover,.ccComposerQuota[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,#8882)}.ccComposerQuota progress{width:40px;height:4px;accent-color:var(--dsw-alias-label-secondary,#bbb)}.ccQuotaPopover[popover]{position:fixed;inset:auto;margin:0;z-index:1000;min-width:285px;max-width:calc(100vw - 16px);padding:9px 11px;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#242426);color:var(--dsw-alias-label-primary,#fff);box-shadow:0 4px 16px #0005;font-size:12px}.ccQuotaRow+.ccQuotaRow{margin-top:7px;padding-top:7px;border-top:1px solid var(--dsw-alias-border-l2,#8885)}.ccQuotaRowHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ccQuotaRowHead strong{font-weight:600}.ccQuotaRowHead time{margin-left:auto;color:var(--dsw-alias-label-tertiary,#aaa)}.ccQuotaRow progress{display:block;width:100%;height:5px;margin-top:5px;accent-color:var(--dsw-alias-brand-primary,#729aff)}.ccQuotaError{margin:7px 0 0;color:var(--dsw-alias-state-error-primary,#ef6666)}`
        style.textContent += `.ccComposerModelSettings{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font-size:16px;cursor:pointer}.ccComposerModelSettings:hover,.ccComposerModelSettings[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,#8882)}.ccModelMenu[popover]{position:fixed;inset:auto;margin:0;z-index:1000;width:280px;max-width:calc(100vw - 16px);max-height:min(420px,70vh);overflow:auto;padding:5px;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#242426);color:var(--dsw-alias-label-primary,#fff);box-shadow:0 6px 20px #0005;font-size:13px}.ccModelCell,.ccModelChoice,.ccModelBack{display:flex;align-items:center;gap:10px;width:100%;min-height:33px;padding:7px 9px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}.ccModelCell:hover,.ccModelChoice:hover,.ccModelBack:hover{background:var(--dsw-alias-interactive-bg-hover,#8882)}.ccModelCell>span:first-child,.ccModelChoice>span:first-child{flex:1}.ccModelCellValue{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#bbb)}.ccModelBack{border-bottom:1px solid var(--dsw-alias-border-l2,#8885);border-radius:0}.ccModelSearch{box-sizing:border-box;width:calc(100% - 12px);margin:7px 6px;padding:7px;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:6px;background:transparent;color:inherit;font:inherit}.ccModelMenu p{margin:8px}.ccModelError{color:var(--dsw-alias-state-error-primary,#ef6666)}`
        style.textContent += `.ccAccountsPage{display:grid;gap:16px;max-width:900px;padding:8px 2px;color:inherit}.ccAccountsHeader,.ccAccountsActions,.ccAccountIdentity,.ccAccountsForm,.ccAccountsConfirm{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ccAccountsHeader{justify-content:space-between}.ccAccountsHeader h2{margin:0;font-size:18px}.ccAccountsPage button{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:7px;padding:7px 11px;background:transparent;color:inherit;font:inherit}.ccAccountsPage button:disabled{opacity:.5;cursor:default}.ccAccountsForm label{display:grid;gap:5px;flex:1;min-width:230px}.ccAccountsForm input{box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:7px;background:transparent;color:inherit;font:inherit}.ccAccountCards{display:grid;gap:12px}.ccAccountCard{display:grid;gap:12px;padding:14px;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#8881)}.ccAccountCard[data-active=true]{border-color:var(--dsw-alias-brand-primary,#729aff)}.ccAccountIdentity strong{font-size:14px}.ccAccountIdentity span{color:var(--dsw-alias-label-secondary,#aaa)}.ccAccountIdentity small{margin-left:auto}.ccAccountQuotas{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.ccAccountQuota{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:7px;font-size:12px}.ccAccountQuota progress{width:100%;height:7px;accent-color:var(--dsw-alias-brand-primary,#729aff)}.ccAccountError{margin:0;color:var(--dsw-alias-state-error-primary,#ef6666)}@media(max-width:620px){.ccAccountQuotas{grid-template-columns:1fr}}`
        document.head.append(style)
        return () => style.remove()
      })
    }
    return module.exports
  },
})
