/**
 * 极简原子 JSON 存储。写入走 tmp + rename，读取失败时保留损坏文件并
 * 回退到默认值，保证插件永远不会因为一个坏文件而加载失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** 解析 DSH 数据目录：优先配置，其次 $DSH_HOME，最后 ~/.dsh。 */
export function resolveDataDir(configured) {
  if (configured && configured.trim()) return path.resolve(configured.trim())
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim()
  const base = home ? path.resolve(home) : path.join(os.homedir(), '.dsh')
  return path.join(base, 'dafeiyu')
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

export class JsonStore {
  /**
   * @param {string} file 完整文件路径
   * @param {() => any} makeDefault 生成默认值
   */
  constructor(file, makeDefault) {
    this.file = file
    this.makeDefault = makeDefault
    this.data = undefined
    this.loaded = false
  }

  load() {
    if (this.loaded) return this.data
    this.loaded = true
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      this.data = parsed
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        this.backupCorrupt()
      }
      this.data = this.makeDefault()
    }
    return this.data
  }

  backupCorrupt() {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      fs.renameSync(this.file, `${this.file}.corrupt-${stamp}`)
    } catch {
      /* 备份失败时保持原样，下一次读取仍会回退到默认值 */
    }
  }

  /** 读取-修改-写回；mutator 返回 null 表示放弃写入。 */
  update(mutator) {
    const current = this.load()
    const next = mutator(current)
    if (next === null) return current
    this.data = next === undefined ? current : next
    this.save()
    return this.data
  }

  save() {
    const dir = path.dirname(this.file)
    ensureDir(dir)
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, this.file)
  }
}
