const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const store = require('../../utils/store')
const { unwrap, toast, showError, today, makeId } = require('../../utils/helpers')

Page({
  data: {
    elders: [], elderIndex: -1, keyword: '', matchedDrugs: [], selectedDrug: null, matching: false,
    dose: '', frequency: '每日2次', frequencyOptions: ['每日1次', '每日2次', '每日3次'], startDate: today(), endDate: '', saving: false, createdReminders: [], showResult: false,
    canEdit: true,
  },
  onLoad(options) { this.initialElderId = options.elder || ''; this.loadElders() },
  onShow() {
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
  onKeywordInput(event) {
    const keyword = event.detail.value
    this.setData({ keyword, selectedDrug: null })
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
    this.setData({ selectedDrug: drug, keyword: drug.generic_name, matchedDrugs: [], dose: this.data.dose || drug.dosage_text || '' })
  },
  clearDrug() { this.setData({ selectedDrug: null, keyword: '', matchedDrugs: [] }) },
  onDoseInput(event) { this.setData({ dose: event.detail.value }) },
  chooseFrequency(event) { this.setData({ frequency: event.currentTarget.dataset.value }) },
  onStartDate(event) { this.setData({ startDate: event.detail.value }) },
  onEndDate(event) { this.setData({ endDate: event.detail.value }) },
  clearEndDate() { this.setData({ endDate: '' }) },
  async save() {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    const elder = this.data.elders[this.data.elderIndex]
    if (!elder) { toast('请选择老人'); return }
    if (!this.data.selectedDrug) { toast('请从匹配结果中选择药物'); return }
    if (!this.data.dose) { toast('请输入剂量'); return }
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
    this.setData({ keyword: '', selectedDrug: null, matchedDrugs: [], dose: '', frequency: '每日2次', startDate: today(), endDate: '', ...(closeResult ? { showResult: false } : {}) })
  },
  closeResult() { this.setData({ showResult: false }) },
  goReminders() { this.setData({ showResult: false }); wx.switchTab({ url: '/pages/reminders/index' }) },
})
