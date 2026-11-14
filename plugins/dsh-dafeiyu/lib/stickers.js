/**
 * 表情包盒子：本地文件夹里的图片，按标签挑一张发出去。
 *
 * 文件名就是标签，可以用下划线/空格分多个：开心_打滚_1.png → ['开心','打滚']。
 * 不依赖任何第三方库。
 */
import fs from 'node:fs'
import path from 'node:path'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

function splitTags(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .split(/[_\-\s]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag && !/^\d+$/.test(tag))
}

export class StickerBox {
  constructor({ dir, logger } = {}) {
    this.dir = dir
    this.logger = logger
    this.cache = { at: 0, items: [] }
  }

  ensure() {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  /** 递归扫描目录（3 秒缓存），返回 [{name, file, tags}]。 */
  list() {
    const now = Date.now()
    if (now - this.cache.at < 3000) return this.cache.items
    const items = []
    const walk = (dir, inheritedTags, depth) => {
      let entries = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (depth < 3) walk(full, [...inheritedTags, ...splitTags(entry.name)], depth + 1)
          continue
        }
        if (!IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) continue
        items.push({
          name: path.basename(entry.name, path.extname(entry.name)),
          file: full,
          tags: [...new Set([...inheritedTags, ...splitTags(entry.name)])],
        })
      }
    }
    walk(this.dir, [], 0)
    this.cache = { at: now, items }
    return items
  }

  count() {
    return this.list().length
  }

  /** 汇总：总数 + 常见标签（最多 20 个），给工具列表用。 */
  stats() {
    const items = this.list()
    const counts = new Map()
    for (const item of items) {
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    const tags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }))
    return { total: items.length, tags }
  }

  /** 按标签挑一张；没有匹配就随机；一张都没有返回 null。 */
  pick({ tag = '', random = Math.random } = {}) {
    const items = this.list()
    if (items.length === 0) return null
    const needle = String(tag ?? '').trim().toLowerCase()
    const pool = needle
      ? items.filter(
          (item) =>
            item.name.toLowerCase().includes(needle) ||
            item.tags.some((t) => t.toLowerCase().includes(needle)),
        )
      : items
    const source = pool.length > 0 ? pool : items
    return source[Math.floor(random() * source.length) % source.length]
  }
}
