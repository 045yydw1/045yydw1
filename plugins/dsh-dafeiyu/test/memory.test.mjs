import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MemoryBook, scoreMemory, tokenize } from '../lib/memory.js'

const T0 = Date.UTC(2026, 10, 2, 12, 0, 0)

function book() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-mem-'))
  return new MemoryBook(path.join(dir, 'memory.json'), { maxItems: 20 })
}

test('分词：中文二元组 + 英文单词', () => {
  const tokens = tokenize('大肥鱼 likes DeepSeek 鲸鱼')
  assert.ok(tokens.has('大肥'))
  assert.ok(tokens.has('肥鱼'))
  assert.ok(tokens.has('deepseek'))
  assert.ok(tokens.has('鲸鱼'))
})

test('记忆：写入、去重、召回', () => {
  const memory = book()
  memory.add({ text: '主人喜欢喝冰美式', tags: ['偏好'], importance: 4, now: T0 })
  memory.add({ text: '主人下周要去测试城市出差', tags: ['行程'], importance: 5, now: T0 + 1_000 })
  memory.add({ text: '主人喜欢喝冰美式', tags: ['咖啡'], now: T0 + 2_000 })

  assert.equal(memory.count(), 2)
  const hits = memory.recall('主人喜欢喝什么', { now: T0 + 3_000 })
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].text, '主人喜欢喝冰美式')
  assert.ok(hits[0].tags.includes('咖啡'))
})

test('记忆：不相关查询不返回', () => {
  const memory = book()
  memory.add({ text: '主人喜欢喝冰美式', now: T0 })
  assert.deepEqual(memory.recall('量子力学', { now: T0 + 1_000 }), [])
})

test('记忆：新近度与重要度影响排序', () => {
  const old = { text: '旧的重要记忆', tags: [], importance: 5, ts: T0 - 400 * 86_400_000 }
  const recent = { text: '新的普通记忆', tags: [], importance: 3, ts: T0 }
  const tokens = tokenize('记忆')
  const s1 = scoreMemory(old, tokens, '记忆', { now: T0 })
  const s2 = scoreMemory(recent, tokens, '记忆', { now: T0 })
  assert.ok(s2 > s1)
})

test('记忆：超过上限时裁剪且保留高重要度', () => {
  const memory = book()
  for (let i = 0; i < 30; i += 1) {
    memory.add({ text: `测试记忆 ${i}`, importance: i === 0 ? 5 : 1, now: T0 + i })
  }
  assert.equal(memory.count(), 20)
  assert.ok(memory.items.some((item) => item.text === '测试记忆 0'))
})

test('周期遗忘：旧琐事被忘掉，重要设定与保护标签保留', () => {
  const memory = book()
  const old = T0 - 200 * 86_400_000
  memory.add({ text: '旧的琐事', importance: 2, now: old })
  memory.add({ text: '重要设定：主人怕冷', importance: 4, tags: ['设定'], now: old })
  memory.add({ text: '带保护标签的旧事', importance: 2, tags: ['约定'], now: old })
  memory.add({ text: '新的琐事', importance: 2, now: T0 })

  const removed = memory.forgetOld({ now: T0, maxAgeDays: 90, keepImportance: 4, keepTags: ['设定', '约定'] })
  assert.equal(removed, 1)
  assert.equal(memory.count(), 3)
  assert.ok(!memory.items.some((item) => item.text === '旧的琐事'))
  assert.ok(memory.items.some((item) => item.text === '重要设定：主人怕冷'))
  assert.ok(memory.items.some((item) => item.text === '带保护标签的旧事'))
})
