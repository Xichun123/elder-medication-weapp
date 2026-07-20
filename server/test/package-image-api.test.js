import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { createPackageImagePath, verifyPackageImageSignature } from '../src/package-images.js'

const serverRoot = path.resolve(import.meta.dirname, '..')
const port = 21000 + Math.floor(Math.random() * 1000)
const baseUrl = `http://127.0.0.1:${port}`
let child
let databasePath
let tempDir

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('API 启动超时')
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

async function login(openid, nickname) {
  const result = await api('/auth/wx-login', {
    method: 'POST',
    body: { devOpenid: openid, nickname },
  })
  assert.equal(result.status, 200)
  return result.data
}

async function uploadImage(homeId, drugId, token, bytes, type = 'image/jpeg') {
  const form = new FormData()
  form.append('image', new Blob([bytes], { type }), 'package.jpg')
  const response = await fetch(`${baseUrl}/homes/${homeId}/drugs/${drugId}/package-image`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  return { status: response.status, data: await response.json() }
}

async function createInvite(homeId, ownerToken, role, elderProfileId) {
  const result = await api(`/homes/${homeId}/invites`, {
    token: ownerToken,
    method: 'POST',
    body: { role, ...(elderProfileId ? { elderProfileId } : {}) },
  })
  assert.ok([200, 201].includes(result.status))
  return result.data.invite.code
}

test.before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'yao-ling-tong-images-'))
  databasePath = path.join(tempDir, 'test.db')
  child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      ALLOW_DEV_LOGIN: '1',
      JWT_SECRET: 'package-image-test-secret-at-least-32-chars',
      DATABASE_PATH: databasePath,
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

test('过期的包装照片签名不可使用', () => {
  const expiredPath = createPackageImagePath('I-expired', Date.now() - 16 * 60 * 1000)
  const url = new URL(expiredPath, 'https://api.example.test')
  assert.equal(
    verifyPackageImageSignature('I-expired', url.searchParams.get('expires'), url.searchParams.get('signature')),
    false,
  )
})

