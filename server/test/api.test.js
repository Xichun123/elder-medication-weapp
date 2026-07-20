import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import test from 'node:test'

const serverRoot = path.resolve(import.meta.dirname, '..')
const port = 19000 + Math.floor(Math.random() * 1000)
const baseUrl = `http://127.0.0.1:${port}`
let tempDir
let child

async function waitForServer() {
  let lastError
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw lastError || new Error('API 启动超时')
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

function requestWithDeclaredLength(pathname, { token, length }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'multipart/form-data; boundary=body-limit-test',
        'content-length': String(length),
      },
    }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, text }))
    })
    request.on('error', reject)
    request.end()
  })
}

async function login(devOpenid, nickname) {
  const result = await api('/auth/wx-login', {
    method: 'POST',
    body: { devOpenid, nickname },
  })
  assert.equal(result.status, 200)
  assert.ok(result.data.token)
  assert.equal(result.data.user.openid, undefined)
  assert.equal(result.data.sessionKey, undefined)
  return result.data
}

test.before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'yao-ling-tong-api-'))
  child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      ALLOW_DEV_LOGIN: '1',
      JWT_SECRET: 'test-secret-at-least-32-characters-long',
      DATABASE_PATH: path.join(tempDir, 'test.db'),
      WX_APP_ID: '',
      WX_APP_SECRET: '',
      RECOGNITION_API_URL: '',
      RECOGNITION_API_KEY: '',
      RECOGNITION_MODEL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForServer()
})

test.after(async () => {
  if (child && !child.killed) {
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))
  }
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

test('未配置微信密钥时拒绝正式登录', async () => {
  const result = await api('/auth/wx-login', {
    method: 'POST',
    body: { code: 'one-time-code' },
  })
  assert.equal(result.status, 503)
  assert.equal(result.data.error, '微信登录暂不可用')
})

test('owner、家属与老人权限闭环', async () => {
  const owner = await login('owner-openid', '家庭创建人')

  const me = await api('/me', { token: owner.token })
  assert.equal(me.status, 200)
  assert.equal(me.data.user.openid, undefined)

  const createdHome = await api('/homes', {
    token: owner.token,
    method: 'POST',
    body: { name: '测试家庭' },
  })
  assert.equal(createdHome.status, 201)
  assert.equal(createdHome.data.home.role, 'owner')
  const homeId = createdHome.data.home.id

  const recognitionForm = new FormData()
  recognitionForm.append('image', new Blob(['test-image'], { type: 'image/jpeg' }), 'medicine.jpg')
  const recognitionResponse = await fetch(`${baseUrl}/homes/${homeId}/recognitions/medication`, {
    method: 'POST',
    headers: { authorization: `Bearer ${owner.token}` },
    body: recognitionForm,
  })
  assert.equal(recognitionResponse.status, 503)
  assert.equal((await recognitionResponse.json()).error, '拍照识别尚未配置，请先手动录入')

  const retryForm = new FormData()
  retryForm.append('image', new Blob(['test-image'], { type: 'image/jpeg' }), 'medicine.jpg')
  const retryResponse = await fetch(`${baseUrl}/homes/${homeId}/recognitions/medication`, {
    method: 'POST',
    headers: { authorization: `Bearer ${owner.token}` },
    body: retryForm,
  })
  assert.equal(retryResponse.status, 429)

  const oversizedResponse = await requestWithDeclaredLength(`/homes/${homeId}/recognitions/medication`, {
    token: owner.token,
    length: 6 * 1024 * 1024 + 1,
  })
  assert.equal(oversizedResponse.status, 413)

  const createdElder = await api(`/homes/${homeId}/elders`, {
    token: owner.token,
    method: 'POST',
    body: { name: '李奶奶', age: 72, relationship: '母亲' },
  })
  assert.equal(createdElder.status, 201)
  const elderProfileId = createdElder.data.elder.id

  const editorInvite = await api(`/homes/${homeId}/invites`, {
    token: owner.token,
    method: 'POST',
    body: { role: 'caregiver_edit' },
  })
  assert.equal(editorInvite.status, 201)

  const editor = await login('editor-openid', '可录入家属')
  const editorJoin = await api('/homes/join', {
    token: editor.token,
    method: 'POST',
    body: { code: editorInvite.data.invite.code },
  })
  assert.equal(editorJoin.status, 200)
  assert.equal(editorJoin.data.home.role, 'caregiver_edit')

  const forbiddenInvite = await api(`/homes/${homeId}/invites`, {
    token: editor.token,
    method: 'POST',
    body: { role: 'caregiver_view' },
  })
  assert.equal(forbiddenInvite.status, 403)

  const editorCreatesElder = await api(`/homes/${homeId}/elders`, {
    token: editor.token,
    method: 'POST',
    body: { name: '王爷爷', age: 75, relationship: '父亲' },
  })
  assert.equal(editorCreatesElder.status, 201)

  const elderInvite = await api(`/homes/${homeId}/invites`, {
    token: owner.token,
    method: 'POST',
    body: { role: 'elder', elderProfileId },
  })
  assert.equal(elderInvite.status, 201)

  const duplicateActiveInvite = await api(`/homes/${homeId}/invites`, {
    token: owner.token,
    method: 'POST',
    body: { role: 'elder', elderProfileId },
  })
  assert.equal(duplicateActiveInvite.status, 200)
  assert.equal(duplicateActiveInvite.data.invite.code, elderInvite.data.invite.code)

  const elder = await login('elder-openid', '李奶奶')
  const elderJoin = await api('/homes/join', {
    token: elder.token,
    method: 'POST',
    body: { code: elderInvite.data.invite.code },
  })
  assert.equal(elderJoin.status, 200)
  assert.equal(elderJoin.data.home.role, 'elder')

  const visibleElders = await api(`/homes/${homeId}/elders`, { token: elder.token })
  assert.equal(visibleElders.status, 200)
  assert.deepEqual(visibleElders.data.elders.map((item) => item.id), [elderProfileId])

  const inviteAfterBinding = await api(`/homes/${homeId}/invites`, {
    token: owner.token,
    method: 'POST',
    body: { role: 'elder', elderProfileId },
  })
  assert.equal(inviteAfterBinding.status, 409)

  const unauthorized = await api('/homes', { token: 'invalid-token' })
  assert.equal(unauthorized.status, 401)
})

