import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { config, validateConfig } from './config.js'
import { getDb, nowIso } from './db.js'
import { HttpError } from './errors.js'
import { requireAuth } from './middleware.js'
import authRoutes, { publicUser } from './routes/auth.js'
import homesRoutes from './routes/homes.js'
import packageImageRoutes from './routes/package-images.js'
import resourcesRoutes from './routes/resources.js'
import aiRoutes from './routes/ai.js'
import { getAiMedia } from './ai-media.js'
import { MAX_AVATAR_BYTES, sanitizeAvatarImage } from './user-avatars.js'

const app = new Hono()

app.onError((error, c) => {
  const knownError = error instanceof HttpError
  const status = knownError ? error.status : 500
  if (!knownError) console.error(error)
  const message = knownError ? error.message : (config.isProd ? '服务器错误' : (error.message || '服务器错误'))
  return c.json({ error: message }, status)
})

app.get('/health', (c) => c.json({
  ok: true,
  service: 'yao-ling-tong-api',
  time: new Date().toISOString(),
  authConfigured: Boolean(config.wxAppId && config.wxAppSecret),
  recognitionConfigured: Boolean(config.recognitionApiUrl && config.recognitionApiKey && config.recognitionModel),
}))

// 短时随机 URL：供百炼异步 ASR 下载录音，也让小程序只从自己的合法域名播放 TTS。
app.get('/ai-media/:token', async (c) => {
  const item = getAiMedia(c.req.param('token'))
  if (!item) return c.json({ error: '音频已过期或不存在' }, 404)
  if (item.buffer) return new Response(item.buffer, { headers: { 'content-type': item.contentType, 'cache-control': 'private, max-age=60' } })
  const upstream = await fetch(item.remoteUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (!upstream?.ok) return c.json({ error: '音频暂不可用' }, 502)
  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') || item.contentType,
      'cache-control': 'private, max-age=60',
    },
  })
})

app.route('/auth', authRoutes)
app.route('/package-images', packageImageRoutes)

// 用户头像：公开读取（路径含用户 ID，前端再拼 apiBaseUrl）
app.get('/avatars/:userId', (c) => {
  const userId = c.req.param('userId')
  const row = getDb().prepare(`
    SELECT avatar_data, avatar_content_type, updated_at
    FROM users
    WHERE id = ?
  `).get(userId)
  if (!row || !row.avatar_data) return c.json({ error: '头像不存在' }, 404)
  return new Response(row.avatar_data, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': row.avatar_content_type || 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

app.use('/me', requireAuth)
app.use('/me/*', requireAuth)
app.get('/me', async (c) => {
  const user = c.get('user')
  const full = getDb().prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  return c.json({ user: publicUser(full || user) })
})

app.patch('/me', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const nickname = body.nickname !== undefined ? String(body.nickname || '').trim() : undefined
  if (nickname !== undefined && !nickname) throw new HttpError(400, '昵称不能为空')
  if (nickname !== undefined && Array.from(nickname).length > 20) {
    throw new HttpError(400, '昵称不能超过 20 个字符')
  }

  const ts = nowIso()
  if (nickname !== undefined) {
    getDb().prepare(`
      UPDATE users
      SET nickname = ?, updated_at = ?
      WHERE id = ?
    `).run(nickname, ts, user.id)
  }

  const full = getDb().prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  return c.json({ user: publicUser(full) })
})

app.post(
  '/me/avatar',
  bodyLimit({
    // 为 multipart 边界预留少量开销，实际文件大小仍由 sanitizeAvatarImage 严格限制。
    maxSize: MAX_AVATAR_BYTES + 256 * 1024,
    onError: (c) => c.json({ error: '头像文件不能超过 2MB' }, 413),
  }),
  async (c) => {
    const user = c.get('user')
    const body = await c.req.parseBody().catch(() => ({}))
    const processed = await sanitizeAvatarImage(body.file || body.image || body.avatar)
    const ts = nowIso()
    const avatarUrl = `/avatars/${user.id}`
    getDb().prepare(`
      UPDATE users
      SET avatar_data = ?,
          avatar_content_type = ?,
          avatar_byte_size = ?,
          avatar_url = ?,
          updated_at = ?
      WHERE id = ?
    `).run(processed.data, processed.contentType, processed.byteSize, avatarUrl, ts, user.id)

    const full = getDb().prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    return c.json({ user: publicUser(full) })
  },
)

app.route('/homes', homesRoutes)
app.route('/homes', resourcesRoutes)
app.route('/homes', aiRoutes)

// 启动前校验生产配置并初始化数据库。
validateConfig()
getDb()

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[药灵通 API] http://${info.address}:${info.port}`)
  console.log(`  db: ${config.databasePath}`)
  console.log(`  devLogin: ${config.allowDevLogin ? 'ON' : 'OFF'}`)
  console.log(`  wx: ${config.wxAppId && config.wxAppSecret ? 'configured' : 'incomplete'}`)
})

export default app
