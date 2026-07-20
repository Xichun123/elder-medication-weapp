import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  assertElderScope,
  buildDashboard,
  buildOverview,
  createRemindersForRecord,
  generateVoiceText,
  getDrugVisible,
  getElderInHome,
  getRecord,
  getReminder,
  listContraindications,
  listDrugs,
  listRecords,
  listReminders,
  localDate,
  mapContraindication,
  mapDrug,
  mapElder,
  mapRecord,
  mapReminder,
  rebuildRemindersForRecord,
} from '../domain.js'
import { getDb, nowIso } from '../db.js'
import { HttpError, assert } from '../errors.js'
import { newId } from '../ids.js'
import { requireAuth, requireHomeMember } from '../middleware.js'
import { recognizeMedicationImage } from '../recognition.js'

const resources = new Hono()
resources.use('*', requireAuth)

const recognitionUsage = new Map()
const RECOGNITION_WINDOW_MS = 60 * 60 * 1000
const RECOGNITION_COOLDOWN_MS = 10 * 1000
const RECOGNITION_MAX_PER_HOUR = 10

async function requireRecognitionQuota(c, next) {
  const user = c.get('user')
  const key = `${c.req.param('homeId')}:${user.id}`
  const now = Date.now()
  const recent = (recognitionUsage.get(key) || []).filter((timestamp) => now - timestamp < RECOGNITION_WINDOW_MS)
  if (recent.length && now - recent[recent.length - 1] < RECOGNITION_COOLDOWN_MS) {
    return c.json({ error: '操作太频繁，请 10 秒后再试' }, 429)
  }
  if (recent.length >= RECOGNITION_MAX_PER_HOUR) {
    return c.json({ error: '本小时识别次数已用完，请稍后再试' }, 429)
  }
  recognitionUsage.set(key, [...recent, now])
  await next()
}

function parseOptionalDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value)
  assert(/^\d{4}-\d{2}-\d{2}$/.test(text), 400, `${fieldName} 格式应为 YYYY-MM-DD`)
  return text
}

// ── Overview ──────────────────────────────────────────────
resources.get('/:homeId/overview', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  return c.json(buildOverview(membership.home_id, membership))
})

// ── Elders patch/delete ───────────────────────────────────
resources.patch('/:homeId/elders/:elderId', requireHomeMember('caregiver_edit'), async (c) => {
  const membership = c.get('membership')
  const elderId = c.req.param('elderId')
  const elder = getElderInHome(membership.home_id, elderId)
  const body = await c.req.json().catch(() => ({}))

  const name = body.name !== undefined ? String(body.name || '').trim() : elder.name
  const age = body.age !== undefined ? Number(body.age) : elder.age
  assert(name, 400, '姓名不能为空')
  assert(name.length <= 50, 400, '姓名不能超过 50 个字符')
  assert(Number.isInteger(age) && age >= 1 && age <= 130, 400, '年龄必须是 1-130 的整数')

  const gender = body.gender !== undefined
    ? (body.gender === 'male' ? 'male' : 'female')
    : elder.gender
  const relationship = body.relationship !== undefined
    ? String(body.relationship || '')
    : elder.relationship
  const allergyNote = body.allergyNote !== undefined || body.allergy_note !== undefined
    ? String(body.allergyNote ?? body.allergy_note ?? '无')
    : elder.allergy_note
  const voiceTone = body.voiceTone !== undefined || body.voice_tone !== undefined
    ? String(body.voiceTone ?? body.voice_tone ?? 'female_warm')
    : elder.voice_tone

  const ts = nowIso()
  getDb().prepare(`
    UPDATE elder_profiles
    SET name = ?, gender = ?, age = ?, relationship = ?, allergy_note = ?, voice_tone = ?, updated_at = ?
    WHERE id = ? AND home_id = ?
  `).run(name, gender, age, relationship, allergyNote, voiceTone, ts, elderId, membership.home_id)

  const row = getDb().prepare('SELECT * FROM elder_profiles WHERE id = ?').get(elderId)
  return c.json({ elder: mapElder(row) })
})

