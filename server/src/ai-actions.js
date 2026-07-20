import { config } from './config.js'
import { getDb, nowIso } from './db.js'
import { HttpError, assert } from './errors.js'
import { newId } from './ids.js'
import {
  applyMedicationStatus,
  assertMedicationWriteRole,
  assertReminderConfirmable,
  listConfirmableReminders,
} from './medication-events.js'

const SAFETY_WARNING = '请核对药品包装、药名、剂量和提醒时间；不要仅凭散装药片外观判断药品。'

function parsePayload(row) {
  try { return JSON.parse(row.payload_json || '{}') } catch { return {} }
}

function assertElderScope(membership, elderId) {
  if (membership.role === 'elder' && membership.elder_profile_id !== elderId) {
    throw new HttpError(403, '老人只能操作本人档案')
  }
}

function audit(database, action, userId, eventType, detail = '') {
  database.prepare(`
    INSERT INTO ai_action_audits (id, action_id, home_id, user_id, event_type, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(newId('AUD'), action.id, action.home_id, userId, eventType, detail, nowIso())
}

function toReminderCard(row) {
  return {
    reminderId: row.reminder_id || row.id,
    drugName: row.drug_name,
    dose: row.dose,
    remindTime: row.remind_time,
    packageImageUrl: row.primary_package_image_url || '',
    hasPackageImage: Boolean(row.primary_package_image_url),
    safetyWarning: SAFETY_WARNING,
  }
}

export function buildMarkTakenProposal(homeId, membership, elderId) {
  assertMedicationWriteRole(membership)
  assertElderScope(membership, elderId)
  const reminders = listConfirmableReminders(homeId, elderId)
  if (!reminders.length) return { kind: 'none', message: '今天没有可确认的待服提醒。' }
  if (reminders.length > 1) {
    return {
      kind: 'ambiguous',
      message: '找到多个待服提醒，请老人明确选择刚刚服用的药品。',
      candidates: reminders.map(toReminderCard),
    }
  }
  return { kind: 'draft', actionType: 'mark_taken', elderId, reminderId: reminders[0].reminder_id }
}

export function buildSymptomProposal(membership, elderId, symptom, severity = 'normal') {
  assertMedicationWriteRole(membership)
  assertElderScope(membership, elderId)
  const text = String(symptom || '').trim().slice(0, 120)
  assert(text, 400, '没有识别到具体症状')
  return {
    kind: 'draft',
    actionType: 'record_symptom',
    elderId,
    payload: { symptom: text, severity: severity === 'urgent' ? 'urgent' : 'normal' },
  }
}

export function createPendingAction({ homeId, user, membership, actionType, elderId, reminderId, payload = {} }) {
  assertMedicationWriteRole(membership)
  assertElderScope(membership, elderId)
  let reminder = null
  let normalizedPayload = {}
  if (actionType === 'mark_taken') {
    reminder = assertReminderConfirmable({ homeId, reminderId, membership })
    assert(reminder.elder_profile_id === elderId, 400, '提醒与老人档案不匹配')
  } else if (actionType === 'record_symptom') {
    const symptom = String(payload.symptom || '').trim().slice(0, 120)
    assert(symptom, 400, '症状不能为空')
    normalizedPayload = { symptom, severity: payload.severity === 'urgent' ? 'urgent' : 'normal' }
  } else {
    throw new HttpError(400, '不支持的待确认操作')
  }

  const database = getDb()
  const ts = nowIso()
  const action = {
    id: newId('PA'),
    homeId,
    userId: user.id,
    elderId,
    actionType,
    reminderId: reminderId || null,
    payload: normalizedPayload,
    expiresAt: new Date(Date.now() + config.aiActionTtlMs).toISOString(),
    createdAt: ts,
  }
  database.transaction(() => {
    database.prepare(`
      INSERT INTO ai_pending_actions (
        id, home_id, user_id, elder_profile_id, action_type, reminder_id,
        payload_json, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      action.id, homeId, user.id, elderId, actionType, action.reminderId,
      JSON.stringify(action.payload), action.expiresAt, ts,
    )
    audit(database, { id: action.id, home_id: homeId }, user.id, 'created')
  })()
  return getPendingActionView(homeId, user.id, action.id)
}

