/**
 * 大肥鱼（dsh-dafeiyu）—— DeepSeek Harness 插件入口。
 *
 * 1. 人格：把「大肥鱼」写进系统提示词，并注入实时心情 / 记忆 / QQ 状态。
 * 2. 记忆与心情：六个工具 + 本地 JSON 持久化。
 * 3. QQ 桥接：OneBot 11 正向 WebSocket，可选自动回复（每个联系人一个持久会话）。
 *
 * 零第三方依赖：只使用 Node 内置模块，便于在 Desktop 的 profile 里直接加载。
 */
import path from 'node:path'
import fs from 'node:fs'
import { resolveConfig, validateConfig } from './config.js'
import { ensureDir, JsonStore, resolveDataDir } from './store.js'
import { decayMood, defaultMood, moodSnapshot } from './mood.js'
import { MemoryBook } from './memory.js'
import { OneBotClient, normalizeOneBotEvent } from './qq.js'
import { registerPersona } from './persona.js'
import { createTools } from './tools.js'
import { createAutoReplier } from './auto-reply.js'
import { LifeScheduler } from './life.js'
import { DailyScheduler, GreetingScheduler, writeDailyDiary, dayKey } from './daily.js'
import { pruneVoices } from './tts.js'
import { StickerBox } from './stickers.js'

export const name = 'dafeiyu'

/** 需要工具注册表与 agent 工厂（QQ 自动回复要用 ctx.agents）。 */
export const inject = ['tools', 'agents', 'attachments']