resources.delete('/:homeId/elders/:elderId', requireHomeMember('caregiver_edit'), (c) => {
  const membership = c.get('membership')
  const elderId = c.req.param('elderId')
  getElderInHome(membership.home_id, elderId)

  const db = getDb()
  const tx = db.transaction(() => {
    // 移除绑定该档案的老人成员；邀请一并清理；记录/提醒靠 FK CASCADE。
    db.prepare(`
      DELETE FROM memberships
      WHERE home_id = ? AND elder_profile_id = ? AND role = 'elder'
    `).run(membership.home_id, elderId)
    db.prepare('DELETE FROM invites WHERE home_id = ? AND elder_profile_id = ?')
      .run(membership.home_id, elderId)
    db.prepare('DELETE FROM elder_profiles WHERE id = ? AND home_id = ?')
      .run(elderId, membership.home_id)
  })
  tx()
  return c.json({ ok: true })
})

// ── Drugs ─────────────────────────────────────────────────
resources.get('/:homeId/drugs', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  if (membership.role === 'elder') return c.json({ error: '权限不足' }, 403)
  const keyword = c.req.query('keyword') || ''
  const category = c.req.query('category') || ''
  return c.json({ drugs: listDrugs(membership.home_id, { keyword, category }) })
})

resources.get('/:homeId/drugs/:drugId', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  if (membership.role === 'elder') return c.json({ error: '权限不足' }, 403)
  const drug = getDrugVisible(membership.home_id, c.req.param('drugId'))
  return c.json({ drug: mapDrug(drug) })
})

