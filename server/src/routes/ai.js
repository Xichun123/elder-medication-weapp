import { Hono } from 'hono'
import { config } from '../config.js'
import { getDb, nowIso } from '../db.js'
import { HttpError, assert } from '../errors.js'
import { newId } from '../ids.js'
import { getElderInHome, localDate } from '../domain.js'
import { requireAuth, requireHomeMember } from '../middleware.js'

const ai = new Hono()
ai.use('*', requireAuth)

const DISCLAIMER = '用药建议仅供参考，不能替代医生或药师意见；出现胸痛、呼吸困难、昏厥等紧急症状，请立即就医或拨打 120。'

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max)
}

function chooseElder(homeId, membership, elderId) {
  const id = membership.role === 'elder' ? membership.elder_profile_id : elderId
  if (!id) {
    // 家属未显式选人时，家庭只有一位长辈就自动作为咨询对象。
    const elders = getDb().prepare('SELECT * FROM elder_profiles WHERE home_id = ? ORDER BY created_at LIMIT 2').all(homeId)
    return elders.length === 1 ? elders[0] : null
  }
  return getElderInHome(homeId, id)
}

function listMedicationContext(homeId, elderId) {
  const db = getDb()
  const filters = ['r.home_id = ?']
  const params = [homeId]
  if (elderId) {
    filters.push('r.elder_profile_id = ?')
    params.push(elderId)
  }
  return db.prepare(`
    SELECT r.id, e.name AS elder_name, d.generic_name AS drug_name, r.dose, r.frequency,
      r.start_date, r.end_date
    FROM medication_records r
    JOIN elder_profiles e ON e.id = r.elder_profile_id
    JOIN drugs d ON d.id = r.drug_id
    WHERE ${filters.join(' AND ')}
    ORDER BY e.name, d.generic_name
  `).all(...params)
}

function getAdherence(homeId, elderId, days = 30) {
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 90))
  const elderFilter = elderId ? 'AND rm.elder_profile_id = ?' : ''
  const params = [homeId, localDate(new Date(Date.now() - safeDays * 86400000))]
  if (elderId) params.push(elderId)
  const rows = getDb().prepare(`
    SELECT e.name AS elderName,
      SUM(CASE WHEN rm.status = 'taken' THEN 1 ELSE 0 END) AS taken,
      SUM(CASE WHEN rm.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      COUNT(*) AS total
    FROM reminder_rules rm
    JOIN elder_profiles e ON e.id = rm.elder_profile_id
    WHERE rm.home_id = ? AND rm.status_date >= ? ${elderFilter}
    GROUP BY rm.elder_profile_id
  `).all(...params)
  return { days: safeDays, rows: rows.map((row) => ({ ...row, missed: Number(row.skipped || 0) })) }
}

function getDrugSafety(homeId, drugName, target) {
  const term = cleanText(drugName, 80)
  const item = getDb().prepare(`
    SELECT * FROM drugs
    WHERE (home_id IS NULL OR home_id = ?)
      AND (generic_name LIKE ? OR trade_name LIKE ? OR aliases LIKE ?)
    LIMIT 1
  `).get(homeId, `%${term}%`, `%${term}%`, `%${term}%`)
  if (!item) return { found: false, message: '未在家庭药品库或内置药品库找到该药物。' }
  const interactions = getDb().prepare(`
    SELECT c.severity, c.contra_type, c.note, COALESCE(db.generic_name, c.drug_b_text) AS withName
    FROM contraindications c
    LEFT JOIN drugs db ON db.id = c.drug_b_id
    WHERE c.drug_a_id = ? AND (c.home_id IS NULL OR c.home_id = ?)
  `).all(item.id, homeId).filter((row) => !target || String(row.withName || '').includes(target) || String(row.note || '').includes(target))
  return {
    found: true,
    drug: item.generic_name,
    dosage: item.dosage_text,
    contraindicationNote: item.contraindication_note,
    interactionNote: item.interaction_note,
    interactions,
  }
}

