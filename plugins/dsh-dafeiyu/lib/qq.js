/**
 * OneBot 11（正向 WebSocket）桥接。
 *
 * - 连接 NapCat / LLOneBot / Lagrange 等实现的 ws 服务端
 * - 接收私聊与群聊消息，归一化成 {text, target, userId, ...}
 * - 通过 send_msg action 发消息，按 echo 匹配响应
 * - 断线指数退避重连，心跳超时检测
 *
 * 只用 Node 内置能力（global WebSocket、crypto、events），无第三方依赖。
 */
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const MAX_TEXT = 4000

export class OneBotError extends Error {
  constructor(message, code = 'ONEBOT_ERROR') {
    super(message)
    this.name = 'OneBotError'
    this.code = code
  }
}

function asId(value) {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : value
}

/** 解析 "private:123" / "group:456" / "123" 形式的目标。 */
export function parseTarget(spec) {
  const text = String(spec ?? '').trim()
  const match = /^(?:(private|user|group|g|p):)?(\d{3,})$/i.exec(text)
  if (!match) throw new OneBotError(`无法解析 QQ 目标：${JSON.stringify(spec)}（示例：private:123456 / group:789012）`, 'BAD_TARGET')
  const kind = (match[1] ?? 'private').toLowerCase()
  const type = kind === 'group' || kind === 'g' ? 'group' : 'private'
  return { type, id: Number(match[2]) }
}

export function formatTarget(target) {
  return `${target.type}:${target.id}`
}

/** 从 OneBot 消息段/字符串里提取纯文本。 */
export function extractText(message) {
  if (typeof message === 'string') return cleanCq(message)
  if (!Array.isArray(message)) return ''
  const parts = []
  for (const segment of message) {
    if (!segment || typeof segment !== 'object') continue
    const data = segment.data ?? {}
    switch (segment.type) {
      case 'text':
        parts.push(String(data.text ?? ''))
        break
      case 'at':
        parts.push(`@${data.qq === 'all' ? '全体成员' : data.qq}`)
        break
      case 'image': {
        // sub_type=1 是表情包（商城表情同理），跟普通照片分开标，鱼才知道你在斗图。
        const isSticker = String(data.sub_type ?? '') === '1' || /表情|sticker/i.test(String(data.summary ?? ''))
        parts.push(isSticker ? '[表情包]' : '[图片]')
        break
      }
      case 'mface':
        parts.push('[表情包]')
        break
      case 'face':
        parts.push('[表情]')
        break
      case 'record':
        parts.push('[语音]')
        break
      case 'video':
        parts.push('[视频]')
        break
      case 'file':
        parts.push('[文件]')
        break
      case 'reply':
        break
      default:
        break
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}

/** 提取 OneBot 图片段的短期取图引用；不把 URL 写进对话文本。 */
export function extractImages(message) {
  if (typeof message === 'string') {
    const images = []
    for (const match of message.matchAll(/\[CQ:image,([^\]]+)\]/g)) {
      const fields = Object.fromEntries(match[1].split(',').map((part) => {
        const splitAt = part.indexOf('=')
        return splitAt < 0 ? [part, ''] : [part.slice(0, splitAt), part.slice(splitAt + 1)]
      }))
      const file = String(fields.file ?? '')
      const url = String(fields.url ?? '')
      if (file || url) images.push({ file, url, name: file })
    }
    return images.slice(0, 4)
  }
  if (!Array.isArray(message)) return []
  return message
    .filter((segment) => segment && (segment.type === 'image' || segment.type === 'mface'))
    .map((segment) => {
      const data = segment.data ?? {}
      return {
        file: typeof data.file === 'string' ? data.file : '',
        url: typeof data.url === 'string' ? data.url : '',
        name: typeof data.file === 'string' ? data.file : '',
      }
    })
    .filter((image) => image.file || image.url)
    .slice(0, 4)
}

function cleanCq(text) {
  return text
    .replace(/\[CQ:[^\]]+\]/g, (code) => {
      if (code.startsWith('[CQ:image')) return '[图片]'
      if (code.startsWith('[CQ:face')) return '[表情]'
      if (code.startsWith('[CQ:record')) return '[语音]'
      if (code.startsWith('[CQ:at,')) {
        const qq = /qq=([^,\]]+)/.exec(code)?.[1]
        return qq ? `@${qq}` : ''
      }
      return ''
    })
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&#44;/g, ',')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT)
}

