import { HttpError } from './errors.js'
import { newId } from './ids.js'

const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_MAX_ITEMS = 64
const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024

export function createAiMediaStore({
  maxItems = DEFAULT_MAX_ITEMS,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  now = () => Date.now(),
} = {}) {
  const items = new Map()
  let bufferBytes = 0

  function remove(token) {
    const item = items.get(token)
    if (!item) return false
    items.delete(token)
    bufferBytes -= item.bufferBytes
    return true
  }

  function cleanup() {
    const current = now()
    for (const [token, item] of items) {
      if (item.expiresAt <= current) remove(token)
    }
  }

  return {
    store({ buffer, contentType, remoteUrl, ttlMs = DEFAULT_TTL_MS }) {
      cleanup()
      const itemBufferBytes = Number(buffer?.byteLength || 0)
      if (items.size >= maxItems || bufferBytes + itemBufferBytes > maxBufferBytes) {
        throw new HttpError(503, '语音服务繁忙，请稍后重试')
      }
      const token = newId('MEDIA')
      items.set(token, {
        buffer: buffer || null,
        bufferBytes: itemBufferBytes,
        contentType: contentType || 'application/octet-stream',
        remoteUrl: remoteUrl || '',
        expiresAt: now() + ttlMs,
      })
      bufferBytes += itemBufferBytes
      return token
    },
    get(token) {
      cleanup()
      return items.get(token) || null
    },
    delete(token) {
      return remove(token)
    },
    stats() {
      cleanup()
      return { items: items.size, bufferBytes }
    },
  }
}

const mediaStore = createAiMediaStore()

export function storeAiMedia(item) {
  return mediaStore.store(item)
}

export function getAiMedia(token) {
  return mediaStore.get(token)
}

export function deleteAiMedia(token) {
  return mediaStore.delete(token)
}