test('用药记录、提醒重建、禁忌与权限', async () => {
  const owner = await login('biz-owner', '业务创建人')
  const home = await api('/homes', { token: owner.token, method: 'POST', body: { name: '业务家庭' } })
  assert.equal(home.status, 201)
  const homeId = home.data.home.id

  const elderRes = await api(`/homes/${homeId}/elders`, {
    token: owner.token,
    method: 'POST',
    body: { name: '赵奶奶', age: 70, relationship: '母亲', gender: 'female' },
  })
  assert.equal(elderRes.status, 201)
  const elderId = elderRes.data.elder.id

  const drugs = await api(`/homes/${homeId}/drugs?keyword=阿司匹林`, { token: owner.token })
  assert.equal(drugs.status, 200)
  assert.ok(drugs.data.drugs.length >= 1)
  const aspirin = drugs.data.drugs.find((item) => item.genericName === '阿司匹林')
  assert.ok(aspirin)
  assert.equal(aspirin.isSystem, true)

  const metforminList = await api(`/homes/${homeId}/drugs?keyword=二甲双胍`, { token: owner.token })
  const metformin = metforminList.data.drugs.find((item) => item.genericName === '二甲双胍')
  assert.ok(metformin)

  const createdRecord = await api(`/homes/${homeId}/records`, {
    token: owner.token,
    method: 'POST',
    body: {
      elderProfileId: elderId,
      drugId: aspirin.id,
      dose: '100mg',
      frequency: '每日2次',
      startDate: '2026-01-01',
    },
  })
  assert.equal(createdRecord.status, 201)
  assert.equal(createdRecord.data.autoCreatedReminders.length, 2)
  assert.equal(createdRecord.data.record.drugName, '阿司匹林')
  const warmVoice = createdRecord.data.autoCreatedReminders[0].voiceText || ''
  assert.match(warmVoice, /阿司匹林/)
  assert.match(warmVoice, /该吃/)
  assert.ok(!warmVoice.includes('该服'))
  assert.equal(createdRecord.data.autoCreatedReminders[0].voiceGenerationSource, 'template')
  const recordId = createdRecord.data.record.id
  const reminderId = createdRecord.data.autoCreatedReminders[0].id

  const pending = await api(`/homes/${homeId}/reminders?status=pending`, { token: owner.token })
  assert.equal(pending.status, 200)
  assert.equal(pending.data.reminders.length, 2)
  assert.deepEqual(pending.data.reminders.map((item) => item.remindTime), ['早8:00', '晚20:00'])

  // 只改剂量，不重建提醒
  const doseOnly = await api(`/homes/${homeId}/records/${recordId}`, {
    token: owner.token,
    method: 'PATCH',
    body: { dose: '50mg' },
  })
  assert.equal(doseOnly.status, 200)
  assert.equal(doseOnly.data.record.dose, '50mg')
  const afterDose = await api(`/homes/${homeId}/reminders`, { token: owner.token })
  assert.equal(afterDose.data.reminders.length, 2)
  assert.equal(afterDose.data.reminders[0].id, reminderId)

  // 标记已服
  const taken = await api(`/homes/${homeId}/reminders/${reminderId}/take`, {
    token: owner.token,
    method: 'POST',
  })
  assert.equal(taken.status, 200)
  assert.equal(taken.data.reminder.status, 'taken')

  // 改频次重建提醒，状态重置
  const freqChange = await api(`/homes/${homeId}/records/${recordId}`, {
    token: owner.token,
    method: 'PATCH',
    body: { frequency: '每日3次' },
  })
  assert.equal(freqChange.status, 200)
  const afterFreq = await api(`/homes/${homeId}/reminders`, { token: owner.token })
  assert.equal(afterFreq.data.reminders.length, 3)
  assert.ok(afterFreq.data.reminders.every((item) => item.status === 'pending'))
  assert.ok(!afterFreq.data.reminders.some((item) => item.id === reminderId))

  // 再加二甲双胍，触发饮食禁忌
  await api(`/homes/${homeId}/records`, {
    token: owner.token,
    method: 'POST',
    body: {
      elderProfileId: elderId,
      drugId: metformin.id,
      dose: '0.5g',
      frequency: '每日2次',
      startDate: '2026-01-01',
    },
  })
  const dashboard = await api(`/homes/${homeId}/elders/${elderId}/dashboard`, { token: owner.token })
  assert.equal(dashboard.status, 200)
  assert.equal(dashboard.data.medications.length, 2)
  assert.ok(dashboard.data.risks.some((item) => item.drugAName === '阿司匹林' || item.drugAName === '二甲双胍'))
  assert.ok(dashboard.data.risks.some((item) => item.drugBName === '布洛芬' || item.drugBName === '酒精'))

  // 尚未开始和已经结束的记录不进入今日提醒/当日风险。
  const inactiveRecords = [
    { startDate: '2999-01-01', endDate: null },
    { startDate: '1900-01-01', endDate: '1900-01-02' },
  ]
  for (const dates of inactiveRecords) {
    const inactive = await api(`/homes/${homeId}/records`, {
      token: owner.token,
      method: 'POST',
      body: {
        elderProfileId: elderId,
        drugId: aspirin.id,
        dose: '100mg',
        frequency: '每日1次',
        ...dates,
      },
    })
    assert.equal(inactive.status, 201)
  }
  const todayAfterInactive = await api(`/homes/${homeId}/reminders`, { token: owner.token })
  assert.equal(todayAfterInactive.data.reminders.length, 5)
  const dashboardAfterInactive = await api(`/homes/${homeId}/elders/${elderId}/dashboard`, { token: owner.token })
  assert.equal(dashboardAfterInactive.data.medications.length, 2)

  const overview = await api(`/homes/${homeId}/overview`, { token: owner.token })
  assert.equal(overview.status, 200)
  assert.equal(overview.data.elders.length, 1)
  assert.ok(overview.data.stats.medicationCount >= 2)
  assert.ok(overview.data.stats.reminderPendingCount >= 1)

  // viewer 禁止写
  const viewerInvite = await api(`/homes/${homeId}/invites`, {
    token: owner.token,
    method: 'POST',
    body: { role: 'caregiver_view' },
  })
  const viewer = await login('biz-viewer', '只读')
  await api('/homes/join', { token: viewer.token, method: 'POST', body: { code: viewerInvite.data.invite.code } })
  const viewerWrite = await api(`/homes/${homeId}/records`, {
    token: viewer.token,
    method: 'POST',
    body: {
      elderProfileId: elderId,
      drugId: aspirin.id,
      dose: '100mg',
      frequency: '每日1次',
      startDate: '2026-01-01',
    },
  })
  assert.equal(viewerWrite.status, 403)
  const viewerTake = await api(`/homes/${homeId}/reminders/${afterFreq.data.reminders[0].id}/take`, {
    token: viewer.token,
    method: 'POST',
  })
  assert.equal(viewerTake.status, 403)

  // 老人只看本人，可确认已服
  const elderInvite = await api(`/homes/${homeId}/invites`, {
    token: owner.token,
    method: 'POST',
    body: { role: 'elder', elderProfileId: elderId },
  })
  const elderUser = await login('biz-elder', '赵奶奶')
  await api('/homes/join', {
    token: elderUser.token,
    method: 'POST',
    body: { code: elderInvite.data.invite.code },
  })
  const elderReminders = await api(`/homes/${homeId}/reminders`, { token: elderUser.token })
  assert.equal(elderReminders.status, 200)
  assert.ok(elderReminders.data.reminders.length >= 1)
  assert.ok(elderReminders.data.reminders.every((item) => item.elderProfileId === elderId))

  const elderTake = await api(`/homes/${homeId}/reminders/${elderReminders.data.reminders[0].id}/take`, {
    token: elderUser.token,
    method: 'POST',
  })
  assert.equal(elderTake.status, 200)
  assert.equal(elderTake.data.reminder.status, 'taken')

  // 家属可见老人已服状态
  const familySee = await api(`/homes/${homeId}/reminders/${elderReminders.data.reminders[0].id}`, {
    token: owner.token,
  })
  assert.equal(familySee.data.reminder.status, 'taken')

  // 禁忌同时匹配 drug_a / drug_b：创建本家庭药物对
  const homeDrugA = await api(`/homes/${homeId}/drugs`, {
    token: owner.token,
    method: 'POST',
    body: { genericName: '家庭药A', category: 'other' },
  })
  const homeDrugB = await api(`/homes/${homeId}/drugs`, {
    token: owner.token,
    method: 'POST',
    body: { genericName: '家庭药B', category: 'other' },
  })
  assert.equal(homeDrugA.status, 201)
  const contra = await api(`/homes/${homeId}/contraindications`, {
    token: owner.token,
    method: 'POST',
    body: {
      drugAId: homeDrugA.data.drug.id,
      drugBId: homeDrugB.data.drug.id,
      contraType: 'co_administration',
      severity: 'middle',
      note: '家庭自定义禁忌',
    },
  })
  assert.equal(contra.status, 201)

  await api(`/homes/${homeId}/records`, {
    token: owner.token,
    method: 'POST',
    body: {
      elderProfileId: elderId,
      drugId: homeDrugA.data.drug.id,
      dose: '1片',
      frequency: '每日1次',
      startDate: '2026-02-01',
    },
  })
  await api(`/homes/${homeId}/records`, {
    token: owner.token,
    method: 'POST',
    body: {
      elderProfileId: elderId,
      drugId: homeDrugB.data.drug.id,
      dose: '1片',
      frequency: '每日1次',
      startDate: '2026-02-01',
    },
  })
  const dash2 = await api(`/homes/${homeId}/elders/${elderId}/dashboard`, { token: owner.token })
  assert.ok(dash2.data.risks.some((item) => item.note === '家庭自定义禁忌' && item.relevance === '同时服用中'))

  // 删除记录级联提醒
  const beforeDelete = await api(`/homes/${homeId}/reminders`, { token: owner.token })
  const deleteRecord = await api(`/homes/${homeId}/records/${recordId}`, {
    token: owner.token,
    method: 'DELETE',
  })
  assert.equal(deleteRecord.status, 200)
  const afterDelete = await api(`/homes/${homeId}/reminders`, { token: owner.token })
  assert.ok(afterDelete.data.reminders.length < beforeDelete.data.reminders.length)

  // 成员管理：editor 不能改角色
  const editorInvite = await api(`/homes/${homeId}/invites`, {
    token: owner.token,
    method: 'POST',
    body: { role: 'caregiver_edit' },
  })
  const editor = await login('biz-editor', '编辑')
  const joinEditor = await api('/homes/join', {
    token: editor.token,
    method: 'POST',
    body: { code: editorInvite.data.invite.code },
  })
  assert.equal(joinEditor.status, 200)
  const members = await api(`/homes/${homeId}/members`, { token: owner.token })
  const editorMember = members.data.members.find((item) => item.role === 'caregiver_edit' && item.nickname === '编辑')
  assert.ok(editorMember)
  const editorPatch = await api(`/homes/${homeId}/members/${editorMember.id}`, {
    token: editor.token,
    method: 'PATCH',
    body: { role: 'caregiver_view' },
  })
  assert.equal(editorPatch.status, 403)
  const ownerPatch = await api(`/homes/${homeId}/members/${editorMember.id}`, {
    token: owner.token,
    method: 'PATCH',
    body: { role: 'caregiver_view' },
  })
  assert.equal(ownerPatch.status, 200)
  assert.equal(ownerPatch.data.member.role, 'caregiver_view')
})