function defaultState() {
  return {
    version: 1,
    mood: defaultMood(),
    createdAt: Date.now(),
    totalMessages: 0,
  }
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

function normalizeState(state) {
  const base = defaultState()
  if (!state || typeof state !== 'object') return base
  const mood = state.mood && typeof state.mood === 'object' ? { ...base.mood, ...state.mood } : base.mood
  return {
    ...base,
    ...state,
    mood: {
      ...base.mood,
      ...mood,
      energy: clamp01(mood.energy),
      satiety: clamp01(mood.satiety),
      affection: clamp01(mood.affection),
      chats: Number.isFinite(mood.chats) ? mood.chats : 0,
      updatedAt: Number.isFinite(mood.updatedAt) ? mood.updatedAt : Date.now(),
    },
  }
}

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const issues = validateConfig(config)
  for (const issue of issues) ctx.logger?.warn?.(`[dafeiyu] 配置问题：${issue}`)
  if (config.qq.enabled && issues.some((issue) => issue.includes('wsUrl'))) {
    throw new Error(`[dafeiyu] 配置无效：${issues.join('；')}`)
  }

  const dataDir = resolveDataDir(config.dataDir)
  ensureDir(dataDir)

  const stateStore = new JsonStore(path.join(dataDir, 'state.json'), defaultState)
  stateStore.load()
  stateStore.data = normalizeState(stateStore.data)
  stateStore.save()

  const memory = new MemoryBook(path.join(dataDir, 'memory.json'), { maxItems: config.memory.maxItems })

  const now = () => Date.now()
  const readMood = () => decayMood(stateStore.data.mood, now(), config.mood)
  const snapshot = () => moodSnapshot(readMood(), now())
  const updateMood = (mutator) => {
    stateStore.update((state) => {
      const next = normalizeState(state)
      next.mood = mutator(decayMood(next.mood, now(), config.mood))
      return next
    })
    return snapshot()
  }

  let bridge = null
  let replier = null
  let life = null
  let daily = null
  let greetings = null
  let stickerBox = null
  let unread = 0
  let allowedCount = 0

  const allowMessage = (message) => {
    if (message.type === 'group') return config.qq.allowedGroups.map(String).includes(String(message.target.id))
    const users = config.qq.allowedUsers.map(String)
    return users.length === 0 || users.includes(String(message.userId))
  }

  const qqLogFile = path.join(dataDir, 'qq.log')
  const qqLog = (level, message, error) => {
    try {
      const extra = error ? ` :: ${String(error?.stack ?? error)}` : ''
      fs.appendFileSync(qqLogFile, `[${new Date().toISOString()}] ${level} ${message}${extra}\n`)
    } catch {
      /* ignore */
    }
  }

  if (config.qq.enabled) {
    bridge = new OneBotClient({
      url: config.qq.wsUrl,
      token: config.qq.accessToken,
      selfId: config.qq.selfId,
      logger: ctx.logger,
      reconnect: config.qq.reconnect,
      inboxSize: config.qq.inboxSize,
    })

    const markSeen = (message) => {
      if (!message?.targetKey || !Number.isFinite(message.time)) return
      stateStore.update((state) => {
        const next = normalizeState(state)
        const seen = next.qqSeen ?? {}
        seen[message.targetKey] = Math.max(seen[message.targetKey] ?? 0, message.time)
        next.qqSeen = seen
        return next
      })
    }

    const catchUp = async () => {
      if (!replier) return
      const catchUpConfig = config.qq.catchUp
      if (!catchUpConfig?.enabled) return
      const seen = stateStore.data.qqSeen ?? {}
      const ids = [...new Set([...(config.qq.autoReply.ownerIds ?? []), ...config.qq.allowedUsers].map(String))].filter(Boolean)
      for (const id of ids) {
        const key = `private:${id}`
        try {
          const response = await bridge.call('get_friend_msg_history', { user_id: Number(id), count: catchUpConfig.count }, 15_000)
          const messages = Array.isArray(response?.data?.messages) ? response.data.messages : []
          const floor = seen[key] ?? Date.now() - 30 * 60_000
          const oldest = Date.now() - Math.max(1, catchUpConfig.maxAgeHours) * 3_600_000
          let handled = 0
          for (const raw of messages) {
            if (handled >= catchUpConfig.maxPerContact) break
            const event = normalizeOneBotEvent({ ...raw, post_type: 'message', message_type: 'private' }, { selfId: bridge.selfId })
            if (!event) continue
            if (event.time <= floor || event.time < oldest) continue
            await replier.handleIncoming(event)
            markSeen(event)
            handled += 1
            qqLog('info', `catch-up ${key} ${event.time}: ${event.text.slice(0, 40)}`)
          }
        } catch (error) {
          qqLog('error', `catch-up failed ${key}`, error)
        }
      }
    }

    bridge.on('message', (message) => {
      if (!allowMessage(message)) return
      markSeen(message)
      unread += 1
      allowedCount += 1
      stateStore.update((state) => ({ ...normalizeState(state), totalMessages: (state.totalMessages ?? 0) + 1 }))
      qqLog('info', `inbound ${message.targetKey} len=${message.text.length}`)
      if (replier) {
        replier.handleIncoming(message).catch((error) => {
          ctx.logger?.warn?.(`[dafeiyu] QQ 自动回复失败：${error?.message ?? error}`)
          qqLog('error', 'handleIncoming failed', error)
        })
      }
    })

    let lastDisconnectAt = 0
    let lastOfflineNoticeAt = 0

    bridge.on('disconnected', (info) => {
      lastDisconnectAt = Date.now()
      qqLog('warn', `bridge disconnected code=${info?.code ?? ''} reason=${info?.reason ?? ''}`)
    })

    bridge.on('connected', (status) => {
      ctx.logger?.info?.(`[dafeiyu] QQ 桥接就绪（${status.url}）`)
      qqLog('info', `bridge connected ${status.url}`)
      const notice = config.qq.offlineNotice
      const downtime = lastDisconnectAt ? Date.now() - lastDisconnectAt : 0
      lastDisconnectAt = 0
      if (notice.enabled && downtime >= 20_000 && Array.isArray(notice.targets) && notice.targets.length > 0) {
        if (Date.now() - lastOfflineNoticeAt >= Math.max(1, notice.minIntervalMinutes) * 60_000) {
          lastOfflineNoticeAt = Date.now()
          for (const target of notice.targets) {
            bridge
              .send(target, notice.text)
              .then(() => qqLog('info', `offline notice sent -> ${target} after ${Math.round(downtime / 1000)}s`))
              .catch((error) => qqLog('error', `offline notice failed -> ${target}`, error))
          }
        }
      }
      if (config.qq.catchUp?.enabled) {
        setTimeout(() => {
          catchUp().catch((error) => qqLog('error', 'catch-up crashed', error))
        }, 1500)
      }
    })

    // 白名单里的好友申请自动通过，省得主人还要上小号点同意。
    bridge.on('notice', (event) => {
      if (event?.post_type !== 'request' || event.request_type !== 'friend') return
      const userId = String(event.user_id ?? '')
      const allowed = config.qq.allowedUsers.map(String)
      if (!allowed.includes(userId)) {
        qqLog('info', `friend request ignored from ${userId}`)
        return
      }
      bridge
        .call('set_friend_add_request', { flag: event.flag, approve: true })
        .then(() => {
          qqLog('info', `friend request approved ${userId}`)
          ctx.logger?.info?.(`[dafeiyu] 已自动通过好友申请：${userId}`)
        })
        .catch((error) => qqLog('error', `approve friend failed ${userId}`, error))
    })

    if (config.qq.autoReply.enabled) {
      replier = createAutoReplier({
        ctx,
        config,
        bridge,
        attachments: ctx.attachments,
        logger: ctx.logger,
        log: qqLog,
        getStickers: () => stickerBox,
      })
    }

    bridge.start()

    if (config.life.enabled) {
      life = new LifeScheduler({ config, bridge, logger: ctx.logger, log: qqLog })
      life.start()
    }

    if (config.daily.enabled) {
      daily = new DailyScheduler({ config, bridge, logger: ctx.logger, log: qqLog })
      daily.start()
    }

    if (config.greetings.enabled) {
      greetings = new GreetingScheduler({ config, bridge, logger: ctx.logger, log: qqLog })
      greetings.start()
    }
  }

  const qqAdapter = bridge
    ? {
        status: () => bridge.status,
        recent: (limit) => bridge.recent(limit),
        send: (target, text) => bridge.send(target, text),
        sendRecord: (target, file) => bridge.sendRecord(target, file),
        sendImage: (target, file) => bridge.sendImage(target, file),
        call: (action, params) => bridge.call(action, params),
        clearInbox: () => {
          bridge.clearInbox()
          unread = 0
        },
        unread: () => unread,
      }
    : null

  registerPersona(ctx, {
    config,
    getSnapshot: snapshot,
    memory,
    getQqState: () => (bridge ? { connected: bridge.status.state === 'connected', unread } : null),
  })

  const voiceDir = config.tts.dir || path.join(dataDir, 'voice')
  try {
    pruneVoices(voiceDir, 30)
  } catch {
    /* ignore */
  }

  if (config.stickers.enabled) {
    const stickerDir = config.stickers.dir || path.join(dataDir, 'stickers')
    stickerBox = new StickerBox({ dir: stickerDir, logger: ctx.logger })
    stickerBox.ensure()
  }

  const tools = createTools({
    config,
    memory,
    getMood: readMood,
    updateMood,
    snapshot,
    qq: qqAdapter,
    now,
    tts: { voice: config.tts.voice, rate: config.tts.rate, pitch: config.tts.pitch, dir: voiceDir },
    resolveTarget: (sessionId) => replier?.targetForSession?.(sessionId),
    markVoice: (sessionId) => replier?.markVoiceSent?.(sessionId),
    stickers: stickerBox,
  })

  const disposers = []
  const registered = []
  const failed = []
  for (const tool of tools) {
    try {
      disposers.push(ctx.tools.register(tool))
      registered.push(tool.name)
    } catch (error) {
      failed.push({ name: tool.name, error: String(error?.message ?? error) })
      ctx.logger?.error?.(`[dafeiyu] 工具 ${tool.name} 注册失败：${error?.message ?? error}`)
    }
  }

  if (config.mood.tickSeconds > 0) {
    const timer = setInterval(() => {
      stateStore.update((state) => ({ ...normalizeState(state), mood: decayMood(state.mood, now(), config.mood) }))
    }, config.mood.tickSeconds * 1000)
    timer.unref?.()
    disposers.push(() => clearInterval(timer))
  }

  if (config.memory.retention?.enabled) {
    const retention = config.memory.retention
    const sweep = () => {
      try {
        const removed = memory.forgetOld({
          now: now(),
          maxAgeDays: retention.maxAgeDays,
          keepImportance: retention.keepImportance,
          keepTags: retention.keepTags,
        })
        if (removed > 0) {
          qqLog('info', `retention swept ${removed} memories, ${memory.count()} left`)
          ctx.logger?.info?.(`[dafeiyu] 周期遗忘：忘掉 ${removed} 条琐事，保留 ${memory.count()} 条`)
        }
      } catch (error) {
        ctx.logger?.warn?.(`[dafeiyu] 记忆清理失败：${error?.message ?? error}`)
      }
    }
    sweep()
    const timer = setInterval(sweep, Math.max(1, retention.sweepHours) * 3_600_000)
    timer.unref?.()
    disposers.push(() => clearInterval(timer))
  }

  const diaryDir = config.daily.diaryDir || path.join(dataDir, 'diary')
  if (config.daily.enabled) {
    const maybeDiary = () => {
      try {
        const current = new Date()
        if (current.getHours() !== config.daily.diaryHour) return
        const key = dayKey(current)
        if (stateStore.data.lastDiary === key) return
        const start = new Date(current)
        start.setHours(0, 0, 0, 0)
        const todays = memory.items.filter((item) => (item.ts ?? 0) >= start.getTime())
        const file = writeDailyDiary(diaryDir, {
          date: current,
          mood: snapshot(),
          memories: todays,
          sent: daily?.sentToday ?? 0,
          received: allowedCount,
        })
        stateStore.update((state) => ({ ...normalizeState(state), lastDiary: key }))
        qqLog('info', `diary written ${key} -> ${file}`)
        ctx.logger?.info?.(`[dafeiyu] 日记写好了：${file}`)
      } catch (error) {
        ctx.logger?.warn?.(`[dafeiyu] 写日记失败：${error?.message ?? error}`)
      }
    }
    maybeDiary()
    const timer = setInterval(maybeDiary, 10 * 60_000)
    timer.unref?.()
    disposers.push(() => clearInterval(timer))
  }

  try {
    fs.writeFileSync(
      path.join(dataDir, 'last-boot.json'),
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          code: 5,
          persona: config.persona.enabled,
          tools: registered,
          failed,
          memory: memory.count(),
          qq: bridge ? { url: config.qq.wsUrl, autoReply: config.qq.autoReply.enabled } : null,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  } catch (error) {
    ctx.logger?.warn?.(`[dafeiyu] 写启动报告失败：${error?.message ?? error}`)
  }

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose?.()
      } catch {
        /* ignore */
      }
    }
    try {
      life?.stop()
    } catch {
      /* ignore */
    }
    try {
      daily?.stop()
    } catch {
      /* ignore */
    }
    try {
      greetings?.stop()
    } catch {
      /* ignore */
    }
    try {
      replier?.dispose()
    } catch {
      /* ignore */
    }
    if (bridge) bridge.close().catch(() => {})
  })

  ctx.logger?.info?.(
    `[dafeiyu] 大肥鱼已醒：${tools.length} 个工具，记忆 ${memory.count()} 条，数据目录 ${dataDir}` +
      (bridge ? `，QQ ${config.qq.autoReply.enabled ? '自动回复开启' : '仅收不发'}（${config.qq.wsUrl}）` : '，QQ 未启用'),
  )
}

export { defaultState }
