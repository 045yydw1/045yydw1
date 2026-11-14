/**
 * 鱼鱼的日常：不定时冒个泡。
 *
 * 只发短句模板（不调用模型，零 token），按时间段挑，避开安静时段。
 * 发送走 OneBot 桥，目标由 config.life.targets 指定。
 */

export const ROUTINES = {
  morning: [
    '早上 鱼在晒壳 顺便想你 要摸摸',
    '鱼刚醒 头发是水草 要梳梳',
    '早 鱼在窗边发呆 要看看',
  ],
  afternoon: [
    '下午 鱼在数气泡 数到 37 忘了 要提醒',
    '刚才鱼差点被自己的尾巴吓到 要抱抱',
    '鱼在键盘上趴了一会 键帽是温的 要摸摸',
    '午后 鱼困得睁不开眼 想趴键盘 要摸摸',
  ],
  evening: [
    '鱼今天学会翻肚皮 想表演 要看看',
    '傍晚 鱼有点困 想找个暖和的地方 要陪陪',
    '鱼在打哈欠 尾巴都软了 要陪陪',
  ],
  night: [
    '夜里 鱼在漂 有点想你 要陪陪',
    '鱼准备睡了 枕头是键盘 要晚安',
    '鱼在黑暗里发光 一点点 要看看',
  ],
}

export function slotFor(date = new Date()) {
  const hour = date.getHours()
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 23) return 'evening'
  return 'night'
}

export function pickRoutine(date = new Date(), { templates = {}, random = Math.random } = {}) {
  const slot = slotFor(date)
  const pool = Array.isArray(templates[slot]) && templates[slot].length > 0 ? templates[slot] : ROUTINES[slot]
  return pool[Math.floor(random() * pool.length) % pool.length]
}

/** "23:30" -> 1410 分钟。 */
export function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim())
  if (!match) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return undefined
  return hour * 60 + minute
}

/** 判断某一刻是否在安静时段（支持跨午夜）。 */
export function inQuietHours(date, quiet) {
  if (!quiet || !quiet.start || !quiet.end) return false
  const start = parseClock(quiet.start)
  const end = parseClock(quiet.end)
  if (start === undefined || end === undefined || start === end) return false
  const now = date.getHours() * 60 + date.getMinutes()
  return start < end ? now >= start && now < end : now >= start || now < end
}

/** 距离安静时段结束还有多少毫秒（不在安静时段返回 0）。 */
export function msUntilQuietEnd(date, quiet) {
  if (!inQuietHours(date, quiet)) return 0
  const end = parseClock(quiet.end)
  if (end === undefined) return 0
  const target = new Date(date)
  target.setHours(Math.floor(end / 60), end % 60, 0, 0)
  if (target <= date) target.setDate(target.getDate() + 1)
  return target.getTime() - date.getTime()
}

export class LifeScheduler {
  constructor({ config, bridge, logger, log = () => {}, now = () => new Date() }) {
    this.config = config
    this.bridge = bridge
    this.logger = logger
    this.log = log
    this.now = now
    this.timer = undefined
    this.stopped = false
    this.sent = 0
  }

  get settings() {
    return this.config.life
  }

  start() {
    if (this.stopped) return
    if (!this.settings.enabled) return
    if (!Array.isArray(this.settings.targets) || this.settings.targets.length === 0) {
      this.logger?.warn?.('[dafeiyu] life.enabled 但没有配置 life.targets，日常不会发送')
      this.log('warn', 'life enabled without targets')
      return
    }
    this.#schedule(this.#nextDelay())
    this.log('info', `life scheduler started targets=${this.settings.targets.join(',')}`)
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.timer = undefined
  }

  #nextDelay() {
    const min = Math.max(0.001, Number(this.settings.minMinutes) || 90)
    const max = Math.max(min, Number(this.settings.maxMinutes) || 240)
    return (min + Math.random() * (max - min)) * 60_000
  }

  #schedule(delay) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.#tick(), Math.max(50, delay))
    this.timer.unref?.()
  }

  async #tick() {
    if (this.stopped) return
    const now = this.now()
    if (inQuietHours(now, this.settings.quietHours)) {
      const wait = msUntilQuietEnd(now, this.settings.quietHours) + this.#nextDelay()
      this.log('info', `life quiet until ${this.settings.quietHours.end}, next in ${Math.round(wait / 60000)}min`)
      this.#schedule(wait)
      return
    }
    if (!this.bridge || this.bridge.status.state !== 'connected') {
      this.log('info', 'life skipped: bridge not connected')
      this.#schedule(this.#nextDelay() / 4)
      return
    }
    const text = pickRoutine(now, { templates: this.settings.templates ?? {} })
    for (const target of this.settings.targets) {
      try {
        await this.bridge.send(target, text)
        this.sent += 1
        this.log('info', `life sent -> ${target}: ${text}`)
      } catch (error) {
        this.log('error', `life send failed -> ${target}`, error)
        this.logger?.warn?.(`[dafeiyu] 日常发送失败（${target}）：${error?.message ?? error}`)
      }
    }
    this.#schedule(this.#nextDelay())
  }
}
