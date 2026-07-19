import { Hono } from 'hono'
import { getDb, nowIso } from '../db.js'
import { HttpError, assert } from '../errors.js'
import { newId, newInviteCode } from '../ids.js'
import { requireAuth, requireHomeMember } from '../middleware.js'

const homes = new Hono()

homes.use('*', requireAuth)

homes.get('/', (c) => {
  const user = c.get('user')
  const rows = getDb().prepare(`
    SELECT m.*, h.name AS home_name
    FROM memberships m
    JOIN homes h ON h.id = m.home_id
    WHERE m.user_id = ?
    ORDER BY m.created_at ASC
  `).all(user.id)
  return c.json({
    homes: rows.map((row) => ({
      id: row.home_id,
      name: row.home_name,
      role: row.role,
      elderProfileId: row.elder_profile_id || null,
      membershipId: row.id,
      joinedAt: row.created_at,
    })),
  })
})

homes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  assert(name, 400, '家庭名称不能为空')
  assert(name.length <= 50, 400, '家庭名称不能超过 50 个字符')

  const db = getDb()
  const ts = nowIso()
  const homeId = newId('H')
  const membershipId = newId('M')

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO homes (id, name, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(homeId, name, user.id, ts, ts)
    db.prepare(`
      INSERT INTO memberships (id, home_id, user_id, role, elder_profile_id, created_at)
      VALUES (?, ?, ?, 'owner', NULL, ?)
    `).run(membershipId, homeId, user.id, ts)
  })
  tx()

  return c.json({
    home: { id: homeId, name, role: 'owner', elderProfileId: null },
  }, 201)
})

homes.post('/join', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const code = String(body.code || '').trim().toUpperCase()
  assert(code, 400, '邀请码不能为空')

  const db = getDb()
  const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(code)
  assert(invite, 404, '邀请码无效')
  assert(!invite.used_by, 409, '邀请码已使用')
  assert(new Date(invite.expires_at).getTime() > Date.now(), 410, '邀请码已过期')

  const existing = db.prepare('SELECT * FROM memberships WHERE home_id = ? AND user_id = ?')
    .get(invite.home_id, user.id)
  if (existing) throw new HttpError(409, '已在该家庭中')

  if (invite.role === 'elder') {
    assert(invite.elder_profile_id, 400, '老人邀请未绑定档案')
    const elder = db.prepare('SELECT * FROM elder_profiles WHERE id = ? AND home_id = ?')
      .get(invite.elder_profile_id, invite.home_id)
    assert(elder, 404, '长辈档案不存在')
    assert(!elder.linked_user_id, 409, '该长辈已绑定老人账号')
  }

  const ts = nowIso()
  const membershipId = newId('M')
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO memberships (id, home_id, user_id, role, elder_profile_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      membershipId,
      invite.home_id,
      user.id,
      invite.role,
      invite.role === 'elder' ? invite.elder_profile_id : null,
      ts,
    )
    if (invite.role === 'elder') {
      db.prepare(`
        UPDATE elder_profiles
        SET linked_user_id = ?, updated_at = ?
        WHERE id = ? AND home_id = ?
      `).run(user.id, ts, invite.elder_profile_id, invite.home_id)
    }
    const used = db.prepare(`
      UPDATE invites
      SET used_by = ?, used_at = ?
      WHERE id = ? AND used_by IS NULL
    `).run(user.id, ts, invite.id)
    assert(used.changes === 1, 409, '邀请码已使用')
  })
  tx()

  const home = db.prepare('SELECT * FROM homes WHERE id = ?').get(invite.home_id)
  return c.json({
    home: {
      id: home.id,
      name: home.name,
      role: invite.role,
      elderProfileId: invite.role === 'elder' ? invite.elder_profile_id : null,
    },
  })
})

homes.get('/:homeId', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  const home = getDb().prepare('SELECT id, name, created_by, created_at FROM homes WHERE id = ?').get(membership.home_id)
  return c.json({
    home: {
      id: home.id,
      name: home.name,
      createdBy: home.created_by,
      createdAt: home.created_at,
      myRole: membership.role,
      myElderProfileId: membership.elder_profile_id || null,
    },
  })
})

homes.get('/:homeId/members', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  // 老人端只看自己
  if (membership.role === 'elder') {
    const self = getDb().prepare(`
      SELECT m.*, u.nickname, u.avatar_url
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.home_id = ? AND m.user_id = ?
    `).get(membership.home_id, membership.user_id)
    return c.json({
      members: [{
        id: self.id,
        userId: self.user_id,
        role: self.role,
        elderProfileId: self.elder_profile_id,
        nickname: self.nickname,
        avatarUrl: self.avatar_url,
        joinedAt: self.created_at,
      }],
    })
  }

  const rows = getDb().prepare(`
    SELECT m.*, u.nickname, u.avatar_url
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.home_id = ?
    ORDER BY m.created_at ASC
  `).all(membership.home_id)

  return c.json({
    members: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      role: row.role,
      elderProfileId: row.elder_profile_id,
      nickname: row.nickname,
      avatarUrl: row.avatar_url,
      joinedAt: row.created_at,
    })),
  })
})

