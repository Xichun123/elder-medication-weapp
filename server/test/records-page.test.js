import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const pagePath = path.resolve(import.meta.dirname, '../../pages/records/index.js')
const pageSource = fs.readFileSync(pagePath, 'utf8')

function loadPage() {
  let definition
  const modules = {
    '../../utils/api': {
      families: { overview: async () => ({ elders: [] }) },
      records: {
        list: async () => [],
        update: async () => ({}),
        remove: async () => null,
      },
    },
    '../../utils/config': { useLocalApi: false },
    '../../utils/session': { getHome: () => ({ id: 'H1' }) },
    '../../utils/store': { canEdit: () => true, getFamilyId: () => 'H1' },
    '../../utils/frequencies': {
      frequencyOptions: Array.from({ length: 12 }, (_, index) => `每日${index + 1}次`),
    },
    '../../utils/helpers': {
      unwrap: (value) => value,
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
      setStorageSync: () => {},
      switchTab: () => {},
      stopPullDownRefresh: () => {},
    },
  }, { filename: pagePath })

  const page = { ...definition, data: { ...definition.data } }
  page.setData = (values) => {
    Object.entries(values).forEach(([key, value]) => {
      if (!key.includes('.')) {
        page.data[key] = value
        return
      }
      const segments = key.split('.')
      let cursor = page.data
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index]
        if (cursor[segment] == null || typeof cursor[segment] !== 'object') cursor[segment] = {}
        cursor = cursor[segment]
      }
      cursor[segments[segments.length - 1]] = value
    })
  }
  return { page }
}

test('用药记录编辑支持每日一至十二次', () => {
  const { page } = loadPage()
  assert.equal(page.data.frequencyOptions.length, 12)
  assert.equal(page.data.frequencyOptions.at(-1), '每日12次')

  page.setData({
    list: [{
      record_id: 'R1',
      elder_name: '李秀兰',
      drug_name: '测试药',
      dose: '1片',
      frequency: '每日4次',
      start_date: '2026-01-01',
      end_date: '',
    }],
  })
  page.edit({ currentTarget: { dataset: { id: 'R1' } } })
  assert.equal(page.data.editing, true)
  assert.equal(page.data.form.frequency, '每日4次')
  assert.equal(page.data.frequencyIndex, 3)

  page.onFrequencyChange({ detail: { value: '7' } })
  assert.equal(page.data.form.frequency, '每日8次')
  assert.equal(page.data.frequencyIndex, 7)
})
