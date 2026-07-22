import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const pagePath = path.resolve(import.meta.dirname, '../../pages/medication/index.js')
const pageSource = fs.readFileSync(pagePath, 'utf8')

function loadPage({ recognize, match } = {}) {
  let definition
  const calls = { chooseMedia: [], drugs: [], modals: [], navigations: [], packageImages: [], records: [], toasts: [] }
  const api = {
    recognition: {
      recognize: recognize || (async () => ({
        genericName: '阿司匹林',
        tradeName: '',
        strength: '100mg',
        dosageForm: '片剂',
        dosageText: '100mg',
        frequency: '每日1次',
        visibleText: ['阿司匹林'],
        uncertainFields: [],
        warnings: [],
      })),
    },
    drugs: {
      match: match || (async () => []),
      create: async (payload) => {
        calls.drugs.push(payload)
        return { drug_id: 'Dcustom', generic_name: payload.generic_name, category_label: '其他常用药' }
      },
      savePackageImage: async (drugId, filePath) => {
        calls.packageImages.push({ drugId, filePath })
        return { url: 'https://api.example.test/package-images/I1' }
      },
    },
    records: {
      create: async (payload) => {
        calls.records.push(payload)
        return { auto_created_reminders: [] }
      },
    },
    families: { overview: async () => ({ elders: [] }) },
    elders: { list: async () => [] },
  }
  const modules = {
    '../../utils/api': api,
    '../../utils/config': { useLocalApi: false },
    '../../utils/session': { getHome: () => ({ id: 'H1' }) },
    '../../utils/store': { canEdit: () => true, getFamilyId: () => 'H1' },
    '../../utils/frequencies': {
      frequencyOptions: Array.from({ length: 12 }, (_, index) => `每日${index + 1}次`),
    },
    '../../utils/helpers': {
      unwrap: (value) => value,
      toast: (message) => calls.toasts.push(message),
      showError: (error) => { throw error },
      today: () => '2026-07-20',
      makeId: () => 'R1',
    },
  }
  const wx = {
    showModal: (options) => calls.modals.push(options),
    chooseMedia: (options) => calls.chooseMedia.push(options),
    navigateTo: (options) => calls.navigations.push(options),
    getStorageSync: () => '',
    removeStorageSync: () => {},
  }

  vm.runInNewContext(pageSource, {
    Page: (value) => { definition = value },
    require: (id) => modules[id],
    wx,
    setTimeout,
    clearTimeout,
  }, { filename: pagePath })

  const page = { ...definition, data: { ...definition.data } }
  page.setData = (values) => Object.assign(page.data, values)
  return { calls, page }
}

test('用户明确同意照片处理说明后才打开相机或相册', () => {
  const { calls, page } = loadPage()

  page.chooseMedicationPhoto()
  assert.equal(calls.modals.length, 1)
  assert.equal(calls.chooseMedia.length, 0)

  calls.modals[0].success({ confirm: false })
  assert.equal(calls.chooseMedia.length, 0)

  calls.modals[0].success({ confirm: true })
  assert.equal(calls.chooseMedia.length, 1)
})

test('药库匹配失败时保留成功的识别草稿', async () => {
  const recognition = {
    genericName: '二甲双胍',
    tradeName: '',
    strength: '500mg',
    dosageForm: '片剂',
    dosageText: '500mg',
    frequency: '每日2次',
    visibleText: ['二甲双胍'],
    uncertainFields: [],
    warnings: [],
  }
  const { calls, page } = loadPage({
    recognize: async () => recognition,
    match: async () => { throw new Error('match unavailable') },
  })

  await page.recognizeMedicationPhoto('/tmp/medicine.jpg')

  assert.equal(page.data.recognitionImage, '/tmp/medicine.jpg')
  assert.equal(page.data.recognitionResult, recognition)
  assert.equal(page.data.recognitionReviewRequired, true)
  assert.equal(page.data.recognitionConfirmed, false)
  assert.equal(page.data.matchedDrugs.length, 0)
  assert.match(calls.toasts.at(-1), /识别成功.*药库匹配失败/)
})

