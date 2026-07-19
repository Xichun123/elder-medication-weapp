import { verifyToken } from './auth.js'
import { getDb } from './db.js'
import { HttpError } from './errors.js'

export async function requireAuth(c, next) {
  const header = c.req.header('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  try {
    const payload = verifyToken(token)
    const user = getDb().prepare('SELECT id, nickname, avatar_url, created_at FROM users WHERE id = ?').get(payload.sub)
    if (!user) throw new HttpError(401, '用户不存在')
    c.set('user', user)
    c.set('tokenPayload', payload)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 401
    return c.json({ error: error.message || '未登录' }, status)
  }
  await next()
}

const ROLE_RANK = {
  caregiver_view: 1,
  elder: 1,
  caregiver_edit: 2,
  owner: 3,
}

export function requireHomeMember(minRole = 'caregiver_view') {
  return async (c, next) => {
    const user = c.get('user')
    const homeId = c.req.param('homeId')
    const membership = getDb().prepare(`
      SELECT m.*, h.name AS home_name
      FROM memberships m
      JOIN homes h ON h.id = m.home_id
      WHERE m.home_id = ? AND m.user_id = ?
    `).get(homeId, user.id)

    if (!membership) return c.json({ error: '不在该家庭中' }, 403)

    const need = ROLE_RANK[minRole] || 1
    const have = ROLE_RANK[membership.role] || 0
    // elder 与 caregiver_view 同级只读，但 elder 不能访问家属写接口（用 minRole 区分）
    if (minRole === 'caregiver_edit' || minRole === 'owner') {
      if (have < need) return c.json({ error: '权限不足' }, 403)
    } else if (minRole === 'caregiver_view') {
      // owner / edit / view / elder 均可读家庭内被允许的资源；具体资源再裁剪
      if (!have) return c.json({ error: '权限不足' }, 403)
    }

    c.set('membership', membership)
    c.set('homeId', homeId)
    await next()
  }
}