resources.post('/:homeId/drugs', requireHomeMember('caregiver_edit'), async (c) => {
  const membership = c.get('membership')
  const body = await c.req.json().catch(() => ({}))
  const genericName = String(body.genericName || body.generic_name || '').trim()
  assert(genericName, 400, '通用名不能为空')
  assert(genericName.length <= 80, 400, '通用名过长')

  const ts = nowIso()
  const id = newId('D')
  getDb().prepare(`
    INSERT INTO drugs (
      id, home_id, generic_name, trade_name, aliases, category, ingredient,
      dosage_text, contraindication_note, interaction_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    membership.home_id,
    genericName,
    String(body.tradeName || body.trade_name || ''),
    String(body.aliases || ''),
    String(body.category || 'other'),
    String(body.ingredient || ''),
    String(body.dosageText || body.dosage_text || ''),
    String(body.contraindicationNote || body.contraindication_note || ''),
    String(body.interactionNote || body.interaction_note || ''),
    ts,
    ts,
  )
  return c.json({ drug: mapDrug(getDb().prepare('SELECT * FROM drugs WHERE id = ?').get(id)) }, 201)
})

resources.patch('/:homeId/drugs/:drugId', requireHomeMember('caregiver_edit'), async (c) => {
  const membership = c.get('membership')
  const drugId = c.req.param('drugId')
  const drug = getDb().prepare('SELECT * FROM drugs WHERE id = ? AND home_id = ?').get(drugId, membership.home_id)
  assert(drug, 404, '只能修改本家庭药物，或药物不存在')
  const body = await c.req.json().catch(() => ({}))

  const genericName = body.genericName !== undefined || body.generic_name !== undefined
    ? String(body.genericName ?? body.generic_name ?? '').trim()
    : drug.generic_name
  assert(genericName, 400, '通用名不能为空')

  const ts = nowIso()
  getDb().prepare(`
    UPDATE drugs SET
      generic_name = ?,
      trade_name = ?,
      aliases = ?,
      category = ?,
      ingredient = ?,
      dosage_text = ?,
      contraindication_note = ?,
      interaction_note = ?,
      updated_at = ?
    WHERE id = ? AND home_id = ?
  `).run(
    genericName,
    body.tradeName !== undefined || body.trade_name !== undefined
      ? String(body.tradeName ?? body.trade_name ?? '')
      : drug.trade_name,
    body.aliases !== undefined ? String(body.aliases || '') : drug.aliases,
    body.category !== undefined ? String(body.category || 'other') : drug.category,
    body.ingredient !== undefined ? String(body.ingredient || '') : drug.ingredient,
    body.dosageText !== undefined || body.dosage_text !== undefined
      ? String(body.dosageText ?? body.dosage_text ?? '')
      : drug.dosage_text,
    body.contraindicationNote !== undefined || body.contraindication_note !== undefined
      ? String(body.contraindicationNote ?? body.contraindication_note ?? '')
      : drug.contraindication_note,
    body.interactionNote !== undefined || body.interaction_note !== undefined
      ? String(body.interactionNote ?? body.interaction_note ?? '')
      : drug.interaction_note,
    ts,
    drugId,
    membership.home_id,
  )
  return c.json({ drug: mapDrug(getDb().prepare('SELECT * FROM drugs WHERE id = ?').get(drugId)) })
})

resources.delete('/:homeId/drugs/:drugId', requireHomeMember('caregiver_edit'), (c) => {
  const membership = c.get('membership')
  const drugId = c.req.param('drugId')
  const drug = getDb().prepare('SELECT * FROM drugs WHERE id = ? AND home_id = ?').get(drugId, membership.home_id)
  assert(drug, 404, '只能删除本家庭药物，或药物不存在')

  const used = getDb().prepare('SELECT 1 FROM medication_records WHERE drug_id = ? LIMIT 1').get(drugId)
  assert(!used, 409, '该药物已被用药记录引用，无法删除')

  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM contraindications WHERE drug_a_id = ? OR drug_b_id = ?').run(drugId, drugId)
    db.prepare('DELETE FROM drugs WHERE id = ? AND home_id = ?').run(drugId, membership.home_id)
  })
  tx()
  return c.json({ ok: true })
})

// ── AI medication package recognition ─────────────────────
resources.post(
  '/:homeId/recognitions/medication',
  requireHomeMember('caregiver_edit'),
  bodyLimit({
    maxSize: 6 * 1024 * 1024,
    onError: (c) => c.json({ error: '图片和表单总大小不能超过 6MB' }, 413),
  }),
  requireRecognitionQuota,
  async (c) => {
    const body = await c.req.parseBody().catch(() => ({}))
    const recognition = await recognizeMedicationImage(body.image)
    return c.json({ recognition })
  },
)

// ── Records ───────────────────────────────────────────────
resources.get('/:homeId/records', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  const elderId = c.req.query('elderId') || c.req.query('elder') || ''
  if (membership.role === 'elder') {
    return c.json({ records: listRecords(membership.home_id, { elderId: membership.elder_profile_id }) })
  }
  if (elderId) {
    getElderInHome(membership.home_id, elderId)
    return c.json({ records: listRecords(membership.home_id, { elderId }) })
  }
  return c.json({ records: listRecords(membership.home_id) })
})

resources.get('/:homeId/records/:recordId', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  const row = getRecord(membership.home_id, c.req.param('recordId'))
  assertElderScope(membership, row.elder_profile_id)
  return c.json({ record: mapRecord(row) })
})

resources.post('/:homeId/records', requireHomeMember('caregiver_edit'), async (c) => {
  const membership = c.get('membership')
  const body = await c.req.json().catch(() => ({}))
  const elderId = String(body.elderProfileId || body.elder || '')
  const drugId = String(body.drugId || body.drug || '')
  const dose = String(body.dose || '').trim()
  const frequency = String(body.frequency || '').trim()
  const startDate = parseOptionalDate(body.startDate ?? body.start_date, 'startDate')
  const endDate = parseOptionalDate(body.endDate ?? body.end_date, 'endDate')

  assert(elderId, 400, '长辈不能为空')
  assert(drugId, 400, '药物不能为空')
  assert(dose, 400, '剂量不能为空')
  assert(frequency, 400, '频次不能为空')
  assert(startDate, 400, '开始日期不能为空')

  const elder = getElderInHome(membership.home_id, elderId)
  const drug = getDrugVisible(membership.home_id, drugId)

  const ts = nowIso()
  const id = newId('R')
  const db = getDb()
  let autoCreated = []
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO medication_records (
        id, home_id, elder_profile_id, drug_id, dose, frequency, start_date, end_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, membership.home_id, elderId, drugId, dose, frequency, startDate, endDate, ts, ts)
    const record = db.prepare('SELECT * FROM medication_records WHERE id = ?').get(id)
    autoCreated = createRemindersForRecord(record, elder, drug)
  })
  tx()

  return c.json({
    record: mapRecord(getRecord(membership.home_id, id)),
    autoCreatedReminders: autoCreated,
  }, 201)
})

resources.patch('/:homeId/records/:recordId', requireHomeMember('caregiver_edit'), async (c) => {
  const membership = c.get('membership')
  const recordId = c.req.param('recordId')
  const previous = getDb().prepare('SELECT * FROM medication_records WHERE id = ? AND home_id = ?')
    .get(recordId, membership.home_id)
  assert(previous, 404, '用药记录不存在')

  const body = await c.req.json().catch(() => ({}))
  const dose = body.dose !== undefined ? String(body.dose || '').trim() : previous.dose
  const frequency = body.frequency !== undefined ? String(body.frequency || '').trim() : previous.frequency
  const startDate = body.startDate !== undefined || body.start_date !== undefined
    ? parseOptionalDate(body.startDate ?? body.start_date, 'startDate')
    : previous.start_date
  const endDate = body.endDate !== undefined || body.end_date !== undefined
    ? parseOptionalDate(body.endDate ?? body.end_date, 'endDate')
    : previous.end_date

  assert(dose, 400, '剂量不能为空')
  assert(frequency, 400, '频次不能为空')
  assert(startDate, 400, '开始日期不能为空')

  const frequencyChanged = frequency !== previous.frequency
  const ts = nowIso()
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE medication_records
      SET dose = ?, frequency = ?, start_date = ?, end_date = ?, updated_at = ?
      WHERE id = ? AND home_id = ?
    `).run(dose, frequency, startDate, endDate, ts, recordId, membership.home_id)
    if (frequencyChanged) rebuildRemindersForRecord(recordId)
  })
  tx()

  return c.json({ record: mapRecord(getRecord(membership.home_id, recordId)) })
})