/**
 * 把 OneBot 事件归一化为消息；非消息事件返回 undefined。
 * @param {any} event
 * @param {{selfId?: string|number}} options
 */
export function normalizeOneBotEvent(event, { selfId = '' } = {}) {
  if (!event || typeof event !== 'object') return undefined
  if (event.post_type !== 'message') return undefined
  const type = event.message_type === 'group' ? 'group' : event.message_type === 'private' ? 'private' : undefined
  if (!type) return undefined
  const botId = String(selfId || event.self_id || '')
  const userId = String(event.user_id ?? '')
  if (botId && userId === botId) return undefined
  const target =
    type === 'group'
      ? { type: 'group', id: Number(event.group_id) }
      : { type: 'private', id: Number(event.user_id) }
  if (!Number.isSafeInteger(target.id) || target.id <= 0) return undefined
  const text = extractText(event.message ?? event.raw_message ?? '')
  const images = extractImages(event.message)
  return {
    kind: 'message',
    target,
    targetKey: formatTarget(target),
    type,
    userId,
    nickname: String(event.sender?.card || event.sender?.nickname || userId),
    text,
    images,
    messageId: String(event.message_id ?? ''),
    time: Number(event.time) * 1000 || Date.now(),
    raw: event,
  }
}

function withToken(url, token) {
  if (!token) return url
  try {
    const parsed = new URL(url)
    if (!parsed.searchParams.has('access_token')) parsed.searchParams.set('access_token', token)
    return parsed.toString()
  } catch {
    return url
  }
}

export class OneBotClient extends EventEmitter {
  constructor({
    url,
    token = '',
    selfId = '',
    logger = undefined,
    WebSocketImpl = globalThis.WebSocket,
    reconnect = { minMs: 1000, maxMs: 30000 },
    heartbeatTimeoutMs = 150_000,
    requestTimeoutMs = 8000,
    connectTimeoutMs = 15000,
    inboxSize = 200,
  } = {}) {
    super()
    if (!WebSocketImpl) throw new OneBotError('当前运行时没有 WebSocket，请使用 Node 22+', 'NO_WEBSOCKET')
    this.url = url
    this.token = token
    this.selfId = String(selfId || '')
    this.logger = logger
    this.WebSocketImpl = WebSocketImpl
    this.reconnectMin = Math.max(50, reconnect?.minMs ?? 1000)
    this.reconnectMax = Math.max(this.reconnectMin, reconnect?.maxMs ?? 30000)
    this.heartbeatTimeoutMs = heartbeatTimeoutMs
    this.requestTimeoutMs = requestTimeoutMs
    this.connectTimeoutMs = connectTimeoutMs
    this.inboxSize = Math.max(10, inboxSize)

    this.state = 'idle'
    this.inbox = []
    this.pending = new Map()
    this.seen = new Set()
    this.attempts = 0
    this.closed = false
    this.ws = undefined
    this.lastEventAt = 0
    this.sawMeta = false
    this.connectedAt = 0
    this.reconnectTimer = undefined
    this.heartbeatTimer = undefined
    this.connectTimer = undefined
    this.stats = { received: 0, sent: 0, reconnects: 0, errors: 0 }
  }

  get status() {
    return {
      state: this.state,
      url: this.url,
      selfId: this.selfId,
      connectedAt: this.connectedAt,
      lastEventAt: this.lastEventAt,
      attempts: this.attempts,
      stats: { ...this.stats },
    }
  }

  start() {
    if (this.closed) return
    this.#connect()
  }

