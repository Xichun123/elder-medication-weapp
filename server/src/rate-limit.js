export function createFixedWindowRateLimiter({ windowMs = 60_000, maxKeys = 10_000 } = {}) {
  const entries = new Map()

  function cleanup(now) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key)
    }
  }

  return {
    consume(key, limit, now = Date.now()) {
      if (!Number.isInteger(limit) || limit < 1) throw new Error('rate limit 必须是正整数')
      let entry = entries.get(key)
      if (!entry || entry.resetAt <= now) {
        if (!entry && entries.size >= maxKeys) cleanup(now)
        if (!entry && entries.size >= maxKeys) {
          const oldestKey = entries.keys().next().value
          if (oldestKey !== undefined) entries.delete(oldestKey)
        }
        entry = { count: 0, resetAt: now + windowMs }
        entries.set(key, entry)
      }
      if (entry.count >= limit) {
        return { allowed: false, retryAfterMs: Math.max(1, entry.resetAt - now) }
      }
      entry.count += 1
      return { allowed: true, remaining: limit - entry.count, retryAfterMs: 0 }
    },
    size() {
      return entries.size
    },
  }
}