resources.delete('/:homeId/records/:recordId', requireHomeMember('caregiver_edit'), (c) => {
  const membership = c.get('membership')
  const recordId = c.req.param('recordId')
  const previous = getDb().prepare('SELECT * FROM medication_records WHERE id = ? AND home_id = ?')
    .get(recordId, membership.home_id)
  assert(previous, 404, '用药记录不存在')
  // reminder_rules 有 ON DELETE CASCADE
  getDb().prepare('DELETE FROM medication_records WHERE id = ? AND home_id = ?')
    .run(recordId, membership.home_id)
  return c.json({ ok: true })
})

// ── Reminders ─────────────────────────────────────────────
resources.get('/:homeId/reminders', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  const elderId = c.req.query('elderId') || c.req.query('elder') || ''
  const status = c.req.query('status') || ''
  if (membership.role === 'elder') {
    return c.json({
      reminders: listReminders(membership.home_id, {
        elderId: membership.elder_profile_id,
        status: status || undefined,
      }),
    })
  }
  if (elderId) getElderInHome(membership.home_id, elderId)
  return c.json({
    reminders: listReminders(membership.home_id, {
      elderId: elderId || undefined,
      status: status || undefined,
    }),
  })
})

resources.get('/:homeId/reminders/:reminderId', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  const row = getReminder(membership.home_id, c.req.param('reminderId'))
  assertElderScope(membership, row.elder_profile_id)
  return c.json({ reminder: mapReminder(row) })
})

