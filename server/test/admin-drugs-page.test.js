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
