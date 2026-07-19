import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
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
