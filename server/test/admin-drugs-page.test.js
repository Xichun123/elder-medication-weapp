import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const pagePath = path.resolve(import.meta.dirname, '../../pages/admin-drugs/index.js')
const pageSource = fs.readFileSync(pagePath, 'utf8')

function loadPage() {
  let definition
  const calls = { created: [], emitted: [], navigateBack: 0, toasts: [] }
  const handlers = {}
  const eventChannel = {
    on(name, handler) { handlers[name] = handler },
    emit(name, value) {
      calls.emitted.push({ name, value })
      if (handlers[name]) handlers[name](value)
    },
  }
  const api = {
    drugs: {
      list: async () => [],
      create: async (data) => {
        calls.created.push(data)
        return { ...data, drug_id: 'D9' }
      },
      update: async () => ({}),
      remove: async () => null,
    },
  }
  const modules = {
    '../../utils/api': api,
    '../../utils/config': { useLocalApi: false },
    '../../utils/session': { getHome: () => ({ id: 'H1' }) },
    '../../utils/store': { canEdit: () => true },
    '../../utils/common-drugs': {
      categoryLabels: {
        antibiotic: '抗感染药',
        cardiovascular: '心脑血管药',
        hypoglycemic: '降糖药',
        other: '其他常用药',
      },
    },
    '../../utils/helpers': {
      unwrap: (value) => value,
      toast: (message) => calls.toasts.push(message),
      showError: (error) => { throw error },
      confirm: async () => true,
      makeId: () => 'D-local',
    },
  }
  const wx = {
    navigateBack: () => { calls.navigateBack += 1 },
    reLaunch: () => {},
  }

  vm.runInNewContext(pageSource, {
    Page: (value) => { definition = value },
    require: (id) => modules[id],
    wx,
  }, { filename: pagePath })

  const page = { ...definition, data: { ...definition.data } }
  page.setData = (values) => Object.assign(page.data, values)
  page.getOpenerEventChannel = () => eventChannel
  return { calls, eventChannel, page }
}

test('从用药录入新增药物时预填草稿，保存后回传并返回', async () => {
  const { calls, eventChannel, page } = loadPage()

  page.onLoad({ mode: 'create', source: 'medication' })
  eventChannel.emit('drugCreateDraft', {
    generic_name: '新药通用名',
    trade_name: '新药商品名',
    dosage_text: '20mg',
    category: 'other',
  })

  assert.equal(page.data.editing, true)
  assert.equal(page.data.form.generic_name, '新药通用名')
  assert.equal(page.data.form.trade_name, '新药商品名')
  assert.equal(page.data.form.dosage_text, '20mg')

  await page.save()

  assert.equal(calls.created.length, 1)
  assert.equal(calls.created[0].generic_name, '新药通用名')
  const returned = calls.emitted.find((item) => item.name === 'drugCreated')
  assert.equal(returned.value.drug_id, 'D9')
  assert.equal(calls.navigateBack, 1)
})

test('药物分类包含新药库分类并兼容旧分类编辑', () => {
  const { page } = loadPage()
  assert.ok(page.data.formCategories.some((item) => item.value === 'cardiovascular' && item.label === '心脑血管药'))
  assert.ok(page.data.formCategories.some((item) => item.value === 'antibiotic' && item.label === '抗感染药'))
  assert.ok(page.data.categories.some((item) => item.value === 'antihypertensive'))

  page.openEdit({ currentTarget: { dataset: { id: 'missing' } } })
  page.setData({
    list: [{ drug_id: 'Dlegacy', generic_name: '旧分类药', category: 'antihypertensive', is_system: false }],
  })
  page.openEdit({ currentTarget: { dataset: { id: 'Dlegacy' } } })
  assert.equal(page.data.form.category, 'antihypertensive')
  assert.equal(page.data.formCategories[page.data.formCategoryIndex].value, 'antihypertensive')
})
