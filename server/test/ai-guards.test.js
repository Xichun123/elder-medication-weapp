import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiMediaStore } from '../src/ai-media.js'
import { createFixedWindowRateLimiter } from '../src/rate-limit.js'

test('AI 媒体缓存限制条目数和录音总字节数，并在删除或过期后释放容量', () => {
  let now = 1_000
  const store = createAiMediaStore({ maxItems: 2, maxBufferBytes: 5, now: () => now })
  const audioToken = store.store({ buffer: Buffer.from('abc'), contentType: 'audio/mpeg', ttlMs: 100 })
  const remoteToken = store.store({ remoteUrl: 'https://example.test/audio.mp3', ttlMs: 100 })
  assert.deepEqual(store.stats(), { items: 2, bufferBytes: 3 })
  assert.throws(
    () => store.store({ buffer: Buffer.from('def') }),
    (error) => error.status === 503 && error.message.includes('语音服务繁忙'),
  )

  assert.equal(store.delete(remoteToken), true)
  assert.throws(() => store.store({ buffer: Buffer.from('def') }), (error) => error.status === 503)
  assert.equal(store.delete(audioToken), true)
  store.store({ buffer: Buffer.from('def'), ttlMs: 100 })
  assert.deepEqual(store.stats(), { items: 1, bufferBytes: 3 })

  now += 101
  assert.deepEqual(store.stats(), { items: 0, bufferBytes: 0 })
})

test('AI 固定窗口限流器在达到配额后拒绝请求，并在窗口结束后恢复', () => {
  const limiter = createFixedWindowRateLimiter({ windowMs: 1_000 })
  assert.equal(limiter.consume('chat:user-1', 2, 100).allowed, true)
  assert.equal(limiter.consume('chat:user-1', 2, 200).allowed, true)
  const rejected = limiter.consume('chat:user-1', 2, 300)
  assert.equal(rejected.allowed, false)
  assert.equal(rejected.retryAfterMs, 800)
  assert.equal(limiter.consume('chat:user-1', 2, 1_100).allowed, true)
})