function markReminderTaken(homeId, elderId, reminderId) {
  const row = getDb().prepare(`
    SELECT rm.id, d.generic_name AS drugName, rm.remind_time AS remindTime
    FROM reminder_rules rm
    JOIN medication_records r ON r.id = rm.record_id
    JOIN drugs d ON d.id = r.drug_id
    WHERE rm.id = ? AND rm.home_id = ? AND rm.elder_profile_id = ?
  `).get(reminderId, homeId, elderId)
  if (!row) return { ok: false, message: '未找到可确认的本人提醒。' }
  getDb().prepare(`UPDATE reminder_rules SET status = 'taken', status_date = ?, updated_at = ? WHERE id = ?`)
    .run(localDate(), nowIso(), row.id)
  return { ok: true, message: `已标记 ${row.drugName}（${row.remindTime}）为已服。` }
}

function recordSymptom(homeId, elderId, symptom, severity = 'normal') {
  const text = cleanText(symptom, 120)
  if (!text) return { ok: false, message: '没有识别到具体症状。' }
  const level = ['normal', 'urgent'].includes(severity) ? severity : 'normal'
  const db = getDb()
  const ts = nowIso()
  db.prepare('INSERT INTO symptom_logs (id, home_id, elder_profile_id, symptom, severity, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId('S'), homeId, elderId, text, level, ts)
  const elder = getElderInHome(homeId, elderId)
  db.prepare('INSERT INTO care_alerts (id, home_id, elder_profile_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId('A'), homeId, elderId, 'symptom', `${elder.name}反馈：${text}`, ts)
  return { ok: true, message: `已记录“${text}”，并生成家属端健康提醒。` }
}

const tools = [
  { type: 'function', function: { name: 'get_medication_adherence', description: '查询老人近一段时间的已服和漏服统计。', parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 } } } } },
  { type: 'function', function: { name: 'get_drug_safety', description: '从家庭药品库和禁忌库中检索药物与食物或药物的注意事项。', parameters: { type: 'object', properties: { drugName: { type: 'string' }, target: { type: 'string' } }, required: ['drugName'] } } },
  { type: 'function', function: { name: 'mark_reminder_taken', description: '当老人明确说已经服药时，确认指定的待服提醒。只能使用上下文中列出的 reminderId。', parameters: { type: 'object', properties: { reminderId: { type: 'string' } }, required: ['reminderId'] } } },
  { type: 'function', function: { name: 'record_symptom', description: '当老人反馈不舒服时记录症状，并创建供家属查看的提醒。', parameters: { type: 'object', properties: { symptom: { type: 'string' }, severity: { type: 'string', enum: ['normal', 'urgent'] } }, required: ['symptom'] } } },
]

async function askQwen(messages) {
  if (!config.qwenApiKey) throw new HttpError(503, 'AI 尚未配置，请在 server/.env 设置 QWEN_API_KEY。')
  const endpoint = `${config.qwenApiBaseUrl.replace(/\/$/, '')}/chat/completions`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.qwenApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.qwenModel, messages, tools, tool_choice: 'auto', temperature: 0.2 }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new HttpError(502, data?.error?.message || '千问服务暂时不可用。')
  const message = data?.choices?.[0]?.message
  if (!message) throw new HttpError(502, '千问未返回有效回答。')
  return message
}

async function synthesizeSpeech(text) {
  const input = cleanText(text, 1800)
  if (!input || !config.qwenApiKey) return ''
  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.qwenApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.qwenTtsModel,
      input: { text: input, voice: config.qwenTtsVoice, language_type: 'Chinese' },
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.output?.audio?.url) {
    throw new Error(data?.message || '语音合成失败')
  }
  return data.output.audio.url
}

