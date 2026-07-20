import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config, validateConfig } from './config.js'
import { getDb } from './db.js'
import { HttpError } from './errors.js'
import { requireAuth } from './middleware.js'
import authRoutes from './routes/auth.js'
import homesRoutes from './routes/homes.js'
import resourcesRoutes from './routes/resources.js'
import aiRoutes from './routes/ai.js'
import { getAiMedia } from './ai-media.js'

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
app.use('/me', requireAuth)
app.get('/me', async (c) => {
  const user = c.get('user')
  return c.json({
    user: {
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatar_url,
      createdAt: user.created_at,
    },
  })
})
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
