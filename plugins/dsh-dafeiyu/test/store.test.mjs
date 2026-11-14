import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig, validateConfig, DEFAULT_CONFIG } from '../lib/config.js'
import { JsonStore } from '../lib/store.js'

test('配置深合并：数组整体替换，对象递归合并', () => {
  const config = resolveConfig({ qq: { enabled: true, allowedGroups: ['123'] } })
  assert.equal(config.qq.enabled, true)
  assert.deepEqual(config.qq.allowedGroups, ['123'])
  assert.equal(config.qq.wsUrl, DEFAULT_CONFIG.qq.wsUrl)
  assert.equal(config.persona.name, '大肥鱼')
})

test('配置校验能发现常见错误', () => {
  const bad = resolveConfig({ qq: { enabled: true, wsUrl: 'http://x', autoReply: { enabled: true, provider: 'p' } } })
  const issues = validateConfig(bad)
  assert.ok(issues.some((issue) => issue.includes('wsUrl')))
  assert.ok(issues.some((issue) => issue.includes('同时提供')))
})

test('JSON 存储：写入后可读回，损坏文件自动备份并回退', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-store-'))
  const file = path.join(dir, 'state.json')
  const store = new JsonStore(file, () => ({ n: 0 }))
  assert.deepEqual(store.load(), { n: 0 })
  store.update((data) => ({ ...data, n: 1 }))
  const reread = new JsonStore(file, () => ({ n: 0 }))
  assert.equal(reread.load().n, 1)

  fs.writeFileSync(file, '{not json', 'utf8')
  const broken = new JsonStore(file, () => ({ n: 0 }))
  assert.deepEqual(broken.load(), { n: 0 })
  const backups = fs.readdirSync(dir).filter((name) => name.includes('.corrupt-'))
  assert.equal(backups.length, 1)
})
