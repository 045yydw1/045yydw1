import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ROUTINES,
  slotFor,
  pickRoutine,
  parseClock,
  inQuietHours,
  msUntilQuietEnd,
  LifeScheduler,
} from '../lib/life.js'

function at(hour, minute = 0) {
  return new Date(2026, 10, 12, hour, minute, 0, 0)
}

test('时间段划分', () => {
  assert.equal(slotFor(at(7)), 'morning')
  assert.equal(slotFor(at(13)), 'afternoon')
  assert.equal(slotFor(at(20)), 'evening')
  assert.equal(slotFor(at(2)), 'night')
})

test('随机挑一句且来自对应时段', () => {
  const line = pickRoutine(at(13), { random: () => 0 })
  assert.equal(line, ROUTINES.afternoon[0])
  const custom = pickRoutine(at(13), { templates: { afternoon: ['自定义'] }, random: () => 0.9 })
  assert.equal(custom, '自定义')
})

test('解析时间与安静时段（跨午夜）', () => {
  assert.equal(parseClock('23:30'), 1410)
  assert.equal(parseClock('08:05'), 485)
  assert.equal(parseClock('24:00'), undefined)
  const quiet = { start: '23:30', end: '08:30' }
  assert.equal(inQuietHours(at(23, 45), quiet), true)
  assert.equal(inQuietHours(at(3, 0), quiet), true)
  assert.equal(inQuietHours(at(8, 29), quiet), true)
  assert.equal(inQuietHours(at(8, 30), quiet), false)
  assert.equal(inQuietHours(at(13, 0), quiet), false)
  assert.ok(msUntilQuietEnd(at(23, 45), quiet) > 0)
  assert.equal(msUntilQuietEnd(at(13, 0), quiet), 0)
})

test('调度器：到点发送给目标，安静时段不发送', async () => {
  const sent = []
  let current = at(13)
  const bridge = { status: { state: 'connected' }, send: async (target, text) => sent.push({ target, text }) }
  const config = {
    life: {
      enabled: true,
      minMinutes: 0.001,
      maxMinutes: 0.001,
      quietHours: { start: '23:30', end: '08:30' },
      targets: ['private:1'],
    },
  }
  const scheduler = new LifeScheduler({ config, bridge, now: () => current })
  scheduler.start()
  await new Promise((resolve) => setTimeout(resolve, 150))
  scheduler.stop()
  assert.ok(sent.length >= 1)
  assert.equal(sent[0].target, 'private:1')
  assert.ok(sent[0].text.length > 0)

  const quietSent = []
  current = at(2)
  const quietBridge = { status: { state: 'connected' }, send: async (t, x) => quietSent.push({ t, x }) }
  const quietScheduler = new LifeScheduler({ config, bridge: quietBridge, now: () => current })
  quietScheduler.start()
  await new Promise((resolve) => setTimeout(resolve, 150))
  quietScheduler.stop()
  assert.equal(quietSent.length, 0)
})

test('桥未连接时跳过', async () => {
  const sent = []
  const bridge = { status: { state: 'disconnected' }, send: async () => sent.push(1) }
  const config = { life: { enabled: true, minMinutes: 0.001, maxMinutes: 0.001, targets: ['private:1'] } }
  const scheduler = new LifeScheduler({ config, bridge })
  scheduler.start()
  await new Promise((resolve) => setTimeout(resolve, 150))
  scheduler.stop()
  assert.equal(sent.length, 0)
})
