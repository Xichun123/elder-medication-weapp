import { getDb, nowIso } from './db.js'
import { HttpError, assert } from './errors.js'
import { newId } from './ids.js'
import { label } from './labels.js'

export const FREQUENCY_TIMES = {
  每日1次: ['早8:00'],
  每日2次: ['早8:00', '晚20:00'],
  每日3次: ['早8:00', '午12:00', '晚20:00'],
}

export function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function reminderMinutes(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number(match[1]) * 60 + Number(match[2])
}

export function generateVoiceText(elderName, drug) {
  const category = label('drug_category', drug.category)
  return category && category !== '其他'
    ? `${elderName}，该服${category}${drug.generic_name}了`
    : `${elderName}，该服${drug.generic_name}了`
}

export function assertElderScope(membership, elderProfileId) {
  if (membership.role === 'elder' && membership.elder_profile_id !== elderProfileId) {
    throw new HttpError(403, '只能访问本人档案')
  }
}

export function getElderInHome(homeId, elderId) {
  const elder = getDb().prepare('SELECT * FROM elder_profiles WHERE id = ? AND home_id = ?').get(elderId, homeId)
  assert(elder, 404, '长辈档案不存在')
  return elder
}

export function getDrugVisible(homeId, drugId) {
  const drug = getDb().prepare(`
    SELECT * FROM drugs
    WHERE id = ? AND (home_id IS NULL OR home_id = ?)
  `).get(drugId, homeId)
  assert(drug, 404, '药物不存在')
  return drug
}

export function mapElder(row, extras = {}) {
  return {
    id: row.id,
    homeId: row.home_id,
    name: row.name,
    gender: row.gender,
    genderLabel: label('gender', row.gender),
    age: row.age,
    relationship: row.relationship,
    allergyNote: row.allergy_note,
    voiceTone: row.voice_tone,
    voiceToneLabel: label('voice_tone', row.voice_tone),
    linkedUserId: row.linked_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras,
  }
}

