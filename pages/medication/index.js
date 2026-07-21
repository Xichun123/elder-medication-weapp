const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const store = require('../../utils/store')
const { unwrap, toast, showError, today, makeId } = require('../../utils/helpers')

Page({
  data: {
    elders: [], elderIndex: -1, keyword: '', matchedDrugs: [], selectedDrug: null, matching: false,
    dose: '', frequency: '每日2次', frequencyOptions: ['每日1次', '每日2次', '每日3次'], startDate: today(), endDate: '', saving: false, createdReminders: [], showResult: false,
    recognizing: false, creatingRecognizedDrug: false, savingPackageImage: false, packageImageSaved: false, recognitionImage: '', recognitionResult: null, recognitionDetails: [], recognitionVisibleText: '', recognitionUncertainText: '',
    recognitionReviewRequired: false, recognitionConfirmed: false,
    canEdit: true,
  },
  onLoad(options) { this.initialElderId = options.elder || ''; this.loadElders() },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ active: 2 })
    }
    if (!config.useLocalApi && !session.getHome()) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    this.setData({ canEdit: store.canEdit() })
    const familyId = store.getFamilyId()
    const elderId = wx.getStorageSync('elder_medication.medication_elder_id')
    if (elderId) {
      wx.removeStorageSync('elder_medication.medication_elder_id')
      this.initialElderId = elderId
      this.lastFamilyId = familyId
      const elderIndex = this.data.elders.findIndex((item) => item.elder_id === elderId)
      if (elderIndex >= 0) this.setData({ elderIndex })
      else this.loadElders()
      return
    }
    if (this.lastFamilyId !== familyId || !this.data.elders.length) {
      this.lastFamilyId = familyId
      this.loadElders()
    }
  },
  onUnload() { if (this.matchTimer) clearTimeout(this.matchTimer) },

  async loadElders() {
    try {
      const familyId = store.getFamilyId()
      this.lastFamilyId = familyId
      const overview = await api.families.overview(familyId)
      let elders = overview.elders || []
      if (!elders.length) elders = unwrap(await api.elders.list())
      let elderIndex = elders.findIndex((item) => item.elder_id === this.initialElderId)
      if (elderIndex < 0 && elders.length) elderIndex = 0
      this.setData({ elders, elderIndex })
    } catch (error) { showError(error) }
  },
  onElderChange(event) { this.setData({ elderIndex: Number(event.detail.value) }) },
  chooseMedicationPhoto() {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    if (config.useLocalApi) { toast('本地演示模式请手动录入药名'); return }
    wx.showModal({
      title: '照片处理说明',
      content: '你选择的照片将上传至第三方 AI 服务进行识别，可能包含姓名和健康信息。请先遮挡无关个人信息。是否同意并继续？',
      confirmText: '同意继续',
      cancelText: '暂不同意',
      success: (result) => {
        if (result.confirm) this.openMedicationPhotoPicker()
      },
    })
  },
  openMedicationPhotoPicker() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      camera: 'back',
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        if (file.size > 5 * 1024 * 1024) { toast('图片不能超过 5MB'); return }
        this.recognizeMedicationPhoto(file.tempFilePath)
      },
    })
  },
  async recognizeMedicationPhoto(filePath) {
    this.setData({
      recognizing: true,
      recognitionImage: filePath,
      recognitionResult: null,
      recognitionDetails: [],
      recognitionConfirmed: false,
      packageImageSaved: false,
    })
    let result
    let keyword
    try {
      result = await api.recognition.recognize(filePath)
      keyword = result.genericName || result.tradeName
      const details = [
        { label: '通用名', value: result.genericName },
        { label: '商品名', value: result.tradeName },
        { label: '包装规格', value: result.strength },
        { label: '剂型', value: result.dosageForm },
        { label: '生产企业', value: result.manufacturer },
      ].filter((item) => item.value)
      const nextData = {
        recognitionResult: result,
        recognitionDetails: details,
        recognitionVisibleText: (result.visibleText || []).join(' · '),
        recognitionUncertainText: (result.uncertainFields || []).join('、'),
        keyword,
        selectedDrug: null,
        matchedDrugs: [],
        recognitionReviewRequired: true,
        recognitionConfirmed: false,
      }
      if (result.dosageText) nextData.dose = result.dosageText
      if (this.data.frequencyOptions.includes(result.frequency)) nextData.frequency = result.frequency
      this.setData(nextData)
    } catch (error) {
      this.setData({
        recognitionImage: '', recognitionResult: null, recognitionDetails: [],
        recognitionVisibleText: '', recognitionUncertainText: '',
      })
      showError(error)
      this.setData({ recognizing: false })
      return
    }

    try {
      const matches = await api.drugs.match(keyword)
      const names = [result.genericName, result.tradeName].filter(Boolean).map((item) => item.trim().toLowerCase())
      const exact = matches.find((drug) => names.includes(String(drug.generic_name || '').trim().toLowerCase())
        || names.includes(String(drug.trade_name || '').trim().toLowerCase()))
      if (exact) {
        this.setData({
          selectedDrug: exact,
          keyword: exact.generic_name,
          matchedDrugs: [],
          dose: result.dosageText || this.data.dose || exact.dosage_text || '',
          recognitionConfirmed: false,
          packageImageSaved: false,
        })
      } else {
        this.setData({ matchedDrugs: matches })
      }
    } catch (error) {
      this.setData({ matchedDrugs: [] })
      toast('识别成功，但药库匹配失败，请手动搜索药名')
    } finally {
      this.setData({ recognizing: false })
    }
  },
  clearRecognition() {
    this.setData({ recognitionImage: '', recognitionResult: null, recognitionDetails: [], recognitionVisibleText: '', recognitionUncertainText: '' })
  },
  async createRecognizedDrug() {
    const result = this.data.recognitionResult
    const genericName = String(this.data.keyword || '').trim()
    if (!result || !genericName) { toast('请先核对并补充通用名'); return }
    this.setData({ creatingRecognizedDrug: true })
    try {
      const drug = await api.drugs.create({
        generic_name: genericName,
        trade_name: result.tradeName || '',
        aliases: '',
        category: 'other',
        ingredient: '',
        dosage_text: result.dosageText || '',
        contraindication_note: '',
        interaction_note: '',
      })
      this.setData({ selectedDrug: drug, keyword: drug.generic_name, matchedDrugs: [], packageImageSaved: false, ...this.invalidateRecognitionConfirmation() })
      toast('药品档案已建立，请继续核对剂量')
    } catch (error) {
      showError(error)
    } finally {
      this.setData({ creatingRecognizedDrug: false })
    }
  },
  onKeywordInput(event) {
    const keyword = event.detail.value
    this.setData({ keyword, selectedDrug: null, packageImageSaved: false, ...this.invalidateRecognitionConfirmation() })
    if (this.matchTimer) clearTimeout(this.matchTimer)
    this.matchTimer = setTimeout(() => this.match(keyword), 280)
  },
  async match(keyword) {
    if (!String(keyword).trim()) { this.setData({ matchedDrugs: [] }); return }
    this.setData({ matching: true })
    try { this.setData({ matchedDrugs: await api.drugs.match(keyword) }) }
    catch (error) { this.setData({ matchedDrugs: [] }) }
    finally { this.setData({ matching: false }) }
  },
  pickDrug(event) {
    const drug = this.data.matchedDrugs.find((item) => item.drug_id === event.currentTarget.dataset.id)
    if (!drug) return
    this.setData({ selectedDrug: drug, keyword: drug.generic_name, matchedDrugs: [], dose: this.data.dose || drug.dosage_text || '', packageImageSaved: false, ...this.invalidateRecognitionConfirmation() })
  },
  clearDrug() { this.setData({ selectedDrug: null, keyword: '', matchedDrugs: [], packageImageSaved: false, ...this.invalidateRecognitionConfirmation() }) },
  onDoseInput(event) { this.setData({ dose: event.detail.value, ...this.invalidateRecognitionConfirmation() }) },
  chooseFrequency(event) { this.setData({ frequency: event.currentTarget.dataset.value, ...this.invalidateRecognitionConfirmation() }) },
  invalidateRecognitionConfirmation() {
    return this.data.recognitionReviewRequired ? { recognitionConfirmed: false } : {}
  },
  onRecognitionConfirmChange(event) {
    this.setData({ recognitionConfirmed: event.detail.value.includes('confirmed') })
  },
  async saveRecognitionPackageImage() {
    if (this.data.savingPackageImage) return
    const drug = this.data.selectedDrug
    if (!this.data.recognitionImage || !drug) { toast('请先识别并选择药品'); return }
    if (!this.data.recognitionConfirmed) { toast('请先完成人工核对'); return }
    this.setData({ savingPackageImage: true })
    try {
      const image = await api.drugs.savePackageImage(drug.drug_id, this.data.recognitionImage)
      this.setData({
        packageImageSaved: true,
        selectedDrug: { ...drug, has_package_image: true, package_image_url: image.url || '' },
      })
      toast('已保存为该药品的主包装照片')
    } catch (error) {
      showError(error)
    } finally {
      this.setData({ savingPackageImage: false })
    }
  },
  onStartDate(event) { this.setData({ startDate: event.detail.value }) },
  onEndDate(event) { this.setData({ endDate: event.detail.value }) },
  clearEndDate() { this.setData({ endDate: '' }) },
  async save() {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    if (this.data.savingPackageImage) { toast('请等待包装照片保存完成'); return }
    const elder = this.data.elders[this.data.elderIndex]
    if (!elder) { toast('请选择老人'); return }
    if (!this.data.selectedDrug) { toast('请从匹配结果中选择药物'); return }
    if (!this.data.dose) { toast('请输入剂量'); return }
    if (this.data.recognitionReviewRequired && !this.data.recognitionConfirmed) {
      toast('请先确认已核对 AI 识别的药品、剂量与频次')
      return
    }
    this.setData({ saving: true })
    try {
      const payload = {
        elder: elder.elder_id, drug: this.data.selectedDrug.drug_id,
        dose: this.data.dose, frequency: this.data.frequency, start_date: this.data.startDate, end_date: this.data.endDate || null,
      }
      if (config.useLocalApi) payload.record_id = makeId('R')
      const result = await api.records.create(payload)
      this.setData({ createdReminders: result.auto_created_reminders || [], showResult: true })
      this.reset(false)
    } catch (error) { showError(error) }
    finally { this.setData({ saving: false }) }
  },
  reset(closeResult = true) {
    this.setData({
      keyword: '', selectedDrug: null, matchedDrugs: [], dose: '', frequency: '每日2次', startDate: today(), endDate: '',
      recognitionImage: '', recognitionResult: null, recognitionDetails: [], recognitionVisibleText: '', recognitionUncertainText: '',
      recognitionReviewRequired: false, recognitionConfirmed: false, packageImageSaved: false,
      ...(closeResult ? { showResult: false } : {}),
    })
  },
  closeResult() { this.setData({ showResult: false }) },
  goReminders() { this.setData({ showResult: false }); wx.switchTab({ url: '/pages/reminders/index' }) },
})