function updateReminderStatus(c, status) {
  const membership = c.get('membership')
  const reminderId = c.req.param('reminderId')
  const row = getReminder(membership.home_id, reminderId)
  assertElderScope(membership, row.elder_profile_id)

  // 老人可确认本人已服/跳过；只读家属禁止写。
  if (membership.role === 'caregiver_view') throw new HttpError(403, '权限不足')
  if (membership.role === 'elder' && membership.elder_profile_id !== row.elder_profile_id) {
    throw new HttpError(403, '只能操作本人提醒')
  }
  if (!['owner', 'caregiver_edit', 'elder'].includes(membership.role)) {
    throw new HttpError(403, '权限不足')
  }

  const ts = nowIso()
  getDb().prepare(`
    UPDATE reminder_rules SET status = ?, status_date = ?, updated_at = ?
    WHERE id = ? AND home_id = ?
  `).run(status, localDate(), ts, reminderId, membership.home_id)
  return c.json({ reminder: mapReminder(getReminder(membership.home_id, reminderId)) })
}

resources.post('/:homeId/reminders/:reminderId/take', requireHomeMember('caregiver_view'), (c) => updateReminderStatus(c, 'taken'))
resources.post('/:homeId/reminders/:reminderId/skip', requireHomeMember('caregiver_view'), (c) => updateReminderStatus(c, 'skipped'))

resources.post('/:homeId/reminders/:reminderId/regenerate-voice', requireHomeMember('caregiver_edit'), (c) => {
  const membership = c.get('membership')
  const reminderId = c.req.param('reminderId')
  const row = getReminder(membership.home_id, reminderId)
  const elder = getElderInHome(membership.home_id, row.elder_profile_id)
  const record = getDb().prepare('SELECT * FROM medication_records WHERE id = ?').get(row.record_id)
  const drug = getDb().prepare('SELECT * FROM drugs WHERE id = ?').get(record.drug_id)
  const voiceText = generateVoiceText(elder.name, drug)
  const ts = nowIso()
  getDb().prepare(`
    UPDATE reminder_rules SET voice_text = ?, updated_at = ?
    WHERE id = ? AND home_id = ?
  `).run(voiceText, ts, reminderId, membership.home_id)
  return c.json({ reminder: mapReminder(getReminder(membership.home_id, reminderId)) })
})

// ── Dashboard / contraindications ─────────────────────────
resources.get('/:homeId/elders/:elderId/dashboard', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  const elderId = c.req.param('elderId')
  assertElderScope(membership, elderId)
  getElderInHome(membership.home_id, elderId)
  return c.json(buildDashboard(membership.home_id, elderId))
})

resources.get('/:homeId/contraindications', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  if (membership.role === 'elder') return c.json({ error: '权限不足' }, 403)
  return c.json({
    contraindications: listContraindications(membership.home_id, {
      severity: c.req.query('severity') || undefined,
      contraType: c.req.query('contraType') || c.req.query('contra_type') || undefined,
      drugId: c.req.query('drugId') || c.req.query('drug') || undefined,
    }),
  })
})

