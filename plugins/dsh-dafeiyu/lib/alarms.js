import { randomUUID } from 'node:crypto'
import { JsonStore } from './store.js'

const MAX_ACTIVE = 50
const MAX_DELAY = 366 * 24 * 60 * 60 * 1000

/** Persisted one-shot alarms delivered through the QQ bridge. */
export class AlarmScheduler {
  constructor({ file, bridge, logger, now = () => Date.now() }) {
    this.store = new JsonStore(file, () => ({ alarms: [] }))
    this.store.load()
    if (!Array.isArray(this.store.data?.alarms)) this.store.data = { alarms: [] }
    this.bridge = bridge
    this.logger = logger
    this.now = now
    this.timer = undefined
    this.stopped = false
  }

  add({ target, when, message }) {
    const at = parseLocalDateTime(when)
    if (!at || at <= this.now()) throw new Error('时间无效或已经过去，请用 YYYY-MM-DD HH:mm 的本地时间')
    if (at - this.now() > MAX_DELAY) throw new Error('闹钟最多只能提前一年设置')
    const alarms = this.store.data.alarms
    if (alarms.length >= MAX_ACTIVE) throw new Error(`最多保留 ${MAX_ACTIVE} 个未响闹钟`)
    const alarm = { id: randomUUID().slice(0, 8), target, at, message: String(message).trim().slice(0, 300) }
    alarms.push(alarm)
    this.store.save()
    this.#schedule()
    return alarm
  }

  list(target) {
    return this.store.data.alarms.filter((alarm) => alarm.target === target).sort((a, b) => a.at - b.at)
  }

  cancel(id, target) {
    const before = this.store.data.alarms.length
    this.store.data.alarms = this.store.data.alarms.filter((alarm) => alarm.id !== id || alarm.target !== target)
    if (before === this.store.data.alarms.length) return false
    this.store.save()
    this.#schedule()
    return true
  }

  start() { this.#schedule() }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
  }

  #schedule() {
    clearTimeout(this.timer)
    if (this.stopped || this.store.data.alarms.length === 0) return
    const next = Math.min(...this.store.data.alarms.map((alarm) => alarm.at))
    this.timer = setTimeout(() => this.#fireDue(), Math.max(1000, Math.min(2_000_000_000, next - this.now())))
    this.timer.unref?.()
  }

  async #fireDue() {
    if (this.stopped) return
    const due = this.store.data.alarms.filter((alarm) => alarm.at <= this.now())
    for (const alarm of due) {
      if (!this.bridge || this.bridge.status.state !== 'connected') {
        // Keep the alarm and retry shortly after QQ reconnects.
        alarm.at = this.now() + 5 * 60_000
        continue
      }
      try {
        await this.bridge.send(alarm.target, `⏰ 鱼鱼提醒你：${alarm.message}`)
        this.store.data.alarms = this.store.data.alarms.filter((item) => item.id !== alarm.id)
      } catch (error) {
        this.logger?.warn?.(`[dafeiyu] 闹钟发送失败，将稍后重试：${error?.message ?? error}`)
        alarm.at = this.now() + 5 * 60_000
      }
    }
    this.store.save()
    this.#schedule()
  }
}

function parseLocalDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return undefined
  const [, year, month, day, hour, minute] = match
  const [y, mo, d, h, mi] = [year, month, day, hour, minute].map(Number)
  const date = new Date(y, mo - 1, d, h, mi, 0, 0)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) return undefined
  return date.getTime()
}

