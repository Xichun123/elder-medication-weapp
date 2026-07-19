const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const store = require('../../utils/store')
const { unwrap, showError } = require('../../utils/helpers')

Page({
  data: { elders: [], elderIndex: -1, dashboard: null, loading: false, severity: '', type: '', filteredRisks: [], riskSections: [] },
  onLoad(options) { this.initialElderId = options.elder || '' },
  onShow() {
    if (!config.useLocalApi && !session.getHome()) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    const familyId = store.getFamilyId()
    const elderId = wx.getStorageSync('elder_medication.risk_elder_id')
    if (elderId) {
      wx.removeStorageSync('elder_medication.risk_elder_id')
      this.initialElderId = elderId
      this.lastFamilyId = familyId
      const elderIndex = this.data.elders.findIndex((item) => item.elder_id === elderId)
      if (elderIndex >= 0) this.setData({ elderIndex, severity: '', type: '' }, () => this.loadDashboard())
      else this.loadElders()
      return
    }
    if (this.lastFamilyId !== familyId || !this.data.elders.length) {
      this.lastFamilyId = familyId
      this.loadElders()
    }
  },
  onPullDownRefresh() { this.loadDashboard().finally(() => wx.stopPullDownRefresh()) },
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
      if (elderIndex >= 0) await this.loadDashboard()
      else this.setData({ dashboard: null, filteredRisks: [], riskSections: [] })
    } catch (error) { showError(error) }
  },
  onElderChange(event) { this.setData({ elderIndex: Number(event.detail.value), severity: '', type: '' }, () => this.loadDashboard()) },
  async loadDashboard() {
    const elder = this.data.elders[this.data.elderIndex]
    if (!elder) return
    this.setData({ loading: true })
    try { this.setData({ dashboard: await api.dashboard(elder.elder_id) }); this.applyFilters() }
    catch (error) { showError(error) }
    finally { this.setData({ loading: false }) }
  },
  setSeverity(event) { const value = event.currentTarget.dataset.value; this.setData({ severity: this.data.severity === value ? '' : value }, () => this.applyFilters()) },
  setType(event) { const value = event.currentTarget.dataset.value; this.setData({ type: this.data.type === value ? '' : value }, () => this.applyFilters()) },
  applyFilters() {
    const risks = (this.data.dashboard && this.data.dashboard.risks) || []
    const filteredRisks = risks.filter((item) => (!this.data.severity || item.severity === this.data.severity) && (!this.data.type || item.contra_type === this.data.type))
    const grouped = { severe: [], middle: [], light: [] }
    filteredRisks.forEach((item) => { if (grouped[item.severity]) grouped[item.severity].push(item) })
    const riskSections = [
      { key: 'severe', title: '🚨 严重风险', risks: grouped.severe },
      { key: 'middle', title: '⚠️ 中等风险', risks: grouped.middle },
      { key: 'light', title: 'ℹ️ 轻度风险', risks: grouped.light },
    ]
    this.setData({ filteredRisks, riskSections })
  },
})
