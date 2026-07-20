import { Hono } from 'hono'
import { config } from '../config.js'
import { getDb } from '../db.js'
import { HttpError, assert } from '../errors.js'
import { resolveTtsVoice } from '../companion-voice.js'
import { getElderInHome } from '../domain.js'
import { requireAuth, requireHomeMember } from '../middleware.js'
import { deleteAiMedia, storeAiMedia } from '../ai-media.js'
import { getMedicationAdherence } from '../medication-events.js'
import { createFixedWindowRateLimiter } from '../rate-limit.js'
import {
  buildMarkTakenProposal,
  buildSymptomProposal,
  confirmPendingAction,
  createPendingAction,
  getPendingActionView,
} from '../ai-actions.js'

const ai = new Hono()
ai.use('*', requireAuth)

const aiRateLimiter = createFixedWindowRateLimiter()
const DISCLAIMER = '用药建议仅供参考，不能替代医生或药师意见；出现胸痛、呼吸困难、昏厥等紧急症状，请立即就医或拨打 120。'

function enforceAiRateLimit(c, scope, limit) {
  const user = c.get('user')
  const result = aiRateLimiter.consume(`${scope}:${user.id}`, limit)
  if (!result.allowed) {
    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000))
    throw new HttpError(429, `请求过于频繁，请 ${seconds} 秒后重试`)
  }
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max)
}

function requestSignal(c, timeoutMs) {
  const signals = [AbortSignal.timeout(timeoutMs)]
  if (c.req.raw.signal) signals.push(c.req.raw.signal)
  return AbortSignal.any(signals)
}

