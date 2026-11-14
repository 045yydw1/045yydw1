/**
 * 大肥鱼的心情引擎：精力/饱腹/好感三项数值 + 显式心情，随时间自然衰减。
 * 纯函数式设计，方便单元测试；持久化由调用方负责。
 */

export const MOODS = {
  calm: { label: '平静', emoji: '🐋' },
  happy: { label: '开心', emoji: '😊' },
  excited: { label: '兴奋', emoji: '✨' },
  sleepy: { label: '困', emoji: '😴' },
  hungry: { label: '饿', emoji: '🍤' },
  emo: { label: '低落', emoji: '🌧️' },
  sulk: { label: '生气', emoji: '😤' },
}

export const MOOD_KEYS = Object.keys(MOODS)

export function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function defaultMood(now = Date.now()) {
  return {
    key: 'calm',
    /** 显式心情过期后回到的基线心情。 */
    baseKey: 'calm',
    /** 显式心情的保持截止时间；到期后由数值决定。 */
    keyUntil: 0,
    energy: 72,
    satiety: 66,
    affection: 50,
    note: '',
    updatedAt: now,
    chats: 0,
  }
}

/** 读取时惰性衰减：按经过的小时数扣精力与饱腹。 */
export function decayMood(mood, now, config = {}) {
  const energyRate = Number.isFinite(config.energyDecayPerHour) ? config.energyDecayPerHour : 1.5
  const satietyRate = Number.isFinite(config.satietyDecayPerHour) ? config.satietyDecayPerHour : 2.5
  const last = Number.isFinite(mood.updatedAt) ? mood.updatedAt : now
  const hours = Math.max(0, (now - last) / 3_600_000)
  if (hours <= 0) return { ...mood }
  return {
    ...mood,
    energy: clamp(mood.energy - hours * energyRate),
    satiety: clamp(mood.satiety - hours * satietyRate),
    updatedAt: now,
  }
}

/** 实际展示的心情：显式心情未过期就用它，否则看数值阈值。 */
export function effectiveMoodKey(mood, now = Date.now()) {
  if (mood.keyUntil && now < mood.keyUntil && MOODS[mood.key]) return mood.key
  if (mood.satiety < 15) return 'hungry'
  if (mood.energy < 15) return 'sleepy'
  if (mood.energy > 88 && mood.affection > 70) return 'excited'
  if (mood.affection < 20) return 'emo'
  return MOODS[mood.baseKey] ? mood.baseKey : 'calm'
}

const INTERACTIONS = {
  chat: { affection: 1, energy: -0.6, satiety: -0.3, chats: 1 },
  praise: { affection: 4, energy: 1, satiety: 0, key: 'happy', holdMinutes: 120 },
  scold: { affection: -6, energy: -2, satiety: 0, key: 'sulk', holdMinutes: 60 },
  feed: { affection: 2, energy: 4, satiety: 28, key: 'happy', holdMinutes: 60 },
  pet: { affection: 3, energy: 0, satiety: 0, key: 'happy', holdMinutes: 60 },
  play: { affection: 2, energy: -6, satiety: -2, key: 'excited', holdMinutes: 30 },
  sleep: { affection: 0, energy: 45, satiety: -2, key: 'calm', holdMinutes: 60 },
}

/**
 * 应用一次互动。
 * @param {object} mood
 * @param {keyof INTERACTIONS|string} kind
 * @param {number} now
 */
export function applyInteraction(mood, kind, now = Date.now()) {
  const rule = INTERACTIONS[kind]
  if (!rule) throw new Error(`unknown interaction: ${kind}`)
  const next = {
    ...mood,
    energy: clamp(mood.energy + (rule.energy ?? 0)),
    satiety: clamp(mood.satiety + (rule.satiety ?? 0)),
    affection: clamp(mood.affection + (rule.affection ?? 0)),
    chats: mood.chats + (rule.chats ?? 0),
    updatedAt: now,
  }
  if (rule.key) {
    next.key = rule.key
    next.keyUntil = now + (rule.holdMinutes ?? 60) * 60_000
  }
  return next
}

export function setMood(mood, key, { reason = '', holdMinutes = 120, now = Date.now() } = {}) {
  if (!MOODS[key]) throw new Error(`unknown mood: ${key} (expected ${MOOD_KEYS.join(', ')})`)
  return {
    ...mood,
    key,
    keyUntil: now + holdMinutes * 60_000,
    note: reason ? String(reason).slice(0, 200) : mood.note,
    updatedAt: now,
  }
}

/** 根据本机时间给一句生活化描述（用于系统提示词）。 */
export function timeOfDay(now = new Date()) {
  const hour = now.getHours()
  if (hour < 5) return '凌晨'
  if (hour < 9) return '清晨'
  if (hour < 12) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  if (hour < 23) return '晚上'
  return '深夜'
}

export function describeMood(mood, now = Date.now()) {
  const key = effectiveMoodKey(mood, now)
  const meta = MOODS[key]
  return `${meta.emoji} ${meta.label}`
}

export function moodSnapshot(mood, now = Date.now()) {
  const key = effectiveMoodKey(mood, now)
  return {
    key,
    label: MOODS[key].label,
    emoji: MOODS[key].emoji,
    energy: Math.round(mood.energy),
    satiety: Math.round(mood.satiety),
    affection: Math.round(mood.affection),
    note: mood.note || '',
    chats: mood.chats ?? 0,
    timeOfDay: timeOfDay(new Date(now)),
  }
}
