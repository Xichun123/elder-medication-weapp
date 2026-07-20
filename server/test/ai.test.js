import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const serverRoot = path.resolve(import.meta.dirname, '..')
const port = 22000 + Math.floor(Math.random() * 1000)
const upstreamPort = 24000 + Math.floor(Math.random() * 1000)
const baseUrl = `http://127.0.0.1:${port}`
const upstreamUrl = `http://127.0.0.1:${upstreamPort}`

let tempDir
let databasePath
let child
let upstreamServer
let inspectionDb
let serverLogs = ''
let mockMode = 'normal'
let mockRequests = []
let mockCallCount = 0

const context = {
  owner: null,
  editor: null,
  viewer: null,
  elder: null,
  homeId: '',
  elderId: '',
  drugId: '',
  recordId: '',
  reminderIds: [],
}

function resetMock(mode = 'normal') {
  mockMode = mode
  mockRequests = []
  mockCallCount = 0
}

function json(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(data))
}

function toolMessage(name, args = {}) {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: `call-${mockCallCount}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    }],
  }
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function createUpstreamServer() {
  return http.createServer(async (request, response) => {
    const body = await readJson(request).catch(() => ({}))
    mockRequests.push({ url: request.url, method: request.method, body })
    mockCallCount += 1

    if (request.url === '/v1/audio/speech') {
      json(response, 200, { output: { audio: { url: `${upstreamUrl}/mock-audio.mp3` } } })
      return
    }
    if (request.url === '/mock-audio.mp3') {
      response.writeHead(200, { 'content-type': 'audio/mpeg' })
      response.end(Buffer.from('mock-audio'))
      return
    }
    if (request.url === '/v1/audio/transcriptions') {
      json(response, 200, { output: { task_id: 'mock-asr-task', task_status: 'PENDING' } })
      return
    }
    if (request.url === '/api/v1/tasks/mock-asr-task') {
      json(response, 200, {
        output: {
          task_status: 'SUCCEEDED',
          results: [{ subtask_status: 'SUCCEEDED', transcription_url: `${upstreamUrl}/mock-transcript.json` }],
        },
      })
      return
    }
    if (request.url === '/mock-transcript.json') {
      json(response, 200, { transcripts: [{ text: '我刚吃了药' }] })
      return
    }

    const hasToolResult = Array.isArray(body.messages) && body.messages.some((item) => item.role === 'tool')
    if (mockMode === 'slow') {
      setTimeout(() => {
        if (!response.destroyed) json(response, 200, { choices: [{ message: { role: 'assistant', content: '迟到的回答' } }] })
      }, 900)
      return
    }
    if (mockMode === 'followup_fail' && hasToolResult) {
      json(response, 500, { error: { message: 'mock follow-up failed' } })
      return
    }

    const systemText = Array.isArray(body.messages)
      ? body.messages.filter((item) => item.role === 'system').map((item) => item.content || '').join('\n')
      : ''
    let message
    if (systemText.includes('适老化陪伴短句助手')) {
      message = {
        role: 'assistant',
        content: mockMode === 'companion_unsafe'
          ? JSON.stringify({ companion: '每天多吃两片，血压会降得更快' })
          : JSON.stringify({ companion: '今天也要保持好心情' }),
      }
    } else if (!hasToolResult && mockMode === 'tool_mark') message = toolMessage('propose_mark_taken')
    else if (!hasToolResult && (mockMode === 'tool_symptom' || mockMode === 'followup_fail')) {
      message = toolMessage('propose_record_symptom', { symptom: '头晕', severity: 'normal' })
    } else if (!hasToolResult && mockMode === 'tool_adherence') {
      message = toolMessage('get_medication_adherence', { days: 30 })
    } else if (!hasToolResult && mockMode === 'tool_safety') {
      message = toolMessage('get_drug_safety', { drugName: '测试降压药' })
    } else {
      message = { role: 'assistant', content: '这是模拟 AI 回答。' }
    }
    json(response, 200, { choices: [{ message }] })
  })
}

async function waitForServer() {
  let lastError
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`AI 测试 API 启动超时：${lastError?.message || ''}\n${serverLogs}`)
}

async function api(pathname, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data }
}

async function login(devOpenid, nickname) {
  const result = await api('/auth/wx-login', { method: 'POST', body: { devOpenid, nickname } })
  assert.equal(result.status, 200)
  return result.data
}

async function inviteAndJoin(ownerToken, role, user, elderProfileId) {
  const invite = await api(`/homes/${context.homeId}/invites`, {
    token: ownerToken,
    method: 'POST',
    body: { role, ...(elderProfileId ? { elderProfileId } : {}) },
  })
  assert.equal(invite.status, 201)
  const joined = await api('/homes/join', {
    token: user.token,
    method: 'POST',
    body: { code: invite.data.invite.code },
  })
  assert.equal(joined.status, 200)
}

function dbCount(table) {
  return Number(inspectionDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)
}

test.before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'yao-ling-tong-ai-'))
  databasePath = path.join(tempDir, 'test.db')
  upstreamServer = createUpstreamServer()
  await new Promise((resolve, reject) => {
    upstreamServer.once('error', reject)
    upstreamServer.listen(upstreamPort, '127.0.0.1', resolve)
  })

  child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      ALLOW_DEV_LOGIN: '1',
      JWT_SECRET: 'test-secret-at-least-32-characters-long',
      DATABASE_PATH: databasePath,
      PUBLIC_BASE_URL: baseUrl,
      WX_APP_ID: '',
      WX_APP_SECRET: '',
      AI_API_URL: `${upstreamUrl}/v1/chat/completions`,
      AI_API_KEY: 'mock-ai-key',
      AI_MODEL: 'mock-text-model',
      AI_UPSTREAM_TIMEOUT_MS: '500',
      AI_REQUEST_TIMEOUT_MS: '1500',
      AI_ACTION_TTL_MS: '60000',
      STT_API_URL: `${upstreamUrl}/v1/audio/transcriptions`,
      STT_PROVIDER: 'dashscope_async',
      STT_API_KEY: 'mock-stt-key',
      STT_MODEL: 'mock-stt-model',
      STT_UPSTREAM_TIMEOUT_MS: '500',
      TTS_API_URL: `${upstreamUrl}/v1/audio/speech`,
      TTS_API_KEY: 'mock-tts-key',
      TTS_MODEL: 'mock-tts-model',
      TTS_VOICE: 'mock-voice',
      TTS_VOICE_MAP: 'dialect_dongbei:mock-dongbei-voice,dialect_sichuan:mock-sichuan-voice,female_warm:mock-voice',
      TTS_UPSTREAM_TIMEOUT_MS: '500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => { serverLogs += chunk.toString() })
  child.stderr.on('data', (chunk) => { serverLogs += chunk.toString() })
  await waitForServer()

  context.owner = await login('ai-owner', 'AI 家庭创建人')
  const home = await api('/homes', { token: context.owner.token, method: 'POST', body: { name: 'AI 测试家庭' } })
  assert.equal(home.status, 201)
  context.homeId = home.data.home.id
  const elder = await api(`/homes/${context.homeId}/elders`, {
    token: context.owner.token,
    method: 'POST',
    body: { name: '周奶奶', age: 76, relationship: '母亲', allergyNote: '青霉素过敏' },
  })
  assert.equal(elder.status, 201)
  context.elderId = elder.data.elder.id

  const drug = await api(`/homes/${context.homeId}/drugs`, {
    token: context.owner.token,
    method: 'POST',
    body: {
      genericName: '测试降压药',
      category: 'antihypertensive',
      primaryPackageImageUrl: 'https://images.example.test/package.jpg',
    },
  })
  assert.equal(drug.status, 201)
  context.drugId = drug.data.drug.id
  assert.equal(drug.data.drug.primaryPackageImageUrl, 'https://images.example.test/package.jpg')

  const record = await api(`/homes/${context.homeId}/records`, {
    token: context.owner.token,
    method: 'POST',
    body: {
      elderProfileId: context.elderId,
      drugId: context.drugId,
      dose: '1片',
      frequency: '每日2次',
      startDate: '2020-01-01',
    },
  })
  assert.equal(record.status, 201)
  context.recordId = record.data.record.id
  context.reminderIds = record.data.autoCreatedReminders.map((item) => item.id)
  assert.equal(context.reminderIds.length, 2)

  context.editor = await login('ai-editor', 'AI 编辑家属')
  await inviteAndJoin(context.owner.token, 'caregiver_edit', context.editor)
  context.viewer = await login('ai-viewer', 'AI 只读家属')
  await inviteAndJoin(context.owner.token, 'caregiver_view', context.viewer)
  context.elder = await login('ai-elder', '周奶奶')
  await inviteAndJoin(context.owner.token, 'elder', context.elder, context.elderId)

  inspectionDb = new DatabaseSync(databasePath)
})

test.after(async () => {
  if (inspectionDb) inspectionDb.close()
  if (child && !child.killed) {
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))
  }
  if (upstreamServer) await new Promise((resolve) => upstreamServer.close(resolve))
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

test('AI 角色权限矩阵在服务端生效', async () => {
  resetMock('normal')
  for (const account of [context.owner, context.editor, context.viewer, context.elder]) {
    const chat = await api(`/homes/${context.homeId}/ai/chat`, {
      token: account.token,
      method: 'POST',
      body: { message: '今天需要注意什么？', elderId: context.elderId },
    })
    assert.equal(chat.status, 200)
  }

  const before = dbCount('ai_pending_actions')
  const viewerWrite = await api(`/homes/${context.homeId}/ai/pending-actions`, {
    token: context.viewer.token,
    method: 'POST',
    body: { actionType: 'record_symptom', elderId: context.elderId, payload: { symptom: '头晕' } },
  })
  assert.equal(viewerWrite.status, 403)
  assert.equal(dbCount('ai_pending_actions'), before)

  resetMock('tool_symptom')
  const viewerTool = await api(`/homes/${context.homeId}/ai/chat`, {
    token: context.viewer.token,
    method: 'POST',
    body: { message: '记录头晕', elderId: context.elderId },
  })
  assert.equal(viewerTool.status, 200)
  assert.equal(viewerTool.data.pendingAction, null)
  assert.equal(viewerTool.data.toolResults[0].result.status, 403)
  assert.equal(dbCount('ai_pending_actions'), before)
})

test('多个待服提醒只返回确定性候选，不让模型猜药', async () => {
  resetMock('tool_mark')
  const result = await api(`/homes/${context.homeId}/ai/chat`, {
    token: context.elder.token,
    method: 'POST',
    body: { message: '我刚吃了药', mode: 'elder' },
  })
  assert.equal(result.status, 200)
  assert.equal(result.data.pendingAction, null)
  assert.equal(result.data.candidates.length, 2)
  assert.ok(result.data.candidates.every((item) => item.drugName === '测试降压药'))
  assert.ok(result.data.candidates.every((item) => item.packageImageUrl === 'https://images.example.test/package.jpg'))
  assert.ok(result.data.candidates.every((item) => item.safetyWarning.includes('散装药片')))
  assert.equal(dbCount('medication_events'), 0)
})

test('服药状态必须二阶段确认，并支持重复确认幂等', async () => {
  const reminderId = context.reminderIds[0]
  const proposed = await api(`/homes/${context.homeId}/ai/pending-actions`, {
    token: context.elder.token,
    method: 'POST',
    body: { actionType: 'mark_taken', elderId: context.elderId, reminderId },
  })
  assert.equal(proposed.status, 201)
  assert.equal(proposed.data.pendingAction.reminder.packageImageUrl, 'https://images.example.test/package.jpg')

  const before = await api(`/homes/${context.homeId}/reminders/${reminderId}`, { token: context.owner.token })
  assert.equal(before.data.reminder.status, 'pending')
  assert.equal(dbCount('medication_events'), 0)

  const confirmed = await api(`/homes/${context.homeId}/ai/pending-actions/${proposed.data.pendingAction.id}/confirm`, {
    token: context.elder.token,
    method: 'POST',
  })
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.data.idempotent, false)
  assert.equal(dbCount('medication_events'), 1)

  const after = await api(`/homes/${context.homeId}/reminders/${reminderId}`, { token: context.owner.token })
  assert.equal(after.data.reminder.status, 'taken')

  const replay = await api(`/homes/${context.homeId}/ai/pending-actions/${proposed.data.pendingAction.id}/confirm`, {
    token: context.elder.token,
    method: 'POST',
  })
  assert.equal(replay.status, 200)
  assert.equal(replay.data.idempotent, true)
  assert.equal(dbCount('medication_events'), 1)
})

test('单一提醒由模型生成待确认操作，确认前不写库', async () => {
  resetMock('tool_mark')
  const result = await api(`/homes/${context.homeId}/ai/chat`, {
    token: context.elder.token,
    method: 'POST',
    body: { message: '另一顿药也吃了', mode: 'elder' },
  })
  assert.equal(result.status, 200)
  assert.ok(result.data.pendingAction)
  assert.equal(result.data.pendingAction.reminder.reminderId, context.reminderIds[1])
  assert.equal(dbCount('medication_events'), 1)

  const pendingReminder = await api(`/homes/${context.homeId}/reminders/${context.reminderIds[1]}`, { token: context.owner.token })
  assert.equal(pendingReminder.data.reminder.status, 'pending')
  const confirmed = await api(`/homes/${context.homeId}/ai/pending-actions/${result.data.pendingAction.id}/confirm`, {
    token: context.elder.token,
    method: 'POST',
  })
  assert.equal(confirmed.status, 200)
  assert.equal(dbCount('medication_events'), 2)
})

test('规则重建不删除历史事件，近 N 天统计来自事件表', async () => {
  const rebuilt = await api(`/homes/${context.homeId}/records/${context.recordId}`, {
    token: context.owner.token,
    method: 'PATCH',
    body: { frequency: '每日3次' },
  })
  assert.equal(rebuilt.status, 200)
  assert.equal(dbCount('medication_events'), 2)

  const reminders = await api(`/homes/${context.homeId}/reminders`, { token: context.owner.token })
  assert.equal(reminders.data.reminders.length, 3)
  const skipped = await api(`/homes/${context.homeId}/reminders/${reminders.data.reminders[0].id}/skip`, {
    token: context.owner.token,
    method: 'POST',
  })
  assert.equal(skipped.status, 200)
  assert.equal(dbCount('medication_events'), 3)

  resetMock('tool_adherence')
  const result = await api(`/homes/${context.homeId}/ai/chat`, {
    token: context.owner.token,
    method: 'POST',
    body: { message: '最近 30 天已服和漏服几次？', elderId: context.elderId },
  })
  assert.equal(result.status, 200)
  const secondRequest = mockRequests.find((item) => item.body.messages?.some((message) => message.role === 'tool'))
  assert.ok(secondRequest)
  const toolPayload = JSON.parse(secondRequest.body.messages.find((message) => message.role === 'tool').content)
  assert.equal(toolPayload.rows[0].taken, 2)
  assert.equal(toolPayload.rows[0].skipped, 1)
  assert.equal(toolPayload.rows[0].missed, 1)
})

test('确认时重新校验提醒状态和 action 所有者', async () => {
  const reminders = await api(`/homes/${context.homeId}/reminders?status=pending`, { token: context.owner.token })
  const reminderId = reminders.data.reminders[0].id
  const proposed = await api(`/homes/${context.homeId}/ai/pending-actions`, {
    token: context.owner.token,
    method: 'POST',
    body: { actionType: 'mark_taken', elderId: context.elderId, reminderId },
  })
  assert.equal(proposed.status, 201)

  const wrongUser = await api(`/homes/${context.homeId}/ai/pending-actions/${proposed.data.pendingAction.id}/confirm`, {
    token: context.editor.token,
    method: 'POST',
  })
  assert.equal(wrongUser.status, 403)

  const manual = await api(`/homes/${context.homeId}/reminders/${reminderId}/take`, {
    token: context.owner.token,
    method: 'POST',
  })
  assert.equal(manual.status, 200)
  const staleConfirm = await api(`/homes/${context.homeId}/ai/pending-actions/${proposed.data.pendingAction.id}/confirm`, {
    token: context.owner.token,
    method: 'POST',
  })
  assert.equal(staleConfirm.status, 409)
})

test('过期 action 被拒绝并写入审计', async () => {
  const proposed = await api(`/homes/${context.homeId}/ai/pending-actions`, {
    token: context.owner.token,
    method: 'POST',
    body: { actionType: 'record_symptom', elderId: context.elderId, payload: { symptom: '轻微乏力' } },
  })
  assert.equal(proposed.status, 201)
  inspectionDb.prepare("UPDATE ai_pending_actions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
    .run(proposed.data.pendingAction.id)

  const expired = await api(`/homes/${context.homeId}/ai/pending-actions/${proposed.data.pendingAction.id}/confirm`, {
    token: context.owner.token,
    method: 'POST',
  })
  assert.equal(expired.status, 410)
  const action = inspectionDb.prepare('SELECT status FROM ai_pending_actions WHERE id = ?').get(proposed.data.pendingAction.id)
  assert.equal(action.status, 'expired')
  const audit = inspectionDb.prepare("SELECT COUNT(*) AS count FROM ai_action_audits WHERE action_id = ? AND event_type = 'expired'")
    .get(proposed.data.pendingAction.id)
  assert.equal(Number(audit.count), 1)
})

test('工具后续模型失败不产生 pendingAction、症状或提醒', async () => {
  const before = {
    actions: dbCount('ai_pending_actions'),
    symptoms: dbCount('symptom_logs'),
    alerts: dbCount('care_alerts'),
  }
  resetMock('followup_fail')
  const result = await api(`/homes/${context.homeId}/ai/chat`, {
    token: context.elder.token,
    method: 'POST',
    body: { message: '我头晕', mode: 'elder' },
  })
  assert.equal(result.status, 502)
  assert.equal(dbCount('ai_pending_actions'), before.actions)
  assert.equal(dbCount('symptom_logs'), before.symptoms)
  assert.equal(dbCount('care_alerts'), before.alerts)
})

test('模型超时返回 504 且不产生副作用', async () => {
  const before = dbCount('ai_pending_actions')
  resetMock('slow')
  const result = await api(`/homes/${context.homeId}/ai/chat`, {
    token: context.owner.token,
    method: 'POST',
    body: { message: '测试超时', elderId: context.elderId },
  })
  assert.equal(result.status, 504)
  assert.equal(dbCount('ai_pending_actions'), before)
})

test('当前问题不会在 history 和 message 中重复发送', async () => {
  resetMock('normal')
  const question = '硝苯地平能和西柚一起吃吗？'
  const result = await api(`/homes/${context.homeId}/ai/chat`, {
    token: context.owner.token,
    method: 'POST',
    body: {
      message: question,
      elderId: context.elderId,
      history: [{ role: 'assistant', content: '请问有什么需要？' }, { role: 'user', content: question }],
    },
  })
  assert.equal(result.status, 200)
  const userMessages = mockRequests[0].body.messages.filter((item) => item.role === 'user' && item.content === question)
  assert.equal(userMessages.length, 1)
  const systemMessage = mockRequests[0].body.messages.find((item) => item.role === 'system')?.content || ''
  assert.match(systemMessage, /姓名：周奶奶；性别：女；家庭关系：母亲；年龄：76岁/)
  assert.match(systemMessage, /不得根据姓名猜测性别/)
})

test('药物位于禁忌关系任一侧时都能被安全工具查到', async () => {
  const otherDrug = await api(`/homes/${context.homeId}/drugs`, {
    token: context.owner.token,
    method: 'POST',
    body: { genericName: '相互作用药', category: 'other' },
  })
  assert.equal(otherDrug.status, 201)
  const contraindication = await api(`/homes/${context.homeId}/contraindications`, {
    token: context.owner.token,
    method: 'POST',
    body: {
      drugAId: otherDrug.data.drug.id,
      drugBId: context.drugId,
      contraType: 'co_administration',
      severity: 'severe',
      note: '禁止同时服用',
    },
  })
  assert.equal(contraindication.status, 201)

  resetMock('tool_safety')
  const result = await api(`/homes/${context.homeId}/ai/chat`, {
    token: context.owner.token,
    method: 'POST',
    body: { message: '测试降压药有什么相互作用？', elderId: context.elderId },
  })
  assert.equal(result.status, 200)
  const followup = mockRequests.find((item) => item.body.messages?.some((message) => message.role === 'tool'))
  const toolResult = JSON.parse(followup.body.messages.find((message) => message.role === 'tool').content)
  assert.ok(toolResult.interactions.some((item) => item.with_name === '相互作用药' && item.severity === 'severe'))
})

test('紧急症状确认后形成家属可见、可标记已读的闭环', async () => {
  const proposed = await api(`/homes/${context.homeId}/ai/pending-actions`, {
    token: context.elder.token,
    method: 'POST',
    body: {
      actionType: 'record_symptom',
      elderId: context.elderId,
      payload: { symptom: '胸痛并呼吸困难', severity: 'urgent' },
    },
  })
  assert.equal(proposed.status, 201)
  assert.ok(proposed.data.pendingAction.safetyWarning.includes('尚未通知家属'))

  const confirmed = await api(`/homes/${context.homeId}/ai/pending-actions/${proposed.data.pendingAction.id}/confirm`, {
    token: context.elder.token,
    method: 'POST',
  })
  assert.equal(confirmed.status, 200)
  assert.ok(confirmed.data.message.includes('立即就医'))
  assert.ok(confirmed.data.message.includes('不代表家属已收到或已读'))

  const alerts = await api(`/homes/${context.homeId}/alerts?unread=1`, { token: context.viewer.token })
  assert.equal(alerts.status, 200)
  const alert = alerts.data.alerts.find((item) => item.content.includes('胸痛并呼吸困难'))
  assert.ok(alert)
  assert.equal(alert.severity, 'urgent')

  const read = await api(`/homes/${context.homeId}/alerts/${alert.id}/read`, {
    token: context.viewer.token,
    method: 'PATCH',
  })
  assert.equal(read.status, 200)
  assert.ok(read.data.alert.readAt)
  const unread = await api(`/homes/${context.homeId}/alerts?unread=1`, { token: context.owner.token })
  assert.ok(!unread.data.alerts.some((item) => item.id === alert.id))

  const elderForbidden = await api(`/homes/${context.homeId}/alerts`, { token: context.elder.token })
  assert.equal(elderForbidden.status, 403)
})

test('TTS 未经隐私同意时拒绝调用上游', async () => {
  resetMock('normal')
  const result = await api(`/homes/${context.homeId}/ai/speech`, {
    token: context.elder.token,
    method: 'POST',
    body: { text: '请按时吃药。' },
  })
  assert.equal(result.status, 400)
  assert.ok(!mockRequests.some((item) => item.url === '/v1/audio/speech'))
})

test('TTS 使用独立配置和模拟上游', async () => {
  resetMock('normal')
  const result = await api(`/homes/${context.homeId}/ai/speech`, {
    token: context.elder.token,
    method: 'POST',
    body: { text: '请按确认卡核对药名和剂量。', aiConsent: true },
  })
  assert.equal(result.status, 200)
  assert.match(result.data.audioUrl, new RegExp(`^${baseUrl}/ai-media/`))
  const audio = await fetch(result.data.audioUrl)
  assert.equal(audio.status, 200)
  assert.equal(await audio.text(), 'mock-audio')
  const request = mockRequests.find((item) => item.url === '/v1/audio/speech')
  assert.ok(request)
  assert.equal(request.body.model, 'mock-tts-model')
  assert.equal(request.body.input.voice, 'mock-voice')
})

test('方言音色会映射到配置的 TTS voice', async () => {
  resetMock('normal')
  const result = await api(`/homes/${context.homeId}/ai/speech`, {
    token: context.elder.token,
    method: 'POST',
    body: { text: '秀兰奶奶早上好，该吃降压药了。', tone: 'dialect_dongbei', aiConsent: true },
  })
  assert.equal(result.status, 200)
  const request = mockRequests.filter((item) => item.url === '/v1/audio/speech').at(-1)
  assert.ok(request)
  assert.equal(request.body.input.voice, 'mock-dongbei-voice')
  assert.equal(result.data.voice, 'mock-dongbei-voice')
})

test('可重生成 AI 温情陪伴播报文案', async () => {
  resetMock('normal')
  const listed = await api(`/homes/${context.homeId}/reminders?status=pending`, {
    token: context.owner.token,
  })
  assert.equal(listed.status, 200)
  assert.ok(listed.data.reminders.length >= 1)
  const reminderId = listed.data.reminders[0].id

  const result = await api(`/homes/${context.homeId}/reminders/${reminderId}/regenerate-voice`, {
    token: context.owner.token,
    method: 'POST',
    body: { preferAi: true, aiConsent: true },
  })
  assert.equal(result.status, 200)
  assert.match(result.data.reminder.voiceText, /测试降压药/)
  assert.ok(result.data.reminder.voiceGeneratedOn)
  assert.equal(result.data.reminder.voiceGenerationSource, 'ai')
  assert.match(result.data.reminder.voiceText, /好心情|家人|慢慢来/)

  const refresh = await api(`/homes/${context.homeId}/reminders/refresh-companion`, {
    token: context.elder.token,
    method: 'POST',
    body: { preferAi: true, aiConsent: true },
  })
  assert.equal(refresh.status, 200)
  assert.ok(refresh.data.reminders.every((item) => item.voiceGenerationSource === 'ai'))

  const repeated = await api(`/homes/${context.homeId}/reminders/refresh-companion`, {
    token: context.elder.token,
    method: 'POST',
    body: { preferAi: true, aiConsent: true },
  })
  assert.equal(repeated.status, 200)
  assert.equal(repeated.data.refreshed, 0)
})

test('温情文案刷新限制权限、强制刷新和隐私同意', async () => {
  const viewer = await api(`/homes/${context.homeId}/reminders/refresh-companion`, {
    token: context.viewer.token,
    method: 'POST',
    body: { preferAi: false },
  })
  assert.equal(viewer.status, 403)

  const elderForce = await api(`/homes/${context.homeId}/reminders/refresh-companion`, {
    token: context.elder.token,
    method: 'POST',
    body: { force: true, preferAi: false },
  })
  assert.equal(elderForce.status, 403)

  const noConsent = await api(`/homes/${context.homeId}/reminders/refresh-companion`, {
    token: context.elder.token,
    method: 'POST',
    body: { preferAi: true },
  })
  assert.equal(noConsent.status, 400)
})

test('AI 返回医疗或剂量建议时回退安全模板', async () => {
  resetMock('companion_unsafe')
  const listed = await api(`/homes/${context.homeId}/reminders`, { token: context.owner.token })
  const reminderId = listed.data.reminders[0].id
  const result = await api(`/homes/${context.homeId}/reminders/${reminderId}/regenerate-voice`, {
    token: context.owner.token,
    method: 'POST',
    body: { preferAi: true, aiConsent: true },
  })
  assert.equal(result.status, 200)
  assert.equal(result.data.reminder.voiceGenerationSource, 'template')
  assert.ok(!/两片|血压|停药|疗程/.test(result.data.reminder.voiceText))

  // 模型临时返回不安全内容时只标记为模板；当天恢复后仍会再次尝试 AI。
  resetMock('normal')
  const retry = await api(`/homes/${context.homeId}/reminders/refresh-companion`, {
    token: context.owner.token,
    method: 'POST',
    body: { elderId: context.elderId, preferAi: true, aiConsent: true },
  })
  assert.equal(retry.status, 200)
  const regenerated = retry.data.reminders.find((item) => item.id === reminderId)
  assert.equal(regenerated?.voiceGenerationSource, 'ai')
})

test('陪伴文案上游请求同时受服务端超时控制', async () => {
  resetMock('slow')
  const listed = await api(`/homes/${context.homeId}/reminders`, { token: context.owner.token })
  const startedAt = Date.now()
  const result = await api(`/homes/${context.homeId}/reminders/${listed.data.reminders[0].id}/regenerate-voice`, {
    token: context.owner.token,
    method: 'POST',
    body: { preferAi: true, aiConsent: true },
  })
  assert.equal(result.status, 200)
  assert.equal(result.data.reminder.voiceGenerationSource, 'template')
  assert.ok(Date.now() - startedAt < 850)
})

test('AI 温情文案按用户限制刷新频率', async () => {
  resetMock('normal')
  const listed = await api(`/homes/${context.homeId}/reminders`, { token: context.editor.token })
  const reminderId = listed.data.reminders[0].id
  for (let index = 0; index < 4; index += 1) {
    const allowed = await api(`/homes/${context.homeId}/reminders/${reminderId}/regenerate-voice`, {
      token: context.editor.token,
      method: 'POST',
      body: { preferAi: true, aiConsent: true },
    })
    assert.equal(allowed.status, 200)
  }
  const limited = await api(`/homes/${context.homeId}/reminders/${reminderId}/regenerate-voice`, {
    token: context.editor.token,
    method: 'POST',
    body: { preferAi: true, aiConsent: true },
  })
  assert.equal(limited.status, 429)
})

test('老人录音通过独立 STT 配置识别为文字', async () => {
  resetMock('normal')
  const result = await api(`/homes/${context.homeId}/ai/transcribe`, {
    token: context.elder.token,
    method: 'POST',
    body: { audioBase64: Buffer.from('mock-mp3-audio').toString('base64'), format: 'mp3' },
  })
  assert.equal(result.status, 200)
  assert.equal(result.data.text, '我刚吃了药')
  assert.ok(mockRequests.some((item) => item.url === '/v1/audio/transcriptions' && item.method === 'POST'))
  assert.ok(mockRequests.some((item) => item.url === '/api/v1/tasks/mock-asr-task' && item.method === 'GET'))
})