function publicMediaUrl(token) {
  assert(config.publicBaseUrl, 503, '语音服务缺少 PUBLIC_BASE_URL 配置')
  return `${config.publicBaseUrl}/ai-media/${token}`
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason || new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

async function transcribeDashScope({ audio, format, signal }) {
  const contentTypes = { mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav', m4a: 'audio/mp4' }
  const token = storeAiMedia({ buffer: audio, contentType: contentTypes[format] })
  try {
    const headers = {
      Authorization: `Bearer ${config.sttApiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    }
    const submit = await fetch(config.sttApiUrl, {
      method: 'POST', signal, headers,
      body: JSON.stringify({ model: config.sttModel, input: { file_urls: [publicMediaUrl(token)] } }),
    })
    const submitted = await submit.json().catch(() => ({}))
    if (!submit.ok) throw new HttpError(submit.status === 429 ? 429 : 502, submitted?.message || submitted?.code || '语音识别任务提交失败')
    const taskId = submitted?.output?.task_id
    assert(taskId, 502, '语音识别服务未返回任务编号')
    const taskUrl = new URL(`/api/v1/tasks/${taskId}`, config.sttApiUrl).toString()
    for (let index = 0; index < 40; index += 1) {
      await sleep(250, signal)
      const response = await fetch(taskUrl, { method: 'GET', signal, headers: { Authorization: `Bearer ${config.sttApiKey}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, data?.message || '查询语音识别任务失败')
      const status = data?.output?.task_status
      if (status === 'FAILED' || status === 'CANCELED') throw new HttpError(502, data?.output?.message || '语音识别失败')
      if (status !== 'SUCCEEDED') continue
      const result = data?.output?.results?.[0]
      assert(result?.subtask_status !== 'FAILED' && result?.transcription_url, 502, result?.message || '语音识别没有返回结果')
      const transcriptResponse = await fetch(result.transcription_url, { signal })
      const transcript = await transcriptResponse.json().catch(() => ({}))
      if (!transcriptResponse.ok) throw new HttpError(502, '读取语音识别结果失败')
      return cleanText((transcript.transcripts || []).map((item) => item.text || '').join(''), 500)
    }
    throw new HttpError(504, '语音识别超时')
  } finally {
    deleteAiMedia(token)
  }
}

function chooseElder(homeId, membership, elderId) {
  const id = membership.role === 'elder' ? membership.elder_profile_id : elderId
  if (!id) {
    const elders = getDb().prepare('SELECT * FROM elder_profiles WHERE home_id = ? ORDER BY created_at LIMIT 2').all(homeId)
    return elders.length === 1 ? elders[0] : null
  }
  return getElderInHome(homeId, id)
}

function listMedicationContext(homeId, elderId) {
  if (!elderId) return []
  return getDb().prepare(`
    SELECT r.id, d.generic_name AS drug_name, r.dose, r.frequency, r.start_date, r.end_date
    FROM medication_records r
    JOIN drugs d ON d.id = r.drug_id
    WHERE r.home_id = ? AND r.elder_profile_id = ?
    ORDER BY d.generic_name
  `).all(homeId, elderId)
}

function getDrugSafety(homeId, drugName, target) {
  const term = cleanText(drugName, 80)
  if (!term) return { found: false, message: '请提供要查询的药物名称。' }
  const escapedTerm = term.replace(/[\\%_]/g, '\\$&')
  const pattern = `%${escapedTerm}%`
  const item = getDb().prepare(`
    SELECT * FROM drugs
    WHERE (home_id IS NULL OR home_id = ?)
      AND (generic_name LIKE ? ESCAPE '\\' OR trade_name LIKE ? ESCAPE '\\' OR aliases LIKE ? ESCAPE '\\')
    ORDER BY CASE WHEN generic_name = ? THEN 0 WHEN trade_name = ? THEN 1 ELSE 2 END,
      CASE WHEN home_id = ? THEN 0 ELSE 1 END, generic_name
    LIMIT 1
  `).get(homeId, pattern, pattern, pattern, term, term, homeId)
  if (!item) return { found: false, message: '未在家庭药品库或内置药品库找到该药物。' }
  const interactions = getDb().prepare(`
    SELECT c.severity, c.contra_type, c.note,
      CASE WHEN c.drug_a_id = ?
        THEN COALESCE(db.generic_name, c.drug_b_text)
        ELSE da.generic_name
      END AS with_name
    FROM contraindications c
    JOIN drugs da ON da.id = c.drug_a_id
    LEFT JOIN drugs db ON db.id = c.drug_b_id
    WHERE (c.drug_a_id = ? OR c.drug_b_id = ?)
      AND (c.home_id IS NULL OR c.home_id = ?)
  `).all(item.id, item.id, item.id, homeId).filter((row) => !target
    || String(row.with_name || '').includes(target)
    || String(row.note || '').includes(target))
  return {
    found: true,
    drug: item.generic_name,
    dosage: item.dosage_text,
    contraindicationNote: item.contraindication_note,
    interactionNote: item.interaction_note,
    interactions,
  }
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_medication_adherence',
      description: '从不可变服药事件中查询近一段时间的已服和漏服统计。',
      parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_drug_safety',
      description: '从家庭药品库和禁忌库中检索药物与食物或其他药物的注意事项。',
      parameters: {
        type: 'object',
        properties: { drugName: { type: 'string' }, target: { type: 'string' } },
        required: ['drugName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_mark_taken',
      description: '仅提出“确认已服”的候选操作，不修改数据库。提醒选择由服务端确定；有多个提醒时必须让用户选择。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_record_symptom',
      description: '仅提出记录症状的候选操作，不写数据库、不声称家属已收到通知。',
      parameters: {
        type: 'object',
        properties: {
          symptom: { type: 'string' },
          severity: { type: 'string', enum: ['normal', 'urgent'] },
        },
        required: ['symptom'],
      },
    },
  },
]

async function callTextModel(messages, signal) {
  if (!config.aiApiUrl || !config.aiApiKey || !config.aiModel) {
    throw new HttpError(503, 'AI 服务尚未配置')
  }
  let response
  try {
    response = await fetch(config.aiApiUrl, {
      method: 'POST',
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.aiUpstreamTimeoutMs)]),
      headers: { Authorization: `Bearer ${config.aiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.aiModel, messages, tools, tool_choice: 'auto', temperature: 0.2 }),
    })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new HttpError(504, 'AI 请求超时，请稍后重试')
    throw new HttpError(502, 'AI 服务暂时不可用')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, data?.error?.message || 'AI 服务返回异常')
  const message = data?.choices?.[0]?.message
  if (!message) throw new HttpError(502, 'AI 服务未返回有效回答')
  return message
}

function safeToolArgs(call) {
  try { return JSON.parse(call.function.arguments || '{}') } catch { return {} }
}

function executeTool({ homeId, membership, elder, call, drafts }) {
  const args = safeToolArgs(call)
  try {
    switch (call.function.name) {
      case 'get_medication_adherence':
        return getMedicationAdherence(homeId, elder?.id, args.days)
      case 'get_drug_safety':
        return getDrugSafety(homeId, args.drugName, args.target)
      case 'propose_mark_taken': {
        if (!elder) return { ok: false, message: '请先选择老人档案。' }
        const proposal = buildMarkTakenProposal(homeId, membership, elder.id)
        if (proposal.kind === 'draft') drafts.push(proposal)
        return proposal
      }
      case 'propose_record_symptom': {
        if (!elder) return { ok: false, message: '请先选择老人档案。' }
        const proposal = buildSymptomProposal(membership, elder.id, args.symptom, args.severity)
        drafts.push(proposal)
        return {
          ...proposal,
          payload: undefined,
          message: proposal.payload.severity === 'urgent'
            ? '已生成待确认症状操作，尚未通知家属。紧急不适请立即就医或拨打 120。'
            : '已生成待确认症状操作，尚未通知家属；确认后只会生成应用内提醒。',
        }
      }
      default:
        return { ok: false, message: '不支持的工具。' }
    }
  } catch (error) {
    if (error instanceof HttpError) return { ok: false, status: error.status, message: error.message }
    throw error
  }
}

function dedupeHistory(history, question) {
  const rows = Array.isArray(history) ? history.slice(-8).map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: cleanText(item?.content, 800),
  })).filter((item) => item.content) : []
  if (rows.length && rows[rows.length - 1].role === 'user' && rows[rows.length - 1].content === question) rows.pop()
  return rows
}

function persistDraft({ homeId, user, membership, draft }) {
  return createPendingAction({
    homeId,
    user,
    membership,
    actionType: draft.actionType,
    elderId: draft.elderId,
    reminderId: draft.reminderId,
    payload: draft.payload,
  })
}

ai.post('/:homeId/ai/chat', requireHomeMember('caregiver_view'), async (c) => {
  enforceAiRateLimit(c, 'chat', 20)
  const membership = c.get('membership')
  const user = c.get('user')
  const homeId = membership.home_id
  const body = await c.req.json().catch(() => ({}))
  const question = cleanText(body.message)
  assert(question, 400, '请输入要咨询的内容')
  const elder = chooseElder(homeId, membership, cleanText(body.elderId, 80))
  const mode = body.mode === 'elder' ? 'elder' : 'caregiver'
  const history = dedupeHistory(body.history, question)
  const medications = listMedicationContext(homeId, elder?.id)
  const elderContext = elder
    ? `姓名：${elder.name}；性别：${elder.gender === 'male' ? '男' : '女'}；家庭关系：${elder.relationship || '未填写'}；年龄：${elder.age}岁；过敏史：${elder.allergy_note}`
    : '未选择'
  const system = `你是“药灵通”家庭用药管家。只根据工具返回和提供的数据回答，不编造服药历史。模型不得直接修改服药状态或症状记录；只能调用 propose_* 工具生成待确认候选，最终写库必须由用户点击确认后调用确定性接口。若存在多个待服提醒，不得猜测老人服用了哪一种药。症状候选生成时必须说明尚未通知家属；紧急症状应立即建议就医或拨打 120。医疗信息只作健康教育，不得诊断或擅自调整剂量。必须严格依据当前老人档案中的性别和家庭关系称呼，不得根据姓名猜测性别；关系不适合作为称谓时使用姓名或“老人”。回答使用简明中文，结尾附上：${DISCLAIMER}\n\n当前服务模式：${mode}\n当前老人：${elderContext}\n用药档案：${JSON.stringify(medications)}`
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: question }]
  const signal = requestSignal(c, config.aiRequestTimeoutMs)
  const drafts = []
  const toolResults = []

  for (let round = 0; round < 2; round += 1) {
    const message = await callTextModel(messages, signal)
    messages.push(message)
    if (!Array.isArray(message.tool_calls) || !message.tool_calls.length) {
      if (signal.aborted) throw new HttpError(504, 'AI 请求超时，请稍后重试')
      let pendingAction = null
      if (drafts.length) pendingAction = persistDraft({ homeId, user, membership, draft: drafts[0] })
      const ambiguous = toolResults.find((item) => item.result?.kind === 'ambiguous')
      const draft = drafts[0]
      let answer = cleanText(message.content, 2000) || '我暂时无法生成回答。'
      if (ambiguous) answer = '我找到多个待服提醒，不能替您猜测是哪一种药。请根据药品包装、药名、剂量和提醒时间选择。'
      else if (draft?.actionType === 'mark_taken') answer = '我找到了一个待服提醒，但还没有修改服药状态。请先核对确认卡中的药品包装、药名、剂量和提醒时间。'
      else if (draft?.actionType === 'record_symptom') {
        answer = draft.payload.severity === 'urgent'
          ? '我已整理出待确认的紧急症状记录，目前尚未通知家属。请立即就医或拨打 120，不要等待家属查看提醒。'
          : '我已整理出待确认的症状记录，目前尚未通知家属。确认后会生成应用内家属提醒，但不代表消息已经送达或读取。'
      }
      if (!answer.includes(DISCLAIMER)) answer = `${answer}\n\n${DISCLAIMER}`
      return c.json({
        answer,
        toolResults,
        pendingAction,
        candidates: ambiguous?.result?.candidates || [],
      })
    }
    for (const call of message.tool_calls) {
      const result = executeTool({ homeId, membership, elder, call, drafts })
      toolResults.push({ name: call.function.name, result })
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }

  // 工具后的模型请求未成功收束，不持久化草稿，避免客户端失败后遗留操作或产生副作用。
  throw new HttpError(502, 'AI 未能完成本次请求，请重试')
})

ai.post('/:homeId/ai/pending-actions', requireHomeMember('caregiver_view'), async (c) => {
  const membership = c.get('membership')
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const elder = chooseElder(membership.home_id, membership, cleanText(body.elderId, 80))
  assert(elder, 400, '请先选择老人档案')
  const action = createPendingAction({
    homeId: membership.home_id,
    user,
    membership,
    actionType: body.actionType,
    elderId: elder.id,
    reminderId: cleanText(body.reminderId, 80),
    payload: body.payload || {},
  })
  return c.json({ pendingAction: action }, 201)
})

ai.get('/:homeId/ai/pending-actions/:actionId', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  const user = c.get('user')
  return c.json({ pendingAction: getPendingActionView(membership.home_id, user.id, c.req.param('actionId')) })
})

ai.post('/:homeId/ai/pending-actions/:actionId/confirm', requireHomeMember('caregiver_view'), (c) => {
  const membership = c.get('membership')
  const user = c.get('user')
  return c.json(confirmPendingAction({
    homeId: membership.home_id,
    user,
    membership,
    actionId: c.req.param('actionId'),
  }))
})

ai.post('/:homeId/ai/transcribe', requireHomeMember('caregiver_view'), async (c) => {
  enforceAiRateLimit(c, 'transcribe', 10)
  if (!config.sttApiUrl || !config.sttApiKey || !config.sttModel) throw new HttpError(503, '语音识别服务尚未配置')
  const body = await c.req.json().catch(() => ({}))
  const audioBase64 = String(body.audioBase64 || '')
  const format = ['mp3', 'aac', 'wav', 'm4a'].includes(body.format) ? body.format : 'mp3'
  assert(audioBase64, 400, '录音内容不能为空')
  let audio
  try { audio = Buffer.from(audioBase64, 'base64') } catch { throw new HttpError(400, '录音数据无效') }
  assert(audio.length > 0 && audio.length <= 3 * 1024 * 1024, 400, '录音大小必须在 3MB 以内')

  const signal = requestSignal(c, config.sttUpstreamTimeoutMs)
  if (config.sttProvider === 'dashscope_async') {
    let text
    try { text = await transcribeDashScope({ audio, format, signal }) } catch (error) {
      if (error instanceof HttpError) throw error
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new HttpError(504, '语音识别超时')
      throw new HttpError(502, '语音识别服务暂时不可用')
    }
    assert(text, 502, '语音识别未返回文字')
    return c.json({ text })
  }

  const contentTypes = { mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav', m4a: 'audio/mp4' }
  const form = new FormData()
  form.append('model', config.sttModel)
  form.append('file', new Blob([audio], { type: contentTypes[format] }), `elder-voice.${format}`)
  let response
  try {
    response = await fetch(config.sttApiUrl, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${config.sttApiKey}` },
      body: form,
    })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new HttpError(504, '语音识别超时')
    throw new HttpError(502, '语音识别服务暂时不可用')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, data?.error?.message || data?.message || '语音识别失败')
  const text = cleanText(data.text || data.transcript || data?.output?.text, 500)
  assert(text, 502, '语音识别未返回文字')
  return c.json({ text })
})

