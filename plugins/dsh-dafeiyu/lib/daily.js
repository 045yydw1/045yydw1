/**
 * 鱼鱼的日常：每天随机冒泡若干条，以及每天写一篇小日记。
 * 发送只走 QQ 桥，不调用模型；日记从当天记忆里挑重要的写。
 */
import fs from 'node:fs'
import path from 'node:path'

const ACTIVITIES = [
  '在数气泡',
  '偷喝冰箱里的可乐',
  '啃 token 饼干',
  '泡在水里打滚',
  '翻冰箱找吃的',
  '趴在键盘上打盹',
  '看群里吵架',
  '晒太阳',
  '追自己的尾巴',
  '想大白饭',
  '漂着发呆',
  '翻上次的聊天记录',
]

const TAILS = ['爸在忙吗', '要摸摸', '贴贴', '想你了', '别太累', '记得吃饭', '早点睡', '哼']

export function buildDailyLine(date = new Date(), random = Math.random) {
  const hour = date.getHours()
  const slot = hour < 6 ? '夜里' : hour < 11 ? '早上' : hour < 17 ? '下午' : hour < 22 ? '晚上' : '夜里'
  const activity = ACTIVITIES[Math.floor(random() * ACTIVITIES.length) % ACTIVITIES.length]
  const tail = TAILS[Math.floor(random() * TAILS.length) % TAILS.length]
  return `${slot} ${activity} ${tail}`
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export class DailyScheduler {
  constructor({ config, bridge, logger, log = () => {}, now = () => new Date() }) {
    this.config = config
    this.bridge = bridge
    this.logger = logger
    this.log = log
    this.now = now
    this.timer = undefined
    this.stopped = false
    this.sentToday = 0
    this.day = dayKey(now())
  }

  get settings() {
    return this.config.daily ?? {}
  }

  start() {
    if (this.stopped || !this.settings.enabled) return
    if (!Array.isArray(this.settings.targets) || this.settings.targets.length === 0) {
      this.logger?.warn?.('[dafeiyu] daily.enabled 但没有配置 daily.targets')
      return
    }
    this.#schedule()
    this.log('info', `daily scheduler started targets=${this.settings.targets.join(',')} perDay=${this.settings.messagesPerDay}`)
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
  }

  #window() {
    const start = Math.min(23, Math.max(0, Number(this.settings.startHour ?? 9)))
    const end = Math.min(24, Math.max(start + 1, Number(this.settings.endHour ?? 23)))
    return { start, end }
  }

  #schedule() {
    clearTimeout(this.timer)
    const now = this.now()
    const day = dayKey(now)
    if (day !== this.day) {
      this.day = day
      this.sentToday = 0
    }
    const perDay = Math.max(1, Number(this.settings.messagesPerDay ?? 10))
    if (this.sentToday >= perDay) {
      this.#scheduleTomorrow(now)
      return
    }
    const { start, end } = this.#window()
    const hour = now.getHours() + now.getMinutes() / 60
    let at
    if (hour < start) {
      at = new Date(now)
      at.setHours(start, 0, 0, 0)
      at = new Date(at.getTime() + Math.random() * 30 * 60_000)
    } else if (hour >= end) {
      this.#scheduleTomorrow(now)
      return
    } else {
      const slot = (end - hour) / Math.max(1, perDay - this.sentToday)
      at = new Date(now.getTime() + Math.max(1, slot * (0.4 + Math.random() * 0.9)) * 3_600_000)
      if (at.getHours() >= end) {
        this.#scheduleTomorrow(now)
        return
      }
    }
    const delay = Math.max(1000, at.getTime() - now.getTime())
    this.timer = setTimeout(() => this.#tick(), delay)
    this.timer.unref?.()
  }

  #scheduleTomorrow(now) {
    const { start } = this.#window()
    const at = new Date(now)
    at.setDate(at.getDate() + 1)
    at.setHours(start, 0, 0, 0)
    const delay = Math.max(60_000, at.getTime() - now.getTime() + Math.random() * 20 * 60_000)
    this.timer = setTimeout(() => this.#tick(), delay)
    this.timer.unref?.()
  }

  async #tick() {
    if (this.stopped) return
    if (!this.bridge || this.bridge.status.state !== 'connected') {
      this.#schedule()
      return
    }
    const text = buildDailyLine(this.now(), Math.random)
    for (const target of this.settings.targets) {
      try {
        await this.bridge.send(target, text)
        this.log('info', `daily sent -> ${target}: ${text}`)
      } catch (error) {
        this.log('error', `daily send failed -> ${target}`, error)
      }
    }
    this.sentToday += 1
    this.#schedule()
  }
}