test('无匹配药品可跳转新增，保存后自动回填', async () => {
  const { calls, page } = loadPage()
  Object.assign(page.data, {
    keyword: '新药通用名',
    dose: '10mg',
    recognitionResult: { tradeName: '新药商品名', dosageText: '20mg' },
    recognitionReviewRequired: true,
    recognitionConfirmed: true,
  })

  page.openCreateDrug()
  assert.equal(calls.navigations.length, 1)
  const navigation = calls.navigations[0]
  assert.equal(navigation.url, '/pages/admin-drugs/index?mode=create&source=medication')

  let draft
  navigation.success({
    eventChannel: {
      emit: (name, value) => {
        assert.equal(name, 'drugCreateDraft')
        draft = value
      },
    },
  })
  assert.equal(draft.generic_name, '新药通用名')
  assert.equal(draft.trade_name, '新药商品名')
  assert.equal(draft.dosage_text, '20mg')
  assert.equal(draft.category, 'other')

  navigation.events.drugCreated({ drug_id: 'D9', generic_name: '新药通用名', dosage_text: '20mg' })
  assert.equal(page.data.selectedDrug.drug_id, 'D9')
  assert.equal(page.data.keyword, '新药通用名')
  assert.equal(page.data.dose, '10mg')
  assert.equal(page.data.recognitionConfirmed, false)
  assert.match(calls.toasts.at(-1), /已回填/)
})

test('AI 草稿未确认时禁止保存且修改关键字段后确认失效', async () => {
  const { calls, page } = loadPage()
  Object.assign(page.data, {
    elders: [{ elder_id: 'E1' }],
    elderIndex: 0,
    selectedDrug: { drug_id: 'D1' },
    dose: '100mg',
    recognitionReviewRequired: true,
    recognitionConfirmed: false,
  })

  await page.save()
  assert.equal(calls.records.length, 0)
  assert.match(calls.toasts.at(-1), /请先确认/)

  page.onRecognitionConfirmChange({ detail: { value: ['confirmed'] } })
  assert.equal(page.data.recognitionConfirmed, true)
  page.onDoseInput({ detail: { value: '50mg' } })
  assert.equal(page.data.recognitionConfirmed, false)

  page.onRecognitionConfirmChange({ detail: { value: ['confirmed'] } })
  await page.save()
  assert.equal(calls.records.length, 1)
  assert.equal(calls.records[0].dose, '50mg')
})

test('只有人工确认后才按选定药品保存包装照片', async () => {
  const { calls, page } = loadPage()
  Object.assign(page.data, {
    recognitionImage: '/tmp/package.jpg',
    recognitionResult: { genericName: '阿司匹林' },
    selectedDrug: { drug_id: 'D1', generic_name: '阿司匹林' },
    recognitionReviewRequired: true,
    recognitionConfirmed: false,
  })

  await page.saveRecognitionPackageImage()
  assert.equal(calls.packageImages.length, 0)

  page.onRecognitionConfirmChange({ detail: { value: ['confirmed'] } })
  await page.saveRecognitionPackageImage()
  assert.deepEqual(calls.packageImages[0], { drugId: 'D1', filePath: '/tmp/package.jpg' })
  assert.equal(page.data.packageImageSaved, true)
  assert.equal(page.data.selectedDrug.has_package_image, true)
})

test('未命中药库时可直接以输入药名建立家庭药品并保存用药', async () => {
  const { calls, page } = loadPage({ match: async () => [] })
  Object.assign(page.data, {
    elders: [{ elder_id: 'E1' }],
    elderIndex: 0,
    keyword: '家属自定义草药A',
    selectedDrug: null,
    dose: '1袋',
    frequency: '每日4次',
  })

  await page.save()

  assert.equal(calls.drugs.length, 1)
  assert.equal(calls.drugs[0].generic_name, '家属自定义草药A')
  assert.equal(calls.drugs[0].category, 'other')
  assert.equal(calls.records.length, 1)
  assert.equal(calls.records[0].drug, 'Dcustom')
  assert.equal(calls.records[0].frequency, '每日4次')
})

test('每日服用次数提供一至十二次选项', () => {
  const { page } = loadPage()
  assert.equal(page.data.frequencyOptions.length, 12)
  assert.equal(page.data.frequencyOptions[0], '每日1次')
  assert.equal(page.data.frequencyOptions.at(-1), '每日12次')
})

test('输入别名精确命中时复用已有药品而不新建', async () => {
  const { calls, page } = loadPage({
    match: async () => [{
      drug_id: 'D1',
      generic_name: '阿莫西林',
      trade_name: '阿莫仙',
      aliases: '羟氨苄青霉素',
    }],
  })
  Object.assign(page.data, {
    elders: [{ elder_id: 'E1' }],
    elderIndex: 0,
    keyword: '羟氨苄青霉素',
    selectedDrug: null,
    dose: '0.5g',
    frequency: '每日3次',
  })

  await page.save()

  assert.equal(calls.drugs.length, 0)
  assert.equal(calls.records.length, 1)
  assert.equal(calls.records[0].drug, 'D1')
  assert.equal(calls.records[0].frequency, '每日3次')
})
