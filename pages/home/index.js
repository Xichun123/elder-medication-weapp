const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const store = require('../../utils/store')
const { unwrap, showError } = require('../../utils/helpers')

Page({
  data: {
    loading: false,
    families: [],
    familyIndex: 0,
    currentFamily: {},
    elders: [],
    records: [],
    reminders: [],
    totalMeds: 0,
    totalPending: 0,
    totalRisks: 0,
    unreadAlertCount: 0,
    greeting: '您好',
    canEdit: true,
    isRemote: false,
    roleLabel: '',
  },

  onLoad() { this.setGreeting() },
  onShow() {
    const currentHome = session.getHome()
    if (!config.useLocalApi && !currentHome) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    if (!config.useLocalApi && currentHome.role === 'elder') {
      wx.reLaunch({ url: '/pages/cloud-elder/index' })
      return
    }
    this.load()
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },

  setGreeting() {
    const hour = new Date().getHours()
    const greeting = hour < 6 ? '凌晨好' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
    this.setData({ greeting })
  },

  async load() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const families = unwrap(await api.families.list())
      const familyId = store.getFamilyId()
      let familyIndex = families.findIndex((item) => item.family_id === familyId)
      if (familyIndex < 0) familyIndex = 0
      const selected = families[familyIndex]
      const selectedId = selected ? selected.family_id : familyId
      if (!config.useLocalApi && selected) {
        const home = session.getHome() || {}
        session.setHome({
          ...home,
          id: selected.family_id,
          name: selected.name,
          role: selected.role || home.role,
          elderProfileId: selected.elderProfileId || null,
        })
        if (selected.role === 'elder') {
          wx.reLaunch({ url: '/pages/cloud-elder/index' })
          return
        }
      } else {
        store.setFamilyId(selectedId)
      }
      const [overview, recordsData, remindersData, alertData] = await Promise.all([
        api.families.overview(selectedId),
        api.records.list({ family: selectedId }),
        api.reminders.list({ family: selectedId, status: 'pending' }),
        api.alerts.list({ unread: true }),
      ])
      const elders = overview.elders || []
      const records = unwrap(recordsData).slice(0, 5)
      const reminders = unwrap(remindersData)
      this.setData({
        families,
        familyIndex,
        currentFamily: overview.family,
        elders,
        records,
        reminders: reminders.slice(0, 5),
        totalMeds: elders.reduce((sum, item) => sum + (item.medication_count || 0), 0),
        totalPending: elders.reduce((sum, item) => sum + (item.reminder_pending_count || 0), 0),
        totalRisks: elders.reduce((sum, item) => sum + (item.contraindication_count || 0), 0),
        unreadAlertCount: Number(alertData.unreadCount || 0),
        canEdit: store.canEdit(),
        isRemote: !config.useLocalApi,
        roleLabel: overview.family.role_label || '',
      })
      this.syncAlertBadge(Number(alertData.unreadCount || 0))
    } catch (error) {
      if (error.statusCode === 401) {
        wx.reLaunch({ url: '/pages/launch/index' })
        return
      }
      showError(error)
    } finally {
      this.setData({ loading: false })
    }
  },

  onFamilyChange(event) {
    const familyIndex = Number(event.detail.value)
    const family = this.data.families[familyIndex]
    if (!family) return
    if (!config.useLocalApi) {
      const home = session.getHome() || {}
      session.setHome({
        ...home,
        id: family.family_id,
        name: family.name,
        role: family.role || home.role,
        elderProfileId: family.elderProfileId || null,
      })
      if (family.role === 'elder') {
        wx.reLaunch({ url: '/pages/cloud-elder/index' })
        return
      }
    } else {
      store.setFamilyId(family.family_id)
    }
    this.setData({ familyIndex })
    this.load()
  },

  openElder(event) {
    wx.navigateTo({ url: `/pages/elder-detail/index?id=${event.currentTarget.dataset.id}` })
  },

  openCloudHome() {
    wx.navigateTo({ url: '/pages/cloud-home/index' })
  },

  openAi() {
    wx.navigateTo({ url: '/pages/ai-chat/index' })
  },

  openAlerts() {
    wx.navigateTo({ url: '/pages/alerts/index' })
  },

  syncAlertBadge(count) {
    if (count > 0 && wx.setTabBarBadge) {
      wx.setTabBarBadge({ index: 0, text: String(Math.min(count, 99)), fail: () => {} })
    } else if (wx.removeTabBarBadge) {
      wx.removeTabBarBadge({ index: 0, fail: () => {} })
    }
  },

  navigate(event) {
    const path = event.currentTarget.dataset.path
    const tabPaths = ['/pages/elders/index', '/pages/medication/index', '/pages/reminders/index', '/pages/risks/index']
    if (tabPaths.includes(path)) wx.switchTab({ url: path })
    else wx.navigateTo({ url: path })
  },
})