async function executeTool(homeId, elder, call) {
  let args = {}
  try { args = JSON.parse(call.function.arguments || '{}') } catch { return { ok: false, message: '工具参数无法解析。' } }
  switch (call.function.name) {
    case 'get_medication_adherence': return getAdherence(homeId, elder?.id, args.days)
    case 'get_drug_safety': return getDrugSafety(homeId, args.drugName, args.target)
    case 'mark_reminder_taken':
      return elder ? markReminderTaken(homeId, elder.id, args.reminderId) : { ok: false, message: '请先选择老人档案。' }
    case 'record_symptom':
      return elder ? recordSymptom(homeId, elder.id, args.symptom, args.severity) : { ok: false, message: '请先选择老人档案。' }
    default: return { ok: false, message: '不支持的工具。' }
  }
}

ai.post('/:homeId/ai/chat', requireHomeMember('caregiver_view'), async (c) => {
  const membership = c.get('membership')
  const homeId = membership.home_id
  const body = await c.req.json().catch(() => ({}))
  const question = cleanText(body.message)
  assert(question, 400, '请输入要咨询的内容。')
  const elder = chooseElder(homeId, membership, cleanText(body.elderId, 80))
  const medications = listMedicationContext(homeId, elder?.id)
  const pending = elder ? getDb().prepare(`
    SELECT rm.id AS reminderId, d.generic_name AS drugName, rm.remind_time AS remindTime
    FROM reminder_rules rm JOIN medication_records r ON r.id = rm.record_id JOIN drugs d ON d.id = r.drug_id
    WHERE rm.home_id = ? AND rm.elder_profile_id = ? AND (rm.status_date IS NULL OR rm.status_date <> ? OR rm.status = 'pending')
    ORDER BY rm.remind_time
  `).all(homeId, elder.id, localDate()) : []
  const mode = body.mode === 'elder' ? 'elder' : 'caregiver'
  const history = Array.isArray(body.history) ? body.history.slice(-8).map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user', content: cleanText(item?.content, 800),
  })).filter((item) => item.content) : []
  const system = `你是“药灵通”家庭用药管家。以工具查询结果和以下家庭数据为准，不编造用药或服药数据。${mode === 'elder' ? '正在服务老人：若对方明确说已服药，调用 mark_reminder_taken；若说头晕、疼痛、不舒服等，调用 record_symptom。' : '正在服务家属：关于漏服、药物禁忌、用药情况，先调用相应工具。'} 医疗信息只能作健康教育，不得诊断或擅自调整剂量。回答使用简明中文，结尾附上：${DISCLAIMER}\n\n当前选中老人：${elder ? `${elder.name}，${elder.age}岁，过敏史：${elder.allergy_note}` : '未选择'}\n用药档案：${JSON.stringify(medications)}\n当前待服提醒：${JSON.stringify(pending)}`
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: question }]
  const actions = []
  for (let round = 0; round < 3; round += 1) {
    const message = await askQwen(messages)
    messages.push(message)
    if (!Array.isArray(message.tool_calls) || !message.tool_calls.length) {
      const answer = cleanText(message.content, 2000) || `我暂时无法生成回答。${DISCLAIMER}`
      const actionText = actions.map((item) => item.message).filter(Boolean).join('。')
      let audioUrl = ''
      try { audioUrl = await synthesizeSpeech(`${answer}${actionText ? `。${actionText}` : ''}`) } catch (error) { console.warn('AI 语音合成失败', error.message) }
      return c.json({ answer, actions, audioUrl })
    }
    for (const call of message.tool_calls) {
      const result = await executeTool(homeId, elder, call)
      actions.push({ name: call.function.name, ...result })
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  const answer = `我已完成相关查询。${DISCLAIMER}`
  let audioUrl = ''
  try { audioUrl = await synthesizeSpeech(answer) } catch (error) { console.warn('AI 语音合成失败', error.message) }
  return c.json({ answer, actions, audioUrl })
})

export default ai
