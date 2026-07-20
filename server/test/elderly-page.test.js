import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const pagePath = path.resolve(import.meta.dirname, '../../pages/elderly/index.js')
const pageSource = fs.readFileSync(pagePath, 'utf8')

function loadPage() {
  let definition
  let reminders = []
  const modules = {
    '../../utils/api': {
      elders: { get: async () => ({ elder_id: 'E1', name: '李奶奶' }) },
      reminders: { list: async () => reminders },
    },
    '../../utils/config': { useLocalApi: false },
    '../../utils/session': { getHome: () => ({ id: 'H1' }) },
    '../../utils/voice': { speak: async () => {}, stop: () => {} },
    '../../utils/helpers': {
      unwrap: (value) => value,
      showError: (error) => { throw error },
    },
  }
  vm.runInNewContext(pageSource, {
    Page: (value) => { definition = value },
    require: (id) => modules[id],
    wx: {},
    setInterval,
    clearInterval,
    Date,
  }, { filename: pagePath })

  const page = { ...definition, data: { ...definition.data, elders: [{ elder_id: 'E1' }], elderIndex: 0 } }
  page.setData = (values, callback) => {
    Object.assign(page.data, values)
    if (callback) callback()
  }
  return { page, setReminders: (value) => { reminders = value } }
}

test('新的待服提醒自动弹出对应药品包装照片', async () => {
  const { page, setReminders } = loadPage()
  const first = {
    rule_id: 'T1',
    drug_name: '阿司匹林',
    dose: '100mg',
    remind_time: '早8:00',
    status: 'pending',
    package_image_url: 'https://api.example.test/package-images/I1',
  }
  setReminders([first])

  await page.loadReminders()
  assert.equal(page.data.showMedicationPrompt, true)
  assert.equal(page.data.promptReminder.rule_id, 'T1')
  assert.equal(page.data.promptReminder.package_image_url, first.package_image_url)

  page.closeMedicationPrompt()
  await page.loadReminders()
  assert.equal(page.data.showMedicationPrompt, false)

  setReminders([{ ...first, rule_id: 'T2', remind_time: '晚20:00' }])
  await page.loadReminders()
  assert.equal(page.data.showMedicationPrompt, true)
  assert.equal(page.data.promptReminder.rule_id, 'T2')
})
