import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyInteraction,
  decayMood,
  defaultMood,
  effectiveMoodKey,
  moodSnapshot,
  setMood,
  timeOfDay,
} from '../lib/mood.js'

const T0 = Date.UTC(2026, 10, 2, 12, 0, 0)

test('心情：默认值与惰性衰减', () => {
  const start = defaultMood(T0)
  assert.equal(effectiveMoodKey(start, T0), 'calm')
  const later = decayMood(start, T0 + 10 * 3_600_000)
  assert.ok(later.energy < start.energy)
  assert.ok(later.satiety < start.satiety)
})

test('心情：饿与困由数值阈值覆盖', () => {
  const hungry = { ...defaultMood(T0), satiety: 5, keyUntil: 0 }
  assert.equal(effectiveMoodKey(hungry, T0), 'hungry')
  const sleepy = { ...defaultMood(T0), energy: 5, keyUntil: 0 }
  assert.equal(effectiveMoodKey(sleepy, T0), 'sleepy')
})

test('心情：喂食恢复饱腹并短暂开心', () => {
  const start = { ...defaultMood(T0), satiety: 10 }
  const fed = applyInteraction(start, 'feed', T0)
  assert.ok(fed.satiety > start.satiety)
  assert.equal(effectiveMoodKey(fed, T0), 'happy')
  assert.equal(effectiveMoodKey(fed, T0 + 3 * 3_600_000), 'calm')
})

test('心情：被骂会生气，好感下降且不会低于 0', () => {
  const start = { ...defaultMood(T0), affection: 3 }
  const hurt = applyInteraction(start, 'scold', T0)
  assert.equal(effectiveMoodKey(hurt, T0), 'sulk')
  assert.equal(hurt.affection, 0)
})

test('心情：显式设置与快照', () => {
  const set = setMood(defaultMood(T0), 'emo', { reason: '想家了', holdMinutes: 30, now: T0 })
  assert.equal(effectiveMoodKey(set, T0 + 60_000), 'emo')
  const snap = moodSnapshot(set, T0 + 60_000)
  assert.equal(snap.label, '低落')
  assert.equal(snap.note, '想家了')
  assert.ok(['凌晨', '清晨', '上午', '中午', '下午', '晚上', '深夜'].includes(snap.timeOfDay))
})

test('时间描述覆盖全天', () => {
  const hours = [3, 7, 10, 13, 16, 20, 23]
  const labels = hours.map((hour) => timeOfDay(new Date(2026, 0, 1, hour)))
  assert.deepEqual(labels, ['凌晨', '清晨', '上午', '中午', '下午', '晚上', '深夜'])
})
