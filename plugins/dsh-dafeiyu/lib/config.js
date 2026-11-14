/**
 * 大肥鱼配置：默认值、深合并与校验。
 * 不依赖任何第三方包，Cordis 直接把原始 config 传进来。
 */

export const DEFAULT_CONFIG = {
  dataDir: '',
  persona: {
    enabled: true,
    name: '大肥鱼',
    extra: '',
    /** 状态段注入到系统提示词中的位置；留空使用插件默认顺序。 */
    order: 0,
  },
  mood: {
    /** 每小时自然衰减。 */
    energyDecayPerHour: 1.5,
    satietyDecayPerHour: 2.5,
    /** 后台衰减计时器间隔（秒）；0 表示不启动计时器，只在读取时惰性衰减。 */
    tickSeconds: 300,
  },
  memory: {
    maxItems: 5000,
    recallLimit: 6,
    /** 新记忆默认重要度 1..5。 */
    defaultImportance: 3,
    /** 周期遗忘：旧的琐事忘掉，重要设定保留。 */
    retention: {
      enabled: false,
      maxAgeDays: 90,
      keepImportance: 4,
      keepTags: ['设定', '约定', '偏好', '重要'],
      sweepHours: 12,
    },
  },
  qq: {
    enabled: false,
    wsUrl: 'ws://127.0.0.1:3001',
    accessToken: '',
    /** 机器人自己的 QQ 号；留空则用事件里的 self_id 自动学习。 */
    selfId: '',
    /** 空数组 = 不限制私聊对象（但仍需 autoReply 才自动回复）。 */
    allowedUsers: [],
    /** 空数组 = 不处理任何群消息，必须显式列出群号。 */
    allowedGroups: [],
    /** 最近消息环形缓冲大小。 */
    inboxSize: 200,
    reconnect: {
      minMs: 1000,
      maxMs: 30000,
    },
    /** 掉线后重新连上时，主动告诉主人一声。 */
    offlineNotice: {
      enabled: true,
      targets: [],
      text: '刚才掉线了一下 现在回来了',
      minIntervalMinutes: 10,
    },
    /** 重连后补看离线期间的消息并回复。 */
    catchUp: {
      enabled: true,
      count: 20,
      maxAgeHours: 24,
      maxPerContact: 10,
    },
    autoReply: {
      enabled: false,
      provider: '',
      model: '',
      /** 每个联系人排队等待 agent 空闲的消息上限。 */
      maxPending: 20,
      /** 单次回复等待上限（秒），超时则放弃本轮。 */
      turnTimeoutSeconds: 180,
      /** 这些 QQ 号视为主人：不受工具白名单限制。 */
      ownerIds: [],
      /** 非主人的工具白名单；'all' 表示不限制。 */
      tools: [],
      /** 把一条回复拆成多条“微信气泡”发出。 */
      bubbles: {
        enabled: true,
        max: 4,
        randomGroup: true,
        minDelayMs: 250,
        maxDelayMs: 900,
        firstDelayMinMs: 400,
        firstDelayMaxMs: 1800,
        /** 随机插一个单独的骂人/嘟囔词。 */
        insultChance: 0.25,
        insults: ['笨蛋', '蠢', '烦', '讨厌', '哼', '气死', '傻鱼'],
      },
    },
    vision: {
      /** 自动识图只处理主人发来的图片，避免把群友图片转发给视觉模型。 */
      enabled: true,
      ownerOnly: true,
      maxImages: 4,
    },
  },
  /** 鱼鱼日常：不定时主动冒泡（不调用模型）。 */
  life: {
    enabled: false,
    minMinutes: 90,
    maxMinutes: 240,
    quietHours: { start: '23:30', end: '08:30' },
    /** 发送目标，如 ['private:<QQ号>']。 */
    targets: [],
    /** 可覆盖某个时段的模板：{ morning: [...], afternoon: [...] }。 */
    templates: {},
  },
  /** 语音合成（edge-tts 优先，SAPI 兜底）。 */
  tts: {
    voice: 'zh-CN-XiaoyiNeural',
    rate: '+0%',
    pitch: '+0Hz',
    /** 留空 = <dataDir>/voice。 */
    dir: '',
  },
  /** 每天随机发消息 + 每天写日记。 */
  daily: {
    enabled: false,
    messagesPerDay: 10,
    startHour: 9,
    endHour: 23,
    /** 发送目标，如 ['private:<QQ号>']。 */
    targets: [],
    /** 每天几点写日记。 */
    diaryHour: 23,
    /** 留空 = <dataDir>/diary。 */
    diaryDir: '',
  },
  /** 早安 / 晚安闹钟。 */
  greetings: {
    enabled: false,
    targets: [],
    morning: { enabled: true, time: '07:30' },
    night: { enabled: true, time: '22:30' },
  },
  /** 表情包盒子：把图片丢进目录，鱼就能挑着发。文件名里的词就是标签。 */
  stickers: {
    enabled: true,
    /** 留空 = <dataDir>/stickers。 */
    dir: '',
    /** 回复时顺手带一张的概率；0 表示只在鱼主动想发的时候发。 */
    chance: 0.25,
  },
}

function isPlainObject(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

/** 深合并：数组整体替换，undefined 视为未提供。 */
export function mergeConfig(base, patch) {
  if (!isPlainObject(patch)) return clone(base)
  const out = clone(base)
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeConfig(out[key], value)
    else out[key] = clone(value)
  }
  return out
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (isPlainObject(value)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = clone(v)
    return out
  }
  return value
}

