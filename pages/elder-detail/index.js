const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const { showError } = require('../../utils/helpers')

Page({
  data: { id: '', elder: null, dashboard: null, loading: false, healthScore: 0, healthLevel: '' },
  onLoad(options) {
    if (!config.useLocalApi && !session.getHome()) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    this.setData({ id: options.id || '' })
    this.load()
  },
  async load() {
    if (!this.data.id) return
    this.setData({ loading: true })
    try {
      const [elder, dashboard] = await Promise.all([api.elders.get(this.data.id), api.dashboard(this.data.id)])
      const score = Math.min(100, Math.max(20, dashboard.medications.length * 18 + dashboard.stats.total * 12))
      const healthLevel = score >= 80 ? '需重点关注' : score >= 50 ? '常规照护' : '状态良好'
      this.setData({ elder, dashboard, healthScore: score, healthLevel })
      wx.setNavigationBarTitle({ title: `${elder.name} · 老人详情` })
    } catch (error) { showError(error) }
    finally { this.setData({ loading: false }) }
  },
  addMedication() { wx.setStorageSync('elder_medication.medication_elder_id', this.data.id); wx.switchTab({ url: '/pages/medication/index' }) },
  openElderly() { wx.navigateTo({ url: `/pages/elderly/index?elder=${this.data.id}` }) },
  openRisks() { wx.setStorageSync('elder_medication.risk_elder_id', this.data.id); wx.switchTab({ url: '/pages/risks/index' }) },
})
