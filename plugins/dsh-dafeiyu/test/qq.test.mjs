import test from 'node:test'
import assert from 'node:assert/strict'
import { OneBotClient, extractText, normalizeOneBotEvent, parseTarget } from '../lib/qq.js'
import { createMiniOneBotServer } from './helpers/mini-ws-server.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, { timeout = 5000, interval = 20 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await predicate()) return true
    await sleep(interval)
  }
  throw new Error('waitFor timeout')
}

test('parseTarget：私聊/群聊/裸数字', () => {
  assert.deepEqual(parseTarget('private:123456'), { type: 'private', id: 123456 })
  assert.deepEqual(parseTarget('group:789012'), { type: 'group', id: 789012 })
  assert.deepEqual(parseTarget('123456'), { type: 'private', id: 123456 })
  assert.throws(() => parseTarget('hello'), /无法解析/)
})

test('extractText：消息段与 CQ 码', () => {
  assert.equal(extractText([{ type: 'text', data: { text: '你好 ' } }, { type: 'at', data: { qq: '42' } }]), '你好 @42')
  assert.equal(extractText([{ type: 'image', data: {} }, { type: 'text', data: { text: '看图' } }]), '[图片]看图')
  assert.equal(extractText('hi[CQ:image,file=a.png]there'), 'hi[图片]there')
})

test('normalizeOneBotEvent：私聊与群聊、忽略自己', () => {
  const base = {
    post_type: 'message',
    self_id: 999,
    user_id: 123,
    sender: { nickname: '小明' },
    message: [{ type: 'text', data: { text: '在吗' } }],
    message_id: 7,
    time: 1700000000,
  }
  const privateMessage = normalizeOneBotEvent({ ...base, message_type: 'private' })
  assert.equal(privateMessage.type, 'private')
  assert.equal(privateMessage.targetKey, 'private:123')
  assert.equal(privateMessage.text, '在吗')
  assert.equal(privateMessage.nickname, '小明')

  const group = normalizeOneBotEvent({ ...base, message_type: 'group', group_id: 456 })
  assert.equal(group.targetKey, 'group:456')

  assert.equal(normalizeOneBotEvent({ ...base, message_type: 'private', user_id: 999 }), undefined)
  assert.equal(normalizeOneBotEvent({ post_type: 'notice' }), undefined)
})

test('OneBot 客户端：鉴权连接、收消息、发消息、去重', async () => {
  const server = await createMiniOneBotServer({ token: 'secret' })
  const client = new OneBotClient({
    url: server.url,
    token: 'secret',
    reconnect: { minMs: 100, maxMs: 200 },
  })
  const messages = []
  const inbox = []
  client.on('message', (message) => messages.push(message))
  client.on('inbox', (message) => inbox.push(message))
  client.start()

  await waitFor(() => client.status.state === 'connected')
  assert.equal(server.connections, 1)

  const event = {
    post_type: 'message',
    message_type: 'private',
    self_id: 999,
    user_id: 123,
    sender: { nickname: '小明' },
    message: [{ type: 'text', data: { text: '大肥鱼在吗' } }],
    message_id: 11,
    time: 1700000000,
  }
  server.broadcast(event)
  await waitFor(() => messages.length === 1)
  assert.equal(messages[0].text, '大肥鱼在吗')

  // 同一个 message_id 不应重复入队
  server.broadcast(event)
  await sleep(120)
  assert.equal(messages.length, 1)
  assert.equal(inbox.length, 1)
  assert.equal(client.recent(5).length, 1)

  const response = await client.send('private:123', '我在呢')
  assert.equal(response.status, 'ok')
  assert.equal(server.actions.length, 1)
  assert.equal(server.actions[0].action, 'send_msg')
  assert.equal(server.actions[0].params.message_type, 'private')
  assert.equal(server.actions[0].params.user_id, 123)
  assert.equal(server.actions[0].params.message[0].data.text, '我在呢')

  await client.close()
  await server.close()
})

test('OneBot 客户端：发送失败、空消息与未连接报错', async () => {
  const client = new OneBotClient({ url: 'ws://127.0.0.1:1/', reconnect: { minMs: 50, maxMs: 100 } })
  await assert.rejects(() => client.send('123', 'hi'), /未连接/)
  await client.close()

  const server = await createMiniOneBotServer()
  const online = new OneBotClient({ url: server.url, reconnect: { minMs: 50, maxMs: 100 } })
  online.start()
  await waitFor(() => online.status.state === 'connected')
  await assert.rejects(() => online.send('123', '   '), /为空/)
  await online.close()
  await server.close()
})

test('OneBot 客户端：断线后自动重连', async () => {
  const server = await createMiniOneBotServer()
  const client = new OneBotClient({ url: server.url, reconnect: { minMs: 80, maxMs: 200 } })
  client.start()
  await waitFor(() => client.status.state === 'connected')
  assert.equal(server.connections, 1)

  server.dropClients()
  await waitFor(() => server.connections >= 2, { timeout: 8000 })
  await waitFor(() => client.status.state === 'connected', { timeout: 8000 })
  assert.ok(client.status.stats.reconnects >= 1)

  await client.close()
  await server.close()
})

test('OneBot 客户端：access_token 走查询参数', async () => {
  const server = await createMiniOneBotServer({ token: 'tok' })
  const bad = new OneBotClient({ url: server.url, token: 'wrong', reconnect: { minMs: 50, maxMs: 100 } })
  bad.start()
  await sleep(400)
  assert.notEqual(bad.status.state, 'connected')
  await bad.close()

  const good = new OneBotClient({ url: server.url, token: 'tok', reconnect: { minMs: 50, maxMs: 100 } })
  good.start()
  await waitFor(() => good.status.state === 'connected')
  await good.close()
  await server.close()
})
