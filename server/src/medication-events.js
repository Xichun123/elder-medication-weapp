import { getDb, nowIso } from './db.js'
import { HttpError, assert } from './errors.js'
import { newId } from './ids.js'
import { localDate } from './domain.js'

const WRITE_ROLES = new Set(['owner', 'caregiver_edit', 'elder'])

export function assertMedicationWriteRole(membership) {
  if (!WRITE_ROLES.has(membership.role)) throw new HttpError(403, '当前角色没有修改服药状态的权限')
}

export function getReminderForConfirmation(homeId, reminderId, database = getDb()) {
  const row = database.prepare(`
    SELECT rm.*, r.start_date, r.end_date, r.dose,
      d.id AS drug_id, d.generic_name AS drug_name,
      d.primary_package_image_url,
      e.name AS elder_name
    FROM reminder_rules rm
    JOIN medication_records r ON r.id = rm.record_id
    JOIN drugs d ON d.id = r.drug_id
    JOIN elder_profiles e ON e.id = rm.elder_profile_id
    WHERE rm.id = ? AND rm.home_id = ?
  `).get(reminderId, homeId)
  assert(row, 404, '服药提醒不存在')
  return row
}

export function assertReminderConfirmable({ database = getDb(), homeId, reminderId, membership, today = localDate() }) {
  assertMedicationWriteRole(membership)
  const row = getReminderForConfirmation(homeId, reminderId, database)
  if (membership.role === 'elder' && membership.elder_profile_id !== row.elder_profile_id) {
    throw new HttpError(403, '老人只能确认本人的服药提醒')
  }
  if (row.start_date > today || (row.end_date && row.end_date < today)) {
    throw new HttpError(409, '该用药记录当前不在有效期内')
  }
  const status = row.status_date === today ? row.status : 'pending'
  if (status !== 'pending') throw new HttpError(409, `该提醒今天已标记为${status === 'taken' ? '已服' : '跳过'}`)
  return row
}

export function listConfirmableReminders(homeId, elderId, database = getDb(), today = localDate()) {
  return database.prepare(`
    SELECT rm.id AS reminder_id, rm.remind_time, rm.elder_profile_id, rm.record_id,
      r.dose, d.generic_name AS drug_name, d.primary_package_image_url
    FROM reminder_rules rm
    JOIN medication_records r ON r.id = rm.record_id
    JOIN drugs d ON d.id = r.drug_id
    WHERE rm.home_id = ? AND rm.elder_profile_id = ?
      AND r.start_date <= ? AND (r.end_date IS NULL OR r.end_date >= ?)
      AND (rm.status_date IS NULL OR rm.status_date <> ? OR rm.status = 'pending')
    ORDER BY rm.remind_time, d.generic_name
  `).all(homeId, elderId, today, today, today)
}

export function applyMedicationStatus(database, {
  homeId,
  reminderId,
  membership,
  actorUserId,
  status,
  source = 'manual',
  pendingActionId = null,
  today = localDate(),
}) {
  if (!['taken', 'skipped'].includes(status)) throw new HttpError(400, '不支持的服药状态')
  const existing = database.prepare(`
    SELECT * FROM medication_events WHERE reminder_id = ? AND occurrence_date = ?
  `).get(reminderId, today)
  if (existing) {
    if (existing.event_type !== status) throw new HttpError(409, '该提醒今天已有不同的服药结果')
    return { row: getReminderForConfirmation(homeId, reminderId, database), event: existing, idempotent: true }
  }

  const row = assertReminderConfirmable({ database, homeId, reminderId, membership, today })
  const ts = nowIso()
  const eventId = newId('EV')
  database.prepare(`
    INSERT INTO medication_events (
      id, home_id, elder_profile_id, reminder_id, record_id, drug_id,
      drug_name_snapshot, dose_snapshot, remind_time_snapshot, actor_user_id,
      event_type, occurrence_date, occurred_at, source, pending_action_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId, homeId, row.elder_profile_id, reminderId, row.record_id, row.drug_id,
    row.drug_name, row.dose, row.remind_time, actorUserId,
    status, today, ts, source, pendingActionId, ts,
  )
  database.prepare('UPDATE reminder_rules SET status = ?, status_date = ?, updated_at = ? WHERE id = ?')
    .run(status, today, ts, reminderId)
  return {
    row: getReminderForConfirmation(homeId, reminderId, database),
    event: database.prepare('SELECT * FROM medication_events WHERE id = ?').get(eventId),
    idempotent: false,
  }
}

export function confirmMedicationStatus(args) {
  const database = getDb()
  let result
  database.transaction(() => { result = applyMedicationStatus(database, args) })()
  return result
}

export function getMedicationAdherence(homeId, elderId, days = 30, database = getDb()) {
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 90))
  const since = localDate(new Date(Date.now() - (safeDays - 1) * 86_400_000))
  const elderFilter = elderId ? 'AND me.elder_profile_id = ?' : ''
  const params = [homeId, since]
  if (elderId) params.push(elderId)
  const rows = database.prepare(`
    SELECT e.name AS elder_name,
      SUM(CASE WHEN me.event_type = 'taken' THEN 1 ELSE 0 END) AS taken,
      SUM(CASE WHEN me.event_type = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      COUNT(*) AS total
    FROM medication_events me
    JOIN elder_profiles e ON e.id = me.elder_profile_id
    WHERE me.home_id = ? AND me.occurrence_date >= ? ${elderFilter}
    GROUP BY me.elder_profile_id
    ORDER BY e.name
  `).all(...params)
  return {
    days: safeDays,
    since,
    rows: rows.map((row) => ({
      elderName: row.elder_name,
      taken: Number(row.taken || 0),
      skipped: Number(row.skipped || 0),
      missed: Number(row.skipped || 0),
      total: Number(row.total || 0),
    })),
  }
}