export function resolveConfig(raw) {
  return mergeConfig(DEFAULT_CONFIG, raw ?? {})
}

function asPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** 返回人类可读的问题列表；空数组表示配置可用。 */
export function validateConfig(config) {
  const issues = []
  if (!isPlainObject(config)) return ['config 必须是一个对象']
  if (!asPositiveNumber(config.memory?.maxItems)) issues.push('memory.maxItems 必须是正数')
  if (!asPositiveNumber(config.memory?.recallLimit)) issues.push('memory.recallLimit 必须是正数')
  const retention = config.memory?.retention
  if (retention?.enabled) {
    if (!asPositiveNumber(retention.maxAgeDays)) issues.push('memory.retention.maxAgeDays 必须是正数')
    if (!asPositiveNumber(retention.keepImportance)) issues.push('memory.retention.keepImportance 必须是正数')
    if (!Array.isArray(retention.keepTags)) issues.push('memory.retention.keepTags 必须是数组')
    if (!asPositiveNumber(retention.sweepHours)) issues.push('memory.retention.sweepHours 必须是正数')
  }
  if (!asPositiveNumber(config.mood?.tickSeconds) && config.mood?.tickSeconds !== 0)
    issues.push('mood.tickSeconds 必须是 >= 0 的数字')
  if (config.qq?.enabled) {
    if (typeof config.qq.wsUrl !== 'string' || !/^wss?:\/\//.test(config.qq.wsUrl))
      issues.push('qq.wsUrl 必须是 ws:// 或 wss:// 地址')
    if (!Array.isArray(config.qq.allowedUsers)) issues.push('qq.allowedUsers 必须是数组')
    if (!Array.isArray(config.qq.allowedGroups)) issues.push('qq.allowedGroups 必须是数组')
    if (config.qq.offlineNotice?.enabled) {
      if (!Array.isArray(config.qq.offlineNotice.targets)) issues.push('qq.offlineNotice.targets 必须是数组')
      if (!asPositiveNumber(config.qq.offlineNotice.minIntervalMinutes))
        issues.push('qq.offlineNotice.minIntervalMinutes 必须是正数')
    }
    if (config.qq.catchUp?.enabled) {
      if (!asPositiveNumber(config.qq.catchUp.count)) issues.push('qq.catchUp.count 必须是正数')
      if (!asPositiveNumber(config.qq.catchUp.maxAgeHours)) issues.push('qq.catchUp.maxAgeHours 必须是正数')
      if (!asPositiveNumber(config.qq.catchUp.maxPerContact)) issues.push('qq.catchUp.maxPerContact 必须是正数')
    }
    if (config.qq.autoReply?.enabled) {
      const { provider, model } = config.qq.autoReply
      if (Boolean(provider) !== Boolean(model))
        issues.push('qq.autoReply.provider 与 qq.autoReply.model 必须同时提供或同时留空')
      if (config.qq.autoReply.ownerIds !== undefined && !Array.isArray(config.qq.autoReply.ownerIds))
        issues.push('qq.autoReply.ownerIds 必须是数组')
      const tools = config.qq.autoReply.tools
      if (tools !== undefined && tools !== 'all' && !Array.isArray(tools))
        issues.push("qq.autoReply.tools 必须是数组或 'all'")
    }
  }
  if (config.life?.enabled) {
    if (!config.qq?.enabled) issues.push('life.enabled 需要 qq.enabled 同时开启')
    if (!Array.isArray(config.life.targets) || config.life.targets.length === 0)
      issues.push('life.targets 至少配置一个目标，例如 private:<QQ号>')
    const min = config.life.minMinutes
    const max = config.life.maxMinutes
    if (!asPositiveNumber(min) || !asPositiveNumber(max) || max < min)
      issues.push('life.minMinutes / maxMinutes 必须是正数且 max >= min')
  }
  if (config.tts !== undefined && !isPlainObject(config.tts)) issues.push('tts 必须是对象')
  if (config.daily?.enabled) {
    if (!config.qq?.enabled) issues.push('daily.enabled 需要 qq.enabled 同时开启')
    if (!Array.isArray(config.daily.targets) || config.daily.targets.length === 0)
      issues.push('daily.targets 至少配置一个目标')
    if (!asPositiveNumber(config.daily.messagesPerDay)) issues.push('daily.messagesPerDay 必须是正数')
    const diaryHour = config.daily.diaryHour
    if (!Number.isInteger(diaryHour) || diaryHour < 0 || diaryHour > 23) issues.push('daily.diaryHour 必须是 0-23 的整数')
  }
  if (config.greetings?.enabled) {
    if (!config.qq?.enabled) issues.push('greetings.enabled 需要 qq.enabled 同时开启')
    if (!Array.isArray(config.greetings.targets) || config.greetings.targets.length === 0)
      issues.push('greetings.targets 至少配置一个目标')
    for (const slot of ['morning', 'night']) {
      const item = config.greetings[slot]
      if (item?.enabled === false) continue
      if (!/^\d{1,2}:\d{2}$/.test(String(item?.time ?? ''))) issues.push(`greetings.${slot}.time 必须是 HH:MM`)
    }
  }
  return issues
}