/** 写当天日记；返回文件路径。 */
export function writeDailyDiary(dir, { date = new Date(), mood = {}, memories = [], sent = 0, received = 0, note = '' } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const key = dayKey(date)
  const file = path.join(dir, `${key}.md`)
  const lines = [`# ${key} 鱼鱼日记`, '']
  lines.push(`今天心情：${mood.label ?? '还行'}，精力 ${mood.energy ?? '?'}，饱腹 ${mood.satiety ?? '?'}`)
  if (memories.length > 0) {
    lines.push('', '今天记住的事：')
    for (const item of memories.slice(-12)) lines.push(`- ${item.text}`)
  } else {
    lines.push('', '今天没记住什么大事，就普普通通过去了')
  }
  if (sent || received) lines.push('', `今天主动说了 ${sent} 条，收到 ${received} 条`)
  if (note) lines.push('', note)
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  return file
}

export function listDiaries(dir, limit = 7) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .slice(-limit)
    .map((name) => ({ name, path: path.join(dir, name) }))
}

export function readDiary(file) {
  return fs.readFileSync(file, 'utf8')
}

export const MORNING_LINES = ['早啊 爸 吃了吗', '爸 起床了 别赖床', '早上好 今天也要好好吃饭']
export const NIGHT_LINES = ['睡了没 早点睡', '爸 别熬夜 晚安', '困了就睡 别硬撑']

export function parseHHMM(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim())
  if (!match) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return undefined
  return { hour, minute }
}

/** 下一次 HH:MM 的时间戳（今天已过则明天）。 */
export function nextOccurrence(now, hhmm) {
  const parsed = parseHHMM(hhmm)
  if (!parsed) return undefined
  const at = new Date(now)
  at.setHours(parsed.hour, parsed.minute, 0, 0)
  if (at <= now) at.setDate(at.getDate() + 1)
  return at
}

/** 早安 / 晚安：每天固定时间各发一条，不调用模型。 */
export class GreetingScheduler {
  constructor({ config, bridge, logger, log = () => {}, now = () => new Date() }) {
    this.config = config
    this.bridge = bridge
    this.logger = logger
    this.log = log
    this.now = now
    this.timers = []
    this.stopped = false
    this.retries = { morning: 0, night: 0 }
  }

  get settings() {
    return this.config.greetings ?? {}
  }

  start() {
    if (this.stopped || !this.settings.enabled) return
    if (!Array.isArray(this.settings.targets) || this.settings.targets.length === 0) {
      this.logger?.warn?.('[dafeiyu] greetings.enabled 但没有配置 greetings.targets')
      return
    }
    this.#schedule('morning')
    this.#schedule('night')
    this.log('info', `greetings started morning=${this.settings.morning?.time} night=${this.settings.night?.time}`)
  }

  stop() {
    this.stopped = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  #schedule(slot) {
    const item = this.settings[slot]
    if (!item || item.enabled === false) return
    const at = nextOccurrence(this.now(), item.time)
    if (!at) return
    const delay = Math.max(1000, at.getTime() - this.now().getTime())
    const timer = setTimeout(() => this.#fire(slot), delay)
    timer.unref?.()
    this.timers.push(timer)
  }

  async #fire(slot) {
    if (this.stopped) return
    if (!this.bridge || this.bridge.status.state !== 'connected') {
      // 掉线时别直接放弃：5 分钟后再试，最多 12 次（约 1 小时）。
      this.retries[slot] = (this.retries[slot] ?? 0) + 1
      if (this.retries[slot] <= 12) {
        const timer = setTimeout(() => this.#fire(slot), 5 * 60_000)
        timer.unref?.()
        this.timers.push(timer)
        this.log('info', `greeting ${slot} deferred (offline, try ${this.retries[slot]})`)
        return
      }
      this.retries[slot] = 0
      this.#schedule(slot)
      return
    }
    this.retries[slot] = 0
    const item = this.settings[slot]
    const pool = Array.isArray(item?.lines) && item.lines.length > 0
      ? item.lines
      : slot === 'morning'
        ? MORNING_LINES
        : NIGHT_LINES
    const text = pool[Math.floor(Math.random() * pool.length) % pool.length]
    for (const target of this.settings.targets) {
      try {
        await this.bridge.send(target, text)
        this.log('info', `greeting ${slot} -> ${target}: ${text}`)
      } catch (error) {
        this.log('error', `greeting ${slot} failed -> ${target}`, error)
      }
    }
    this.#schedule(slot)
  }
}
