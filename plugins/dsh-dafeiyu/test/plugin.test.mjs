import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, defaultState } from '../lib/index.js'

function fakeCtx() {
  const tools = []
  const sections = []
  const variables = new Map()
  const eventHandlers = []
  const cleanups = []
  const warnings = []
  const logger = {
    info: () => {},
    debug: () => {},
    warn: (message) => warnings.push(String(message)),
    error: () => {},
  }
  const systemPrompt = {
    section: (section) => {
      sections.push(section)
      return () => {}
    },
    variable: (name, provider) => {
      variables.set(name, provider)
      return () => {}
    },
    getSectionOrder: () => 10_150,
  }
  const ctx = {
    logger,
    systemPrompt,
    get: (name) => (name === 'systemPrompt' ? systemPrompt : undefined),
    tools: {
      register: (tool) => {
        tools.push(tool)
        return () => {}
      },
    },
    on: (event, handler) => {
      eventHandlers.push({ event, handler })
      return () => {}
    },
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    },
  }
  return { ctx, tools, sections, variables, eventHandlers, cleanups, warnings }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-plugin-'))
}

test('插件加载：注册六个工具与人格段，状态变量可求值', () => {
  const dir = tempDir()
  const { ctx, tools, sections, variables, cleanups, warnings } = fakeCtx()
  apply(ctx, { dataDir: dir })

  assert.equal(tools.length, 11)
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['feiyu_digest', 'feiyu_mood', 'feiyu_qq_inbox', 'feiyu_qq_send', 'feiyu_qzone', 'feiyu_recall', 'feiyu_remember', 'feiyu_shell', 'feiyu_sticker', 'feiyu_voice', 'feiyu_watch'],
  )
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(tool.output.schema.type, 'object')
  }

  assert.equal(sections.length, 1)
  assert.match(sections[0].text, /大肥鱼/)
  assert.match(sections[0].text, /\{\{feiyu_state\}\}/)
  assert.ok(variables.has('feiyu_state'))
  const stateText = variables.get('feiyu_state')()
  assert.match(stateText, /心情/)
  assert.match(stateText, /长期记忆还是空的/)

  for (const cleanup of cleanups) cleanup()
  assert.equal(warnings.filter((w) => w.includes('配置问题')).length, 0)
})

test('工具闭环：记住 → 回忆 → 记录心情 → 摘要', async () => {
  const dir = tempDir()
  const { ctx, tools, variables, cleanups } = fakeCtx()
  apply(ctx, { dataDir: dir })
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))

  const saved = await byName.feiyu_remember.execute({
    text: '主人喜欢喝冰美式，不加糖',
    tags: ['偏好', '咖啡'],
    importance: 4,
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.count, 1)

  const recalled = await byName.feiyu_recall.execute({ query: '主人喜欢喝什么' })
  assert.equal(recalled.count, 1)
  assert.match(recalled.memories[0].text, /冰美式/)

  const fed = await byName.feiyu_mood.execute({ action: 'feed' })
  assert.ok(fed.satiety > 60)
  assert.match(fed.message, /吃饱/)

  const digest = await byName.feiyu_digest.execute({ summary: '今天和主人聊了咖啡和测试城市出差' })
  assert.equal(digest.count, 2)

  const stateText = variables.get('feiyu_state')()
  assert.match(stateText, /冰美式|测试城市/)

  for (const cleanup of cleanups) cleanup()
})

test('QQ 未启用时相关工具给出明确错误', async () => {
  const dir = tempDir()
  const { ctx, tools, cleanups } = fakeCtx()
  apply(ctx, { dataDir: dir })
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
  await assert.rejects(() => byName.feiyu_qq_send.execute({ target: 'private:1', text: 'hi' }), /QQ 桥接未启用/)
  await assert.rejects(() => byName.feiyu_qq_inbox.execute({}), /QQ 桥接未启用/)
  for (const cleanup of cleanups) cleanup()
})

test('人格可关闭，数据目录可自定义', () => {
  const dir = tempDir()
  const { ctx, sections, tools } = fakeCtx()
  apply(ctx, { dataDir: dir, persona: { enabled: false } })
  assert.equal(sections.length, 0)
  assert.equal(tools.length, 11)
  assert.ok(fs.existsSync(path.join(dir, 'state.json')))
})

test('默认状态结构稳定', () => {
  const state = defaultState()
  assert.equal(state.version, 1)
  assert.equal(typeof state.mood.energy, 'number')
  assert.equal(state.mood.key, 'calm')
})
