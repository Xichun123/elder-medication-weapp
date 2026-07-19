import { Hono } from 'hono'
import { code2Session, signToken } from '../auth.js'
import { config } from '../config.js'
import { getDb, nowIso } from '../db.js'
import { HttpError } from '../errors.js'
import { newId } from '../ids.js'

const auth = new Hono()

function publicUser(row) {
  return {
    id: row.id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
  }
}

function upsertUserByOpenid(openid, extra = {}) {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid)
  const ts = nowIso()
  if (existing) {
    if (extra.nickname || extra.avatar_url) {
      db.prepare(`
        UPDATE users
        SET nickname = COALESCE(?, nickname),
            avatar_url = COALESCE(?, avatar_url),
            updated_at = ?
        WHERE id = ?
      `).run(extra.nickname || null, extra.avatar_url || null, ts, existing.id)
      return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id)
    }
    return existing
  }
  const id = newId('U')
  db.prepare(`
    INSERT INTO users (id, openid, unionid, nickname, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, openid, extra.unionid || null, extra.nickname || '', extra.avatar_url || '', ts, ts)
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id)
}

auth.post('/wx-login', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const code = body.code && String(body.code)
  const devOpenid = body.devOpenid && String(body.devOpenid)
  const nickname = body.nickname ? String(body.nickname).slice(0, 64) : ''
  const avatarUrl = body.avatarUrl ? String(body.avatarUrl).slice(0, 512) : ''

  let openid
  let unionid = null

  if (devOpenid) {
    if (!config.allowDevLogin) throw new HttpError(403, '未开启开发登录')
    openid = devOpenid.slice(0, 64)
  } else if (code) {
    if (!config.wxAppId || !config.wxAppSecret) {
      throw new HttpError(503, '微信登录暂不可用')
    }
    try {
      const session = await code2Session(code)
      openid = session.openid
      unionid = session.unionid
    } catch (error) {
      console.warn('微信 code2Session 失败', error.message)
      throw new HttpError(401, '微信登录失败，请重新进入小程序后重试')
    }
  } else {
    throw new HttpError(400, '请提供 code 或 devOpenid')
  }

  const user = upsertUserByOpenid(openid, {
    unionid,
    nickname: nickname || undefined,
    avatar_url: avatarUrl || undefined,
  })
  const token = signToken({ sub: user.id })
  return c.json({ token, user: publicUser(user) })
})

export default auth