test('药品包装照片按家庭绑定、清除元数据并安全提供给老人提醒', async () => {
  const owner = await login('image-owner', '图片家庭创建人')
  const home = await api('/homes', {
    token: owner.token,
    method: 'POST',
    body: { name: '图片测试家庭' },
  })
  const homeId = home.data.home.id
  const elderResult = await api(`/homes/${homeId}/elders`, {
    token: owner.token,
    method: 'POST',
    body: { name: '测试老人', age: 72, relationship: '母亲' },
  })
  const elderId = elderResult.data.elder.id
  const drugs = await api(`/homes/${homeId}/drugs`, { token: owner.token })
  const aspirin = drugs.data.drugs.find((item) => item.genericName === '阿司匹林')
  const metformin = drugs.data.drugs.find((item) => item.genericName === '二甲双胍')

  const invalid = await uploadImage(homeId, aspirin.id, owner.token, Buffer.from('not-an-image'))
  assert.equal(invalid.status, 400)
  const invalidType = await uploadImage(homeId, aspirin.id, owner.token, Buffer.from('GIF89a'), 'image/gif')
  assert.equal(invalidType.status, 400)
  const oversized = await uploadImage(homeId, aspirin.id, owner.token, Buffer.alloc(5 * 1024 * 1024 + 1))
  assert.equal(oversized.status, 400)
  const absentAfterFailure = await api(`/homes/${homeId}/drugs/${aspirin.id}/package-image`, { token: owner.token })
  assert.equal(absentAfterFailure.status, 404)

  const source = await sharp({
    create: { width: 120, height: 80, channels: 3, background: '#e23d3d' },
  }).withMetadata({ exif: { IFD0: { Artist: 'private-location-marker' } } }).jpeg().toBuffer()
  const saved = await uploadImage(homeId, aspirin.id, owner.token, source)
  assert.equal(saved.status, 201)
  assert.equal(saved.data.packageImage.drugId, aspirin.id)
  assert.match(saved.data.packageImage.urlPath, /^\/package-images\//)

  const imageResponse = await fetch(`${baseUrl}${saved.data.packageImage.urlPath}`)
  assert.equal(imageResponse.status, 200)
  assert.equal(imageResponse.headers.get('content-type'), 'image/jpeg')
  const stored = Buffer.from(await imageResponse.arrayBuffer())
  const metadata = await sharp(stored).metadata()
  assert.equal(metadata.exif, undefined)
  assert.ok(metadata.width <= 1600 && metadata.height <= 1600)

  const invalidSignature = await fetch(`${baseUrl}${saved.data.packageImage.urlPath.replace(/signature=[^&]+/, 'signature=invalid')}`)
  assert.equal(invalidSignature.status, 403)

  const record = await api(`/homes/${homeId}/records`, {
    token: owner.token,
    method: 'POST',
    body: {
      elderProfileId: elderId,
      drugId: aspirin.id,
      dose: '100mg',
      frequency: '每日1次',
      startDate: '2026-01-01',
    },
  })
  assert.equal(record.status, 201)

  const elderCode = await createInvite(homeId, owner.token, 'elder', elderId)
  const elder = await login('image-elder', '测试老人')
  await api('/homes/join', { token: elder.token, method: 'POST', body: { code: elderCode } })

  const elderImage = await api(`/homes/${homeId}/drugs/${aspirin.id}/package-image`, { token: elder.token })
  assert.equal(elderImage.status, 200)
  const reminders = await api(`/homes/${homeId}/reminders`, { token: elder.token })
  assert.ok(reminders.data.reminders.length > 0)
  assert.equal(reminders.data.reminders[0].drugId, aspirin.id)
  assert.equal(reminders.data.reminders[0].dose, '100mg')
  assert.match(reminders.data.reminders[0].packageImagePath, /^\/package-images\//)

  const metforminSaved = await uploadImage(homeId, metformin.id, owner.token, source)
  assert.equal(metforminSaved.status, 201)
  const unrelatedImage = await api(`/homes/${homeId}/drugs/${metformin.id}/package-image`, { token: elder.token })
  assert.equal(unrelatedImage.status, 403)
  const failedReplacement = await uploadImage(homeId, metformin.id, owner.token, Buffer.from('broken'))
  assert.equal(failedReplacement.status, 400)
  assert.equal((await fetch(`${baseUrl}${metforminSaved.data.packageImage.urlPath}`)).status, 200)

  const viewerCode = await createInvite(homeId, owner.token, 'caregiver_view')
  const viewer = await login('image-viewer', '只读家属')
  await api('/homes/join', { token: viewer.token, method: 'POST', body: { code: viewerCode } })
  assert.equal((await uploadImage(homeId, aspirin.id, viewer.token, source)).status, 403)
  assert.equal((await uploadImage(homeId, aspirin.id, elder.token, source)).status, 403)
  assert.equal((await api(`/homes/${homeId}/drugs/${aspirin.id}/package-image`, {
    token: viewer.token,
    method: 'DELETE',
  })).status, 403)
  assert.equal((await api(`/homes/${homeId}/drugs/${aspirin.id}/package-image`, {
    token: elder.token,
    method: 'DELETE',
  })).status, 403)

  const editorCode = await createInvite(homeId, owner.token, 'caregiver_edit')
  const editor = await login('image-editor', '可录入家属')
  await api('/homes/join', { token: editor.token, method: 'POST', body: { code: editorCode } })
  const replacement = await uploadImage(homeId, aspirin.id, editor.token, source)
  assert.equal(replacement.status, 201)
  assert.notEqual(replacement.data.packageImage.urlPath, saved.data.packageImage.urlPath)
  assert.equal((await fetch(`${baseUrl}${saved.data.packageImage.urlPath}`)).status, 404)

  const removed = await api(`/homes/${homeId}/drugs/${aspirin.id}/package-image`, {
    token: editor.token,
    method: 'DELETE',
  })
  assert.equal(removed.status, 200)
  assert.equal((await fetch(`${baseUrl}${replacement.data.packageImage.urlPath}`)).status, 404)
})

test('删除药品或家庭时级联清理包装照片', async () => {
  const owner = await login('cleanup-owner', '清理测试创建人')
  const home = await api('/homes', {
    token: owner.token,
    method: 'POST',
    body: { name: '清理测试家庭' },
  })
  const homeId = home.data.home.id
  const source = await sharp({
    create: { width: 40, height: 40, channels: 3, background: '#3e9183' },
  }).jpeg().toBuffer()

  const homeDrug = await api(`/homes/${homeId}/drugs`, {
    token: owner.token,
    method: 'POST',
    body: { genericName: '待删除药品' },
  })
  const drugId = homeDrug.data.drug.id
  const savedDrugImage = await uploadImage(homeId, drugId, owner.token, source)
  assert.equal(savedDrugImage.status, 201)
  assert.equal((await api(`/homes/${homeId}/drugs/${drugId}`, { token: owner.token })).data.drug.packageImagePath.length > 0, true)
  assert.equal((await api(`/homes/${homeId}/drugs/${drugId}`, { token: owner.token, method: 'DELETE' })).status, 200)
  assert.equal((await fetch(`${baseUrl}${savedDrugImage.data.packageImage.urlPath}`)).status, 404)

  const systemDrugs = await api(`/homes/${homeId}/drugs`, { token: owner.token })
  const systemDrug = systemDrugs.data.drugs[0]
  const savedHomeImage = await uploadImage(homeId, systemDrug.id, owner.token, source)
  assert.equal(savedHomeImage.status, 201)

  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = ON')
  database.prepare('DELETE FROM homes WHERE id = ?').run(homeId)
  const remaining = database.prepare('SELECT COUNT(*) AS count FROM drug_package_images WHERE home_id = ?').get(homeId)
  database.close()
  assert.equal(Number(remaining.count), 0)
  assert.equal((await fetch(`${baseUrl}${savedHomeImage.data.packageImage.urlPath}`)).status, 404)
})