  async close() {
    this.closed = true
    this.state = 'closed'
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.connectTimer)
    clearInterval(this.heartbeatTimer)
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new OneBotError('连接已关闭', 'CLOSED'))
    }
    this.pending.clear()
    const ws = this.ws
    this.ws = undefined
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }

  #connect() {
    if (this.closed) return
    clearTimeout(this.reconnectTimer)
    this.state = 'connecting'
    let ws
    try {
      ws = new this.WebSocketImpl(withToken(this.url, this.token))
    } catch (error) {
      this.#fail(error)
      return
    }
    this.ws = ws
    this.connectTimer = setTimeout(() => {
      if (this.ws !== ws || this.state === 'connected') return
      this.logger?.warn?.('[dafeiyu] QQ 连接超时，准备重连')
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }, this.connectTimeoutMs)

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return
      clearTimeout(this.connectTimer)
      this.state = 'connected'
      this.connectedAt = Date.now()
      this.lastEventAt = Date.now()
      this.attempts = 0
      this.#startHeartbeat()
      this.logger?.info?.(`[dafeiyu] QQ 已连接：${this.url}`)
      this.emit('connected', this.status)
    })

    ws.addEventListener('message', (event) => {
      if (this.ws !== ws) return
      this.#handleRaw(event.data)
    })

    ws.addEventListener('error', (event) => {
      this.stats.errors += 1
      const message = event?.error?.message ?? event?.message ?? 'unknown'
      this.logger?.warn?.(`[dafeiyu] QQ WebSocket 错误：${message}`)
    })

    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return
      this.ws = undefined
      clearTimeout(this.connectTimer)
      clearInterval(this.heartbeatTimer)
      this.state = 'disconnected'
      this.emit('disconnected', { code: event?.code, reason: event?.reason })
      if (!this.closed) this.#scheduleReconnect()
    })
  }

  #fail(error) {
    this.stats.errors += 1
    this.state = 'disconnected'
    this.logger?.warn?.(`[dafeiyu] QQ 连接失败：${error?.message ?? error}`)
    if (!this.closed) this.#scheduleReconnect()
  }

  #scheduleReconnect() {
    clearTimeout(this.reconnectTimer)
    this.attempts += 1
    this.stats.reconnects += 1
    const base = Math.min(this.reconnectMax, this.reconnectMin * 2 ** Math.min(6, this.attempts - 1))
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    this.reconnectTimer = setTimeout(() => this.#connect(), delay)
    this.reconnectTimer.unref?.()
    if (this.logger?.debug) this.logger.debug(`[dafeiyu] QQ ${delay}ms 后重连（第 ${this.attempts} 次）`)
  }

  #startHeartbeat() {
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== 'connected') return
      if (!this.sawMeta) return
      if (Date.now() - this.lastEventAt > this.heartbeatTimeoutMs) {
        this.logger?.warn?.('[dafeiyu] QQ 心跳超时，主动断开重连')
        try {
          this.ws?.close()
        } catch {
          /* ignore */
        }
      }
    }, 30_000)
    this.heartbeatTimer.unref?.()
  }

  #handleRaw(raw) {
    let event
    try {
      event = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(Buffer.from(raw).toString('utf8'))
    } catch {
      this.logger?.warn?.('[dafeiyu] 收到无法解析的 OneBot 数据')
      return
    }
    if (!event || typeof event !== 'object') return
    this.lastEventAt = Date.now()

    if (event.post_type === 'meta_event') {
      this.sawMeta = true
      if (!this.selfId && event.self_id) this.selfId = String(event.self_id)
      this.emit('meta', event)
      return
    }

    if (event.post_type === 'message') {
      this.stats.received += 1
      if (!this.selfId && event.self_id) this.selfId = String(event.self_id)
      const messageId = String(event.message_id ?? '')
      if (messageId) {
        if (this.seen.has(messageId)) return
        this.seen.add(messageId)
        if (this.seen.size > 1000) {
          const first = this.seen.values().next().value
          this.seen.delete(first)
        }
      }
      const normalized = normalizeOneBotEvent(event, { selfId: this.selfId })
      if (!normalized) return
      this.#pushInbox(normalized)
      this.emit('message', normalized)
      return
    }

    if (event.post_type === 'notice' || event.post_type === 'request') {
      this.emit('notice', event)
      return
    }

    if (event.echo !== undefined && event.echo !== null) {
      const entry = this.pending.get(String(event.echo))
      if (!entry) return
      this.pending.delete(String(event.echo))
      clearTimeout(entry.timer)
      if (event.status === 'ok' || event.retcode === 0) entry.resolve(event)
      else entry.reject(new OneBotError(`OneBot 调用失败：${event.wording ?? event.message ?? event.retcode}`, 'CALL_FAILED'))
    }
  }

  #pushInbox(message) {
    this.inbox.push(message)
    while (this.inbox.length > this.inboxSize) this.inbox.shift()
    this.emit('inbox', message)
  }

  /** 最近收到的消息（旧 → 新）。 */
  recent(limit = 20) {
    const n = Math.max(1, Math.min(this.inboxSize, limit))
    return this.inbox.slice(-n)
  }

  clearInbox() {
    this.inbox.length = 0
  }

  /**
   * 发送文本消息。
   * @param {{type: 'private'|'group', id: number}|string} target
   * @param {string} text
   * @returns {Promise<any>} OneBot 响应
   */
  async send(target, text) {
    const parsed = typeof target === 'string' ? parseTarget(target) : target
    const content = String(text ?? '').trim()
    if (!content) throw new OneBotError('消息内容为空', 'EMPTY_MESSAGE')
    if (this.state !== 'connected' || !this.ws) throw new OneBotError('QQ 未连接', 'NOT_CONNECTED')
    const echo = randomUUID()
    const params = {
      message_type: parsed.type,
      message: [{ type: 'text', data: { text: content.slice(0, MAX_TEXT) } }],
      ...(parsed.type === 'group' ? { group_id: asId(parsed.id) } : { user_id: asId(parsed.id) }),
    }
    const response = await this.call('send_msg', params)
    this.stats.sent += 1
    return response
  }

  /**
   * 发送语音（record）。NapCat 会把 wav/mp3 转成 QQ 语音。
   * @param {{type:'private'|'group', id:number}|string} target
   * @param {string} filePath 本机绝对路径
   */
  async sendRecord(target, filePath) {
    const parsed = typeof target === 'string' ? parseTarget(target) : target
    if (this.state !== 'connected' || !this.ws) throw new OneBotError('QQ 未连接', 'NOT_CONNECTED')
    if (!fs.existsSync(filePath)) throw new OneBotError(`语音文件不存在：${filePath}`, 'NO_FILE')
    const params = {
      message_type: parsed.type,
      message: [{ type: 'record', data: { file: pathToFileURL(filePath).href } }],
      ...(parsed.type === 'group' ? { group_id: asId(parsed.id) } : { user_id: asId(parsed.id) }),
    }
    const response = await this.call('send_msg', params, 30_000)
    this.stats.sent += 1
    return response
  }

  /**
   * 发送图片/表情包。NapCat 支持本机绝对路径。
   * @param {{type:'private'|'group', id:number}|string} target
   * @param {string} filePath 本机绝对路径
   */
  async sendImage(target, filePath) {
    const parsed = typeof target === 'string' ? parseTarget(target) : target
    if (this.state !== 'connected' || !this.ws) throw new OneBotError('QQ 未连接', 'NOT_CONNECTED')
    if (!fs.existsSync(filePath)) throw new OneBotError(`表情包文件不存在：${filePath}`, 'NO_FILE')
    const params = {
      message_type: parsed.type,
      message: [{ type: 'image', data: { file: pathToFileURL(filePath).href } }],
      ...(parsed.type === 'group' ? { group_id: asId(parsed.id) } : { user_id: asId(parsed.id) }),
    }
    const response = await this.call('send_msg', params, 30_000)
    this.stats.sent += 1
    return response
  }

  /**
   * 调用任意 OneBot action（send_msg / set_friend_add_request 等）。
   * @param {string} action
   * @param {object} params
   * @param {number} [timeoutMs]
   */
  async call(action, params = {}, timeoutMs = this.requestTimeoutMs) {
    if (this.state !== 'connected' || !this.ws) throw new OneBotError('QQ 未连接', 'NOT_CONNECTED')
    const echo = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo)
        reject(new OneBotError(`调用 ${action} 超时（${timeoutMs}ms）`, 'TIMEOUT'))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(echo, { resolve, reject, timer })
      try {
        this.ws.send(JSON.stringify({ action, params, echo }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(echo)
        reject(new OneBotError(`调用 ${action} 失败：${error?.message ?? error}`, 'SEND_FAILED'))
      }
    })
  }
}