resources.post('/:homeId/contraindications', requireHomeMember('caregiver_edit'), async (c) => {
  const membership = c.get('membership')
  const body = await c.req.json().catch(() => ({}))
  const drugAId = String(body.drugAId || body.drug_a || '')
  const drugBId = body.drugBId || body.drug_b ? String(body.drugBId || body.drug_b) : null
  const drugBText = String(body.drugBText || body.drug_b_text || '')
  const contraType = String(body.contraType || body.contra_type || '')
  const severity = String(body.severity || '')
  const note = String(body.note || '')

  assert(drugAId, 400, 'drugAId 不能为空')
  assert(contraType, 400, 'contraType 不能为空')
  assert(['co_administration', 'diet', 'disease'].includes(contraType), 400, '无效的禁忌类型')
  assert(['light', 'middle', 'severe'].includes(severity), 400, '无效的严重程度')
  assert(drugBId || drugBText, 400, '必须指定 drugBId 或 drugBText')
  getDrugVisible(membership.home_id, drugAId)
  if (drugBId) getDrugVisible(membership.home_id, drugBId)

  const ts = nowIso()
  const id = newId('C')
  getDb().prepare(`
    INSERT INTO contraindications (
      id, home_id, drug_a_id, drug_b_id, drug_b_text, contra_type, severity, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, membership.home_id, drugAId, drugBId, drugBId ? '' : drugBText, contraType, severity, note, ts, ts)

  const row = getDb().prepare(`
    SELECT c.*, da.generic_name AS drug_a_name, db.generic_name AS drug_b_name
    FROM contraindications c
    JOIN drugs da ON da.id = c.drug_a_id
    LEFT JOIN drugs db ON db.id = c.drug_b_id
    WHERE c.id = ?
  `).get(id)
  return c.json({ contraindication: mapContraindication(row) }, 201)
})

resources.patch('/:homeId/contraindications/:contraId', requireHomeMember('caregiver_edit'), async (c) => {
  const membership = c.get('membership')
  const contraId = c.req.param('contraId')
  const existing = getDb().prepare('SELECT * FROM contraindications WHERE id = ? AND home_id = ?')
    .get(contraId, membership.home_id)
  assert(existing, 404, '只能修改本家庭禁忌，或不存在')
  const body = await c.req.json().catch(() => ({}))

  const drugAId = body.drugAId !== undefined || body.drug_a !== undefined
    ? String(body.drugAId ?? body.drug_a ?? '')
    : existing.drug_a_id
  let drugBId = existing.drug_b_id
  let drugBText = existing.drug_b_text
  if (body.drugBId !== undefined || body.drug_b !== undefined) {
    drugBId = body.drugBId || body.drug_b ? String(body.drugBId || body.drug_b) : null
  }
  if (body.drugBText !== undefined || body.drug_b_text !== undefined) {
    drugBText = String(body.drugBText ?? body.drug_b_text ?? '')
  }
  const contraType = body.contraType !== undefined || body.contra_type !== undefined
    ? String(body.contraType ?? body.contra_type ?? '')
    : existing.contra_type
  const severity = body.severity !== undefined ? String(body.severity || '') : existing.severity
  const note = body.note !== undefined ? String(body.note || '') : existing.note

  assert(drugAId, 400, 'drugAId 不能为空')
  assert(['co_administration', 'diet', 'disease'].includes(contraType), 400, '无效的禁忌类型')
  assert(['light', 'middle', 'severe'].includes(severity), 400, '无效的严重程度')
  assert(drugBId || drugBText, 400, '必须指定 drugBId 或 drugBText')
  getDrugVisible(membership.home_id, drugAId)
  if (drugBId) getDrugVisible(membership.home_id, drugBId)

  const ts = nowIso()
  getDb().prepare(`
    UPDATE contraindications
    SET drug_a_id = ?, drug_b_id = ?, drug_b_text = ?, contra_type = ?, severity = ?, note = ?, updated_at = ?
    WHERE id = ? AND home_id = ?
  `).run(drugAId, drugBId, drugBId ? '' : drugBText, contraType, severity, note, ts, contraId, membership.home_id)

  const row = getDb().prepare(`
    SELECT c.*, da.generic_name AS drug_a_name, db.generic_name AS drug_b_name
    FROM contraindications c
    JOIN drugs da ON da.id = c.drug_a_id
    LEFT JOIN drugs db ON db.id = c.drug_b_id
    WHERE c.id = ?
  `).get(contraId)
  return c.json({ contraindication: mapContraindication(row) })
})

resources.delete('/:homeId/contraindications/:contraId', requireHomeMember('caregiver_edit'), (c) => {
  const membership = c.get('membership')
  const contraId = c.req.param('contraId')
  const existing = getDb().prepare('SELECT * FROM contraindications WHERE id = ? AND home_id = ?')
    .get(contraId, membership.home_id)
  assert(existing, 404, '只能删除本家庭禁忌，或不存在')
  getDb().prepare('DELETE FROM contraindications WHERE id = ? AND home_id = ?')
    .run(contraId, membership.home_id)
  return c.json({ ok: true })
})

// ── Member / invite management (owner) ────────────────────
resources.get('/:homeId/invites', requireHomeMember('owner'), (c) => {
  const membership = c.get('membership')
  const rows = getDb().prepare(`
    SELECT * FROM invites
    WHERE home_id = ?
    ORDER BY created_at DESC
  `).all(membership.home_id)
  return c.json({
    invites: rows.map((row) => ({
      id: row.id,
      code: row.code,
      role: row.role,
      elderProfileId: row.elder_profile_id,
      expiresAt: row.expires_at,
      usedBy: row.used_by,
      usedAt: row.used_at,
      createdAt: row.created_at,
      status: row.used_by
        ? 'used'
        : (new Date(row.expires_at).getTime() > Date.now() ? 'active' : 'expired'),
    })),
  })
})

resources.delete('/:homeId/invites/:inviteId', requireHomeMember('owner'), (c) => {
  const membership = c.get('membership')
  const inviteId = c.req.param('inviteId')
  const invite = getDb().prepare('SELECT * FROM invites WHERE id = ? AND home_id = ?')
    .get(inviteId, membership.home_id)
  assert(invite, 404, '邀请不存在')
  assert(!invite.used_by, 409, '邀请已使用，无法撤销')
  getDb().prepare('DELETE FROM invites WHERE id = ? AND home_id = ?').run(inviteId, membership.home_id)
  return c.json({ ok: true })
})

resources.patch('/:homeId/members/:memberId', requireHomeMember('owner'), async (c) => {
  const membership = c.get('membership')
  const memberId = c.req.param('memberId')
  const target = getDb().prepare('SELECT * FROM memberships WHERE id = ? AND home_id = ?')
    .get(memberId, membership.home_id)
  assert(target, 404, '成员不存在')
  assert(target.role !== 'owner', 400, '不能修改创建人角色')
  assert(target.role !== 'elder', 400, '不能修改老人角色')

  const body = await c.req.json().catch(() => ({}))
  const role = String(body.role || '')
  assert(['caregiver_edit', 'caregiver_view'].includes(role), 400, '只能改为可录入或只读家属')

  getDb().prepare('UPDATE memberships SET role = ? WHERE id = ? AND home_id = ?')
    .run(role, memberId, membership.home_id)

  const row = getDb().prepare(`
    SELECT m.*, u.nickname, u.avatar_url
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.id = ?
  `).get(memberId)

  return c.json({
    member: {
      id: row.id,
      userId: row.user_id,
      role: row.role,
      elderProfileId: row.elder_profile_id,
      nickname: row.nickname,
      avatarUrl: row.avatar_url,
      joinedAt: row.created_at,
    },
  })
})

resources.delete('/:homeId/members/:memberId', requireHomeMember('owner'), (c) => {
  const membership = c.get('membership')
  const memberId = c.req.param('memberId')
  const target = getDb().prepare('SELECT * FROM memberships WHERE id = ? AND home_id = ?')
    .get(memberId, membership.home_id)
  assert(target, 404, '成员不存在')
  assert(target.role !== 'owner', 400, '不能移除家庭创建人')
  assert(target.user_id !== membership.user_id, 400, '不能移除自己')

  const db = getDb()
  const tx = db.transaction(() => {
    if (target.role === 'elder' && target.elder_profile_id) {
      db.prepare(`
        UPDATE elder_profiles SET linked_user_id = NULL, updated_at = ?
        WHERE id = ? AND home_id = ?
      `).run(nowIso(), target.elder_profile_id, membership.home_id)
    }
    db.prepare('DELETE FROM memberships WHERE id = ? AND home_id = ?')
      .run(memberId, membership.home_id)
  })
  tx()
  return c.json({ ok: true })
})

export default resources
