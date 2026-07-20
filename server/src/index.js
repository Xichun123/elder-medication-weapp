import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config, validateConfig } from './config.js'
import { getDb } from './db.js'
import { HttpError } from './errors.js'
import { requireAuth } from './middleware.js'
import authRoutes from './routes/auth.js'
import homesRoutes from './routes/homes.js'
import packageImageRoutes from './routes/package-images.js'
import resourcesRoutes from './routes/resources.js'

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

app.route('/auth', authRoutes)
app.route('/package-images', packageImageRoutes)
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
