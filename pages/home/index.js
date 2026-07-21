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
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ active: 0 })
    }
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
    const now = new Date()
    const hour = now.getHours()
    const greeting = hour < 6 ? '凌晨好' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    const dateText = `${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]}`
    this.setData({ greeting, dateText })
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
      const [overview, recordsData, remindersData] = await Promise.all([
        api.families.overview(selectedId),
        api.records.list({ family: selectedId }),
        api.reminders.list({ family: selectedId, status: 'pending' }),
      ])
      // 健康提醒是新增能力。生产后端尚未升级时可能返回 404，不能因此丢弃
      // 已经成功加载的家庭、老人、用药和提醒数据。
      let alertData = { unreadCount: 0 }
      try {
        alertData = await api.alerts.list({ unread: true })
      } catch (error) {
        if (error.statusCode !== 404) console.warn('加载健康提醒失败', error)
      }
      const elders = overview.elders || []
      const records = unwrap(recordsData).slice(0, 5)
      const reminders = unwrap(remindersData)
      const sortedPending = reminders
        .filter((item) => item.status === 'pending')
        .sort((a, b) => String(a.remind_time).localeCompare(String(b.remind_time)))
      this.setData({
        families,
        familyIndex,
        currentFamily: overview.family,
        elders,
        records,
        reminders: reminders.slice(0, 5),
        nextReminder: sortedPending[0] || null,
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

  openAi() {
    wx.navigateTo({ url: '/pages/ai-chat/index' })
  },

  openAlerts() {
    wx.navigateTo({ url: '/pages/alerts/index' })
  },

  syncAlertBadge(count) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ badge: Number(count) || 0 })
    }
  },

  navigate(event) {
    const path = event.currentTarget.dataset.path
    const tabPaths = ['/pages/elders/index', '/pages/medication/index', '/pages/reminders/index', '/pages/more/index']
    if (tabPaths.includes(path)) wx.switchTab({ url: path })
    else wx.navigateTo({ url: path })
  },
})
