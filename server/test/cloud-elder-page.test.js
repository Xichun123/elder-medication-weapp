import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const pagePath = path.resolve(import.meta.dirname, '../../pages/cloud-elder/index.js')
const pageSource = fs.readFileSync(pagePath, 'utf8')
const pageTemplate = fs.readFileSync(path.resolve(import.meta.dirname, '../../pages/cloud-elder/index.wxml'), 'utf8')

function reminder(id, time) {
  return {
    rule_id: id,
    drug_name: id === 'T1' ? '阿司匹林' : '二甲双胍',
    dose: id === 'T1' ? '100mg' : '500mg',
    remind_time: time,
    status: 'pending',
    status_label: '待服',
    voice_text: '请按时服药',
    package_image_url: 'https://api.example.test/package-images/' + id,
  }
}

function loadPage(initialNow = '2026-07-20T07:59:00+08:00') {
  let definition
  let reminders = []
  let now = new Date(initialNow)
  let timerCallback = null
  const calls = { spoken: [], taken: [] }
  const modules = {
    '../../utils/api': {
      reminders: {
        list: async () => reminders,
        take: async (id) => {
          calls.taken.push(id)
          reminders = reminders.filter((item) => item.rule_id !== id)
        },
      },
    },
    '../../utils/remote': {
      request: async () => ({}),
      setToken: () => {},
    },
    '../../utils/session': {
      getHome: () => ({ id: 'H1', name: '安心家庭', role: 'elder', elderProfileId: 'E1' }),
      setHome: () => {},
      clear: () => {},
      setSignedOut: () => {},
    },
    '../../utils/voice': {
      speak: async (text) => { calls.spoken.push(text) },
      stop: () => {},
    },
    '../../utils/helpers': {
      toast: () => {},
      showError: (error) => { throw error },
      confirm: async () => true,
    },
  }

  vm.runInNewContext(pageSource, {
    Page: (value) => { definition = value },
    require: (id) => modules[id],
    wx: {
      reLaunch: () => {},
      stopPullDownRefresh: () => {},
    },
    Date,
    setInterval: (callback) => {
      timerCallback = callback
      return 1
    },
    clearInterval: () => {},
  }, { filename: pagePath })

  const page = {
    ...definition,
    data: {
      ...definition.data,
      home: { id: 'H1', name: '安心家庭', role: 'elder' },
      elder: { id: 'E1', name: '李奶奶', voice_tone: 'gentle' },
    },
  }
  page.setData = (values) => Object.assign(page.data, values)
  page.getNow = () => new Date(now)

  return {
    calls,
    page,
    runTimer: async () => timerCallback && timerCallback(),
    setNow: (value) => { now = new Date(value) },
    setReminders: (value) => { reminders = value },
  }
}

test('真实老人页未到时间不弹窗，到点后显示包装图和剂量', async () => {
  const { calls, page, setNow, setReminders } = loadPage()
  const morning = reminder('T1', '08:00')
  setReminders([morning])

  await page.loadReminders()
  assert.equal(page.data.current.rule_id, 'T1')
  assert.equal(page.data.currentDue, false)
  assert.equal(page.data.showMedicationPrompt, false)
  assert.equal(calls.spoken.length, 0)

  setNow('2026-07-20T08:00:00+08:00')
  await page.loadReminders()
  assert.equal(page.data.currentDue, true)
  assert.equal(page.data.showMedicationPrompt, true)
  assert.equal(page.data.promptReminder.package_image_url, morning.package_image_url)
  assert.equal(page.data.promptReminder.dose, '100mg')
  assert.equal(calls.spoken.length, 1)

  page.closeMedicationPrompt()
  setNow('2026-07-20T08:09:00+08:00')
  await page.loadReminders()
  assert.equal(page.data.showMedicationPrompt, false)
  assert.equal(calls.spoken.length, 1)

  setNow('2026-07-20T08:10:00+08:00')
  await page.loadReminders()
  assert.equal(page.data.showMedicationPrompt, true)
  assert.equal(page.data.promptReminder.rule_id, 'T1')
  assert.equal(calls.spoken.length, 2)
})

test('前一条仍待服时，同日后续提醒到点仍会弹出', async () => {
  const { page, setNow, setReminders } = loadPage('2026-07-20T08:00:00+08:00')
  setReminders([reminder('T1', '08:00'), reminder('T2', '20:00')])

  await page.loadReminders()
  assert.equal(page.data.promptReminder.rule_id, 'T1')
  page.closeMedicationPrompt()

  setNow('2026-07-20T19:59:00+08:00')
  await page.loadReminders()
  assert.equal(page.data.showMedicationPrompt, true)
  assert.equal(page.data.promptReminder.rule_id, 'T1')
  page.closeMedicationPrompt()

  setNow('2026-07-20T20:00:00+08:00')
  await page.loadReminders()
  assert.equal(page.data.showMedicationPrompt, true)
  assert.equal(page.data.promptReminder.rule_id, 'T2')
})

test('确认当前弹窗后仍会保留下一条到点提醒', async () => {
  const { calls, page, setReminders } = loadPage('2026-07-20T20:00:00+08:00')
  setReminders([reminder('T1', '08:00'), reminder('T2', '20:00')])

  await page.loadReminders()
  assert.equal(page.data.promptReminder.rule_id, 'T2')
  await page.takePrompt()

  assert.deepEqual(calls.taken, ['T2'])
  assert.equal(page.data.showMedicationPrompt, true)
  assert.equal(page.data.promptReminder.rule_id, 'T1')
})

test('关闭自动语音后，定时刷新仍会触发视觉提醒', async () => {
  const { calls, page, runTimer, setNow, setReminders } = loadPage()
  setReminders([reminder('T1', '08:00')])
  page.onAutoChange({ detail: { value: false } })
  page.startTimer()

  setNow('2026-07-20T08:00:00+08:00')
  await runTimer()

  assert.equal(page.data.showMedicationPrompt, true)
  assert.equal(page.data.promptReminder.rule_id, 'T1')
  assert.equal(calls.spoken.length, 0)
})

test('真实老人页模板展示包装图、剂量和到点确认卡', () => {
  assert.match(pageTemplate, /current\.package_image_url/)
  assert.match(pageTemplate, /current\.dose/)
  assert.match(pageTemplate, /showMedicationPrompt/)
  assert.match(pageTemplate, /takePrompt/)
  assert.match(pageTemplate, /10 分钟后提醒/)
})
