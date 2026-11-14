import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chunkText,
  createAutoReplier,
  groupBubbles,
  insertInsult,
  sessionIdFor,
  splitBubbles,
} from '../lib/auto-reply.js'
import { resolveConfig } from '../lib/config.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fakeAgent(ctx, sessionId, { reply = '我在呢。' } = {}) {
  const agent = {
    status: 'idle',
    followups: [],
    followup(message) {
      this.followups.push(message)
      this.status = 'running'
      setTimeout(() => {
        ctx.emit(sessionId, {
          type: 'assistant/message',
          data: { message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
        })
        agent.status = 'idle'
        ctx.emit(sessionId, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
      }, 5)
    },
  }
  return agent
}

function fakeCtx() {
  const handlers = []
  const agents = new Map()
  const created = []
  const ctx = {
    emit(sessionId, event) {
      for (const { handler } of handlers) handler({ id: sessionId }, event)
    },
    on(event, handler) {
      handlers.push({ event, handler })
      return () => {}
    },
    agents: {
      async resume({ resumeSessionId, setup }) {
        const agent = agents.get(resumeSessionId)
        if (!agent) throw new Error('not found')
        setup?.({ tools: { restrict: () => {} } })
        return { agent, dispose: async () => {} }
      },
      async create({ sessionId, setup }) {
        const agent = fakeAgent(ctx, sessionId)
        agents.set(sessionId, agent)
        created.push({ sessionId, agent })
        setup?.({ tools: { restrict: () => {} } })
        return { agent, dispose: async () => {} }
      },
    },
    created,
    agentsMap: agents,
  }
  return ctx
}

const fastBubbles = {
  firstDelayMinMs: 0,
  firstDelayMaxMs: 0,
  minDelayMs: 0,
  maxDelayMs: 0,
  insultChance: 0,
}

test('sessionId 稳定且每个联系人不同', () => {
  assert.equal(sessionIdFor('private:123'), sessionIdFor('private:123'))
  assert.notEqual(sessionIdFor('private:123'), sessionIdFor('group:123'))
  assert.match(sessionIdFor('private:123'), /^dafeiyu-qq-[0-9a-f]{16}$/)
})

test('chunkText 按长度切块且不丢内容', () => {
  const text = `${'第一段。'.repeat(200)}\n${'第二段。'.repeat(200)}`
  const chunks = chunkText(text, 500)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => chunk.length <= 520))
  assert.equal(chunks.join('').replace(/\s/g, ''), text.replace(/\s/g, ''))
})

test('splitBubbles 按行/句拆成多条，且不超过上限', () => {
  assert.deepEqual(splitBubbles('在呢\n刚醒\n怎么了', 4), ['在呢', '刚醒', '怎么了'])
  assert.deepEqual(splitBubbles('在呢。刚醒。怎么了。', 4), ['在呢。', '刚醒。', '怎么了。'])
  assert.equal(splitBubbles('一。二。三。四。五。', 3).length, 3)
  assert.deepEqual(splitBubbles('   ', 4), [])
})

test('groupBubbles 随机合并成 1..n 条且不丢内容', () => {
  const parts = ['一句', '两句', '三句']
  const one = groupBubbles(parts, () => 0)
  assert.equal(one.length, 1)
  assert.equal(one[0].replace(/\s/g, ''), '一句两句三句')
  const three = groupBubbles(parts, () => 0.99)
  assert.equal(three.length, 3)
  assert.equal(three.join('').replace(/\s/g, ''), '一句两句三句')
  for (let i = 0; i < 20; i += 1) {
    const grouped = groupBubbles(parts, Math.random)
    assert.ok(grouped.length >= 1 && grouped.length <= 3)
    assert.equal(grouped.join('').replace(/\s/g, ''), '一句两句三句')
  }
})

test('insertInsult 随机插入单个词，概率为 0 时不插', () => {
  const base = ['在呢', '刚醒']
  assert.deepEqual(insertInsult(base, { chance: 0 }), base)
  const withWord = insertInsult(base, { chance: 1, insults: ['笨蛋'], random: () => 0 })
  assert.equal(withWord.length, 3)
  assert.ok(withWord.includes('笨蛋'))
  for (let i = 0; i < 20; i += 1) {
    const result = insertInsult(base, { chance: 0.5, insults: ['蠢', '烦'], random: Math.random })
    assert.ok(result.length === 2 || result.length === 3)
  }
})

test('QQ 消息进入 agent，回复在 turn/end 发回', async () => {
  const ctx = fakeCtx()
  const config = resolveConfig({ qq: { autoReply: { enabled: true, bubbles: fastBubbles } } })
  const sent = []
  const bridge = { send: async (target, text) => sent.push({ target, text }) }
  const replier = createAutoReplier({ ctx, config, bridge, logger: undefined })

  await replier.handleIncoming({
    targetKey: 'private:123',
    target: { type: 'private', id: 123 },
    type: 'private',
    userId: '123',
    nickname: '主人',
    text: '大肥鱼在吗',
  })

  assert.equal(ctx.created.length, 1)
  const agent = ctx.created[0].agent
  assert.equal(agent.followups.length, 1)
  assert.match(agent.followups[0].content[0].text, /QQ 私聊/)
  assert.match(agent.followups[0].content[0].text, /大肥鱼在吗/)

  await sleep(80)
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], { target: { type: 'private', id: 123 }, text: '我在呢。' })
  replier.dispose()
})

test('运行时收到的消息会排队，回合结束后再投递', async () => {
  const ctx = fakeCtx()
  const config = resolveConfig({ qq: { autoReply: { enabled: true, bubbles: fastBubbles } } })
  const sent = []
  const bridge = { send: async (target, text) => sent.push({ target, text }) }
  const replier = createAutoReplier({ ctx, config, bridge })
  const message = {
    targetKey: 'private:1',
    target: { type: 'private', id: 1 },
    type: 'private',
    userId: '1',
    nickname: '甲',
    text: '第一句',
  }

  await replier.handleIncoming(message)
  await replier.handleIncoming({ ...message, text: '第二句' })
  await sleep(120)

  const agent = ctx.created[0].agent
  assert.equal(agent.followups.length, 2)
  assert.match(agent.followups[1].content[0].text, /第二句/)
  assert.equal(sent.length, 2)
  replier.dispose()
})

test('重启后优先 resume 已有会话', async () => {
  const ctx = fakeCtx()
  const config = resolveConfig({ qq: { autoReply: { enabled: true, bubbles: fastBubbles } } })
  const bridge = { send: async () => {} }
  const first = createAutoReplier({ ctx, config, bridge })
  await first.handleIncoming({
    targetKey: 'private:9',
    target: { type: 'private', id: 9 },
    type: 'private',
    userId: '9',
    nickname: '乙',
    text: '你好',
  })
  await sleep(80)
  first.dispose()

  const ctx2 = fakeCtx()
  ctx2.agents.resume = async ({ resumeSessionId }) => ({
    agent: fakeAgent(ctx2, resumeSessionId, { reply: '又见面啦' }),
    dispose: async () => {},
  })
  const second = createAutoReplier({ ctx: ctx2, config, bridge })
  await second.handleIncoming({
    targetKey: 'private:9',
    target: { type: 'private', id: 9 },
    type: 'private',
    userId: '9',
    nickname: '乙',
    text: '还记得我吗',
  })
  assert.equal(ctx2.created.length, 0)
  second.dispose()
})
