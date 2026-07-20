import { newId } from './ids.js'

const items = new Map()
const DEFAULT_TTL_MS = 5 * 60_000

function cleanup() {
  const now = Date.now()
  for (const [token, item] of items) {
    if (item.expiresAt <= now) items.delete(token)
  }
}

export function storeAiMedia({ buffer, contentType, remoteUrl, ttlMs = DEFAULT_TTL_MS }) {
  cleanup()
  const token = newId('MEDIA')
  items.set(token, {
    buffer: buffer || null,
    contentType: contentType || 'application/octet-stream',
    remoteUrl: remoteUrl || '',
    expiresAt: Date.now() + ttlMs,
  })
  return token
}

export function getAiMedia(token) {
  cleanup()
  return items.get(token) || null
}