ai.post('/:homeId/ai/speech', requireHomeMember('caregiver_view'), async (c) => {
  enforceAiRateLimit(c, 'speech', 30)
  if (!config.ttsApiUrl || !config.ttsApiKey || !config.ttsModel) throw new HttpError(503, '语音合成服务尚未配置')
  const body = await c.req.json().catch(() => ({}))
  assert(body.aiConsent === true, 400, '使用第三方语音合成前需要用户明确同意隐私说明')
  const text = cleanText(body.text, 1800)
  assert(text, 400, '播报文字不能为空')
  const voice = resolveTtsVoice(body.voice || body.tone || body.voiceTone) || config.ttsVoice
  let response
  try {
    response = await fetch(config.ttsApiUrl, {
      method: 'POST',
      signal: requestSignal(c, config.ttsUpstreamTimeoutMs),
      headers: { Authorization: `Bearer ${config.ttsApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ttsModel,
        input: { text, voice, language_type: 'Chinese' },
      }),
    })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new HttpError(504, '语音合成超时')
    throw new HttpError(502, '语音合成服务暂时不可用')
  }
  const data = await response.json().catch(() => ({}))
  const audioUrl = data.audioUrl || data.url || data?.output?.audio?.url || ''
  if (!response.ok || !audioUrl) throw new HttpError(502, data?.message || '语音合成失败')
  const token = storeAiMedia({ remoteUrl: audioUrl, contentType: 'audio/mpeg' })
  return c.json({ audioUrl: publicMediaUrl(token), voice })
})

export default ai