homes.post('/:homeId/invites', requireHomeMember('owner'), async (c) => {
  const user = c.get('user')
  const membership = c.get('membership')
  const body = await c.req.json().catch(() => ({}))
  const role = String(body.role || 'caregiver_edit')
  assert(['caregiver_edit', 'caregiver_view', 'elder'].includes(role), 400, '无效角色')

  let elderProfileId = body.elderProfileId ? String(body.elderProfileId) : null
  if (role === 'elder') {
    assert(elderProfileId, 400, '邀请老人时必须指定 elderProfileId')
    const elder = getDb().prepare('SELECT * FROM elder_profiles WHERE id = ? AND home_id = ?')
      .get(elderProfileId, membership.home_id)
    assert(elder, 404, '长辈档案不存在')
    assert(!elder.linked_user_id, 409, '该长辈已绑定老人账号')
    const activeInvite = getDb().prepare(`
      SELECT * FROM invites
      WHERE home_id = ? AND elder_profile_id = ? AND used_by IS NULL AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(membership.home_id, elderProfileId, nowIso())
    if (activeInvite) {
      return c.json({
        invite: {
          id: activeInvite.id,
          code: activeInvite.code,
          role: activeInvite.role,
          elderProfileId: activeInvite.elder_profile_id,
          expiresAt: activeInvite.expires_at,
          createdAt: activeInvite.created_at,
        },
      })
    }
  } else {
    elderProfileId = null
  }

  // 成员邀请属于家庭 owner 专属操作，且不能通过邀请新增 owner。
  const ts = nowIso()
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString() // 72h
  const id = newId('I')
  let code = newInviteCode()
  const db = getDb()
  // 极端情况下撞码则重试
  for (let i = 0; i < 5; i += 1) {
    const hit = db.prepare('SELECT 1 FROM invites WHERE code = ?').get(code)
    if (!hit) break
    code = newInviteCode()
  }

  db.prepare(`
    INSERT INTO invites (
      id, home_id, code, role, elder_profile_id, created_by, expires_at, used_by, used_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `).run(id, membership.home_id, code, role, elderProfileId, user.id, expiresAt, ts)

  return c.json({
    invite: {
      id,
      code,
      role,
      elderProfileId,
      expiresAt,
      createdAt: ts,
    },
  }, 201)
})

homes.post('/:homeId/elders', requireHomeMember('caregiver_edit'), async (c) => {
  const membership = c.get('membership')
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const age = Number(body.age)
  assert(name, 400, '姓名不能为空')
  assert(name.length <= 50, 400, '姓名不能超过 50 个字符')
  assert(Number.isInteger(age) && age >= 1 && age <= 130, 400, '年龄必须是 1-130 的整数')
  const ts = nowIso()
  const id = newId('E')
  getDb().prepare(`
    INSERT INTO elder_profiles (
      id, home_id, name, gender, age, relationship, allergy_note, voice_tone,
      linked_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    id,
    membership.home_id,
    name,
    body.gender === 'male' ? 'male' : 'female',
    age,
    String(body.relationship || ''),
    String(body.allergyNote || body.allergy_note || '无'),
    body.voiceTone || body.voice_tone || 'female_warm',
    ts,
    ts,
  )
  const row = getDb().prepare('SELECT * FROM elder_profiles WHERE id = ?').get(id)
  return c.json({ elder: mapElder(row) }, 201)
})

homes.get('/:homeId/elders', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  const db = getDb()
  let rows
  if (membership.role === 'elder') {
    rows = db.prepare('SELECT * FROM elder_profiles WHERE home_id = ? AND id = ?')
      .all(membership.home_id, membership.elder_profile_id)
  } else {
    rows = db.prepare('SELECT * FROM elder_profiles WHERE home_id = ? ORDER BY created_at ASC')
      .all(membership.home_id)
  }
  return c.json({ elders: rows.map(mapElder) })
})

function mapElder(row) {
  return {
    id: row.id,
    homeId: row.home_id,
    name: row.name,
    gender: row.gender,
    age: row.age,
    relationship: row.relationship,
    allergyNote: row.allergy_note,
    voiceTone: row.voice_tone,
    linkedUserId: row.linked_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export default homes