export function mapDrug(row) {
  return {
    id: row.id,
    homeId: row.home_id,
    isSystem: row.home_id == null,
    genericName: row.generic_name,
    tradeName: row.trade_name,
    aliases: row.aliases,
    category: row.category,
    categoryLabel: label('drug_category', row.category),
    ingredient: row.ingredient,
    dosageText: row.dosage_text,
    contraindicationNote: row.contraindication_note,
    interactionNote: row.interaction_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapRecord(row) {
  return {
    id: row.id,
    homeId: row.home_id,
    elderProfileId: row.elder_profile_id,
    elderName: row.elder_name || '',
    drugId: row.drug_id,
    drugName: row.drug_name || '',
    drugCategory: row.drug_category || 'other',
    drugCategoryLabel: label('drug_category', row.drug_category || 'other'),
    dose: row.dose,
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapReminder(row, today = localDate()) {
  // status 属于当天服药结果；跨天后规则自然恢复为 pending。
  const status = row.status_date === today ? row.status : 'pending'
  return {
    id: row.id,
    homeId: row.home_id,
    elderProfileId: row.elder_profile_id,
    elderName: row.elder_name || '',
    recordId: row.record_id,
    drugName: row.drug_name || '',
    remindTime: row.remind_time,
    status,
    statusLabel: label('reminder_status', status),
    voiceText: row.voice_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapContraindication(row) {
  return {
    id: row.id,
    homeId: row.home_id,
    isSystem: row.home_id == null,
    drugAId: row.drug_a_id,
    drugAName: row.drug_a_name || '',
    drugBId: row.drug_b_id || null,
    drugBName: row.drug_b_name || row.drug_b_text || '',
    drugBText: row.drug_b_text || '',
    contraType: row.contra_type,
    contraTypeLabel: label('contraindication_type', row.contra_type),
    severity: row.severity,
    severityLabel: label('severity', row.severity),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const RECORD_SELECT = `
  SELECT r.*,
    e.name AS elder_name,
    d.generic_name AS drug_name,
    d.category AS drug_category
  FROM medication_records r
  JOIN elder_profiles e ON e.id = r.elder_profile_id
  JOIN drugs d ON d.id = r.drug_id
`

const REMINDER_SELECT = `
  SELECT rm.*,
    e.name AS elder_name,
    d.generic_name AS drug_name
  FROM reminder_rules rm
  JOIN elder_profiles e ON e.id = rm.elder_profile_id
  JOIN medication_records r ON r.id = rm.record_id
  JOIN drugs d ON d.id = r.drug_id
`

const CONTRA_SELECT = `
  SELECT c.*,
    da.generic_name AS drug_a_name,
    db.generic_name AS drug_b_name
  FROM contraindications c
  JOIN drugs da ON da.id = c.drug_a_id
  LEFT JOIN drugs db ON db.id = c.drug_b_id
`

export function getRecord(homeId, recordId) {
  const row = getDb().prepare(`${RECORD_SELECT} WHERE r.id = ? AND r.home_id = ?`).get(recordId, homeId)
  assert(row, 404, '用药记录不存在')
  return row
}

export function getReminder(homeId, reminderId) {
  const today = localDate()
  const row = getDb().prepare(`
    ${REMINDER_SELECT}
    WHERE rm.id = ? AND rm.home_id = ?
      AND r.start_date <= ?
      AND (r.end_date IS NULL OR r.end_date >= ?)
  `).get(reminderId, homeId, today, today)
  assert(row, 404, '提醒不存在或今日不生效')
  return row
}

export function listRecords(homeId, { elderId } = {}) {
  if (elderId) {
    return getDb().prepare(`${RECORD_SELECT} WHERE r.home_id = ? AND r.elder_profile_id = ? ORDER BY r.created_at ASC`)
      .all(homeId, elderId)
      .map(mapRecord)
  }
  return getDb().prepare(`${RECORD_SELECT} WHERE r.home_id = ? ORDER BY r.created_at ASC`)
    .all(homeId)
    .map(mapRecord)
}

export function listReminders(homeId, { elderId, status } = {}) {
  const today = localDate()
  const clauses = [
    'rm.home_id = ?',
    'r.start_date <= ?',
    '(r.end_date IS NULL OR r.end_date >= ?)',
  ]
  const params = [homeId, today, today]
  if (elderId) {
    clauses.push('rm.elder_profile_id = ?')
    params.push(elderId)
  }
  let rows = getDb().prepare(`${REMINDER_SELECT} WHERE ${clauses.join(' AND ')}`)
    .all(...params)
    .map((row) => mapReminder(row, today))
    .sort((a, b) => reminderMinutes(a.remindTime) - reminderMinutes(b.remindTime)
      || String(a.createdAt).localeCompare(String(b.createdAt)))
  if (status) rows = rows.filter((row) => row.status === status)
  return rows
}

export function listDrugs(homeId, { keyword, category } = {}) {
  let rows = getDb().prepare(`
    SELECT * FROM drugs
    WHERE home_id IS NULL OR home_id = ?
    ORDER BY CASE WHEN home_id IS NULL THEN 0 ELSE 1 END, generic_name ASC
  `).all(homeId)

  if (keyword) {
    const needle = String(keyword).trim().toLowerCase()
    rows = rows.filter((row) => [row.generic_name, row.trade_name, row.aliases, row.ingredient]
      .some((value) => String(value || '').toLowerCase().includes(needle)))
  }
  if (category) rows = rows.filter((row) => row.category === category)
  return rows.map(mapDrug)
}

export function listContraindications(homeId, params = {}) {
  let rows = getDb().prepare(`
    ${CONTRA_SELECT}
    WHERE c.home_id IS NULL OR c.home_id = ?
    ORDER BY c.created_at ASC
  `).all(homeId)

  if (params.severity) rows = rows.filter((row) => row.severity === params.severity)
  if (params.contraType) rows = rows.filter((row) => row.contra_type === params.contraType)
  if (params.drugId) {
    rows = rows.filter((row) => row.drug_a_id === params.drugId || row.drug_b_id === params.drugId)
  }
  return rows.map(mapContraindication)
}

export function createRemindersForRecord(record, elder, drug) {
  const db = getDb()
  const times = FREQUENCY_TIMES[record.frequency] || ['早8:00']
  const ts = nowIso()
  const created = []

  times.forEach((remindTime) => {
    const id = newId('T')
    const voiceText = generateVoiceText(elder.name, drug)
    db.prepare(`
      INSERT INTO reminder_rules (
        id, home_id, elder_profile_id, record_id, remind_time, status, status_date,
        voice_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)
    `).run(id, record.home_id, record.elder_profile_id, record.id, remindTime, voiceText, ts, ts)
    created.push(mapReminder({
      id,
      home_id: record.home_id,
      elder_profile_id: record.elder_profile_id,
      elder_name: elder.name,
      record_id: record.id,
      drug_name: drug.generic_name,
      remind_time: remindTime,
      status: 'pending',
      voice_text: voiceText,
      created_at: ts,
      updated_at: ts,
    }))
  })

  return created
}

export function rebuildRemindersForRecord(recordId) {
  const db = getDb()
  const record = db.prepare('SELECT * FROM medication_records WHERE id = ?').get(recordId)
  assert(record, 404, '用药记录不存在')
  const elder = db.prepare('SELECT * FROM elder_profiles WHERE id = ?').get(record.elder_profile_id)
  const drug = db.prepare('SELECT * FROM drugs WHERE id = ?').get(record.drug_id)
  db.prepare('DELETE FROM reminder_rules WHERE record_id = ?').run(recordId)
  return createRemindersForRecord(record, elder, drug)
}

export function buildDashboard(homeId, elderId) {
  const elder = getElderInHome(homeId, elderId)
  const today = localDate()
  const records = getDb().prepare(`
    ${RECORD_SELECT}
    WHERE r.home_id = ? AND r.elder_profile_id = ?
      AND r.start_date <= ?
      AND (r.end_date IS NULL OR r.end_date >= ?)
  `).all(homeId, elderId, today, today)
  const drugIds = new Set(records.map((item) => item.drug_id))
  const medications = records.map((record) => ({
    recordId: record.id,
    drugId: record.drug_id,
    drugName: record.drug_name,
    category: record.drug_category,
    categoryLabel: label('drug_category', record.drug_category),
    dose: record.dose,
    frequency: record.frequency,
  }))

  const contraRows = getDb().prepare(`
    ${CONTRA_SELECT}
    WHERE (c.home_id IS NULL OR c.home_id = ?)
  `).all(homeId)

  const risks = contraRows
    .filter((item) => drugIds.has(item.drug_a_id) || (item.drug_b_id && drugIds.has(item.drug_b_id)))
    .map((item) => {
      const bothTaken = Boolean(item.drug_b_id) && drugIds.has(item.drug_a_id) && drugIds.has(item.drug_b_id)
      return {
        ...mapContraindication(item),
        drugBIsFood: !item.drug_b_id,
        relevance: item.drug_b_id
          ? (bothTaken ? '同时服用中' : '注意未同时服用')
          : '饮食注意事项',
      }
    })
    .sort((a, b) => {
      const order = { severe: 0, middle: 1, light: 2 }
      return order[a.severity] - order[b.severity]
    })

  return {
    elder: mapElder(elder),
    medications,
    risks,
    stats: {
      total: risks.length,
      severe: risks.filter((item) => item.severity === 'severe').length,
      middle: risks.filter((item) => item.severity === 'middle').length,
      light: risks.filter((item) => item.severity === 'light').length,
    },
  }
}

export function buildOverview(homeId, membership) {
  const db = getDb()
  const home = db.prepare('SELECT * FROM homes WHERE id = ?').get(homeId)
  let elders
  if (membership.role === 'elder') {
    elders = db.prepare('SELECT * FROM elder_profiles WHERE home_id = ? AND id = ?')
      .all(homeId, membership.elder_profile_id)
  } else {
    elders = db.prepare('SELECT * FROM elder_profiles WHERE home_id = ? ORDER BY created_at ASC').all(homeId)
  }

  const elderSummaries = elders.map((elder) => {
    const dashboard = buildDashboard(homeId, elder.id)
    const reminderPendingCount = listReminders(homeId, {
      elderId: elder.id,
      status: 'pending',
    }).length
    return {
      ...mapElder(elder),
      medicationCount: dashboard.medications.length,
      reminderPendingCount,
      contraindicationCount: dashboard.stats.total,
    }
  })

  return {
    home: {
      id: home.id,
      name: home.name,
      myRole: membership.role,
      myElderProfileId: membership.elder_profile_id || null,
    },
    elders: elderSummaries,
    stats: {
      elderCount: elderSummaries.length,
      medicationCount: elderSummaries.reduce((sum, item) => sum + item.medicationCount, 0),
      reminderPendingCount: elderSummaries.reduce((sum, item) => sum + item.reminderPendingCount, 0),
      contraindicationCount: elderSummaries.reduce((sum, item) => sum + item.contraindicationCount, 0),
    },
  }
}
