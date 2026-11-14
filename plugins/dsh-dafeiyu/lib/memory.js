/**
 * 大肥鱼的长期记忆：JSON 数组 + 中文二元组关键词召回。
 * 不依赖向量模型，离线可用；排序 = 关键词重合 × 重要度 + 新近度。
 */
import { randomUUID } from 'node:crypto'
import { JsonStore } from './store.js'

const CJK = /[\u3400-\u9fff]/
const MAX_TEXT = 2000

export function tokenize(text) {
  const lower = String(text ?? '').toLowerCase()
  const tokens = new Set()
  for (const match of lower.matchAll(/[a-z0-9_]{2,}/g)) tokens.add(match[0])
  for (const run of lower.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length === 1) tokens.add(run)
    for (let i = 0; i + 1 < run.length; i += 1) tokens.add(run.slice(i, i + 2))
  }
  return tokens
}

function clampImportance(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, Math.round(n)))
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 8)
}

export function scoreMemory(item, queryTokens, queryText, { now = Date.now(), contact = '' } = {}) {
  if (!item || typeof item.text !== 'string') return 0
  const itemTokens = tokenize(`${item.text} ${(item.tags ?? []).join(' ')}`)
  let overlap = 0
  for (const token of queryTokens) if (itemTokens.has(token)) overlap += 1
  const phrase = queryText && item.text.toLowerCase().includes(queryText.toLowerCase())
  if (overlap === 0 && !phrase) return 0
  const base = overlap / Math.sqrt(Math.max(1, itemTokens.size))
  const importance = 0.75 + (clampImportance(item.importance) - 3) * 0.12
  const ageDays = Math.max(0, now - (item.ts ?? now)) / 86_400_000
  const recency = Math.exp(-ageDays / 45)
  const contactBoost = contact && item.contact === contact ? 0.15 : 0
  return base * importance + recency * 0.35 + (phrase ? 0.25 : 0) + contactBoost
}

export class MemoryBook {
  /**
   * @param {string} file
   * @param {{maxItems?: number}} options
   */
  constructor(file, { maxItems = 5000 } = {}) {
    this.maxItems = Math.max(10, maxItems)
    this.store = new JsonStore(file, () => ({ version: 1, items: [] }))
  }

  load() {
    const data = this.store.load()
    if (!data || !Array.isArray(data.items)) {
      this.store.data = { version: 1, items: [] }
      this.store.save()
    }
    return this.store.data
  }

  get items() {
    return this.load().items
  }

  add({ text, tags = [], importance = 3, source = 'manual', contact = '', now = Date.now() } = {}) {
    const clean = String(text ?? '').trim().slice(0, MAX_TEXT)
    if (!clean) throw new Error('记忆内容不能为空')
    const normalizedTags = normalizeTags(tags)
    const existing = this.items.find((item) => item.text === clean)
    if (existing) {
      existing.ts = now
      existing.importance = Math.max(clampImportance(existing.importance), clampImportance(importance))
      existing.tags = [...new Set([...(existing.tags ?? []), ...normalizedTags])].slice(0, 8)
      this.store.save()
      return existing
    }
    const item = {
      id: randomUUID(),
      text: clean,
      tags: normalizedTags,
      importance: clampImportance(importance),
      source: String(source).slice(0, 32),
      contact: contact ? String(contact).slice(0, 64) : '',
      ts: now,
    }
    const data = this.load()
    data.items.push(item)
    this.prune(data, now)
    this.store.save()
    return item
  }

  prune(data, now = Date.now()) {
    if (data.items.length <= this.maxItems) return
    const scored = data.items.map((item) => ({
      item,
      score:
        clampImportance(item.importance) * 2 +
        Math.exp(-Math.max(0, now - (item.ts ?? now)) / (30 * 86_400_000)) * 3,
    }))
    scored.sort((a, b) => b.score - a.score)
    data.items = scored.slice(0, this.maxItems).map((entry) => entry.item)
  }

  recall(query, { limit = 6, contact = '', now = Date.now(), minScore = 0.05 } = {}) {
    const queryText = String(query ?? '').trim()
    if (!queryText) return []
    const queryTokens = tokenize(queryText)
    return this.items
      .map((item) => ({ item, score: scoreMemory(item, queryTokens, queryText, { now, contact }) }))
      .filter((entry) => entry.score >= minScore)
      .sort((a, b) => b.score - a.score || (b.item.ts ?? 0) - (a.item.ts ?? 0))
      .slice(0, Math.max(1, limit))
      .map((entry) => ({ ...entry.item, score: Number(entry.score.toFixed(4)) }))
  }

  recent(limit = 5) {
    return [...this.items]
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
      .slice(0, Math.max(0, limit))
  }

  /**
   * 周期性遗忘：超过 maxAgeDays 的旧记忆，只保留重要度高或带保护标签的。
   * @returns {number} 被忘掉的条数
   */
  forgetOld({ now = Date.now(), maxAgeDays = 90, keepImportance = 4, keepTags = [] } = {}) {
    if (!(maxAgeDays > 0)) return 0
    const cutoff = now - maxAgeDays * 86_400_000
    const keep = new Set(keepTags.map(String))
    const data = this.load()
    const before = data.items.length
    data.items = data.items.filter((item) => {
      if ((item.ts ?? 0) >= cutoff) return true
      if ((item.importance ?? 3) >= keepImportance) return true
      if ((item.tags ?? []).some((tag) => keep.has(String(tag)))) return true
      return false
    })
    const removed = before - data.items.length
    if (removed > 0) this.store.save()
    return removed
  }

  count() {
    return this.items.length
  }
}