export function getPendingActionView(homeId, userId, actionId, database = getDb()) {
  const row = database.prepare(`
    SELECT pa.*, e.name AS elder_name,
      rm.remind_time, r.dose, d.generic_name AS drug_name, d.primary_package_image_url
    FROM ai_pending_actions pa
    JOIN elder_profiles e ON e.id = pa.elder_profile_id
    LEFT JOIN reminder_rules rm ON rm.id = pa.reminder_id
    LEFT JOIN medication_records r ON r.id = rm.record_id
    LEFT JOIN drugs d ON d.id = r.drug_id
    WHERE pa.id = ? AND pa.home_id = ? AND pa.user_id = ?
  `).get(actionId, homeId, userId)
  assert(row, 404, '待确认操作不存在')
  const payload = parsePayload(row)
  return {
    id: row.id,
    type: row.action_type,
    status: row.status,
    elderId: row.elder_profile_id,
    elderName: row.elder_name,
    expiresAt: row.expires_at,
    symptom: payload.symptom || '',
    severity: payload.severity || 'normal',
    reminder: row.reminder_id ? toReminderCard(row) : null,
    safetyWarning: row.action_type === 'mark_taken'
      ? SAFETY_WARNING
      : '尚未通知家属。确认记录后只会生成应用内提醒；紧急不适请立即就医或拨打 120，不要等待家属查看。',
  }
}

export function confirmPendingAction({ homeId, user, membership, actionId }) {
  const database = getDb()
  let response
  let deferredError
  database.transaction(() => {
    const action = database.prepare('SELECT * FROM ai_pending_actions WHERE id = ? AND home_id = ?').get(actionId, homeId)
    assert(action, 404, '待确认操作不存在')
    if (action.user_id !== user.id) throw new HttpError(403, '该待确认操作不属于当前用户')
    assertMedicationWriteRole(membership)
    assertElderScope(membership, action.elder_profile_id)

    if (action.status === 'confirmed') {
      audit(database, action, user.id, 'replayed', '幂等返回已确认结果')
      response = { action: getPendingActionView(homeId, user.id, action.id, database), idempotent: true, message: '该操作已经确认，无需重复提交。' }
      return
    }
    if (action.status !== 'pending') throw new HttpError(409, '该操作已失效')
    if (Date.parse(action.expires_at) <= Date.now()) {
      database.prepare("UPDATE ai_pending_actions SET status = 'expired' WHERE id = ? AND status = 'pending'").run(action.id)
      audit(database, action, user.id, 'expired')
      deferredError = new HttpError(410, '确认操作已过期，请重新发起')
      return
    }

    if (action.action_type === 'mark_taken') {
      // AI 二阶段确认必须以“此刻仍是当天有效待服提醒”为前提。
      // 幂等重放只由上面的 action.status === 'confirmed' 分支处理，
      // 不能把其他入口已经完成的服药事件误认为当前 action 确认成功。
      assertReminderConfirmable({ database, homeId, reminderId: action.reminder_id, membership })
      const result = applyMedicationStatus(database, {
        homeId,
        reminderId: action.reminder_id,
        membership,
        actorUserId: user.id,
        status: 'taken',
        source: 'ai_confirmed',
        pendingActionId: action.id,
      })
      database.prepare("UPDATE ai_pending_actions SET status = 'confirmed', used_at = ? WHERE id = ? AND status = 'pending'")
        .run(nowIso(), action.id)
      audit(database, action, user.id, 'confirmed', result.idempotent ? '服药事件已存在' : '已写入服药事件')
      response = {
        action: getPendingActionView(homeId, user.id, action.id, database),
        idempotent: result.idempotent,
        message: `已确认${result.row.drug_name}为今日已服，并保留审计记录。`,
      }
      return
    }

    const payload = parsePayload(action)
    const symptom = String(payload.symptom || '').trim()
    const severity = payload.severity === 'urgent' ? 'urgent' : 'normal'
    assert(symptom, 409, '症状内容已失效')
    const ts = nowIso()
    database.prepare(`
      INSERT INTO symptom_logs (id, home_id, elder_profile_id, symptom, severity, source, created_at)
      VALUES (?, ?, ?, ?, ?, 'ai_confirmed', ?)
    `).run(newId('S'), homeId, action.elder_profile_id, symptom, severity, ts)
    const elder = database.prepare('SELECT name FROM elder_profiles WHERE id = ? AND home_id = ?').get(action.elder_profile_id, homeId)
    database.prepare(`
      INSERT INTO care_alerts (id, home_id, elder_profile_id, kind, severity, content, created_at)
      VALUES (?, ?, ?, 'symptom', ?, ?, ?)
    `).run(newId('A'), homeId, action.elder_profile_id, severity, `${elder.name}反馈：${symptom}`, ts)
    database.prepare("UPDATE ai_pending_actions SET status = 'confirmed', used_at = ? WHERE id = ? AND status = 'pending'")
      .run(ts, action.id)
    audit(database, action, user.id, 'confirmed', '已写入症状和应用内提醒')
    response = {
      action: getPendingActionView(homeId, user.id, action.id, database),
      idempotent: false,
      message: severity === 'urgent'
        ? '症状已记录并生成应用内家属提醒，但不代表家属已收到或已读。请立即就医或拨打 120，不要等待提醒送达。'
        : '症状已记录并生成应用内家属提醒；家属需要打开应用查看，当前无法保证已经送达或读取。',
    }
  })()
  if (deferredError) throw deferredError
  return response
}
