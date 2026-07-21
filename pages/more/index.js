const api = require('../../utils/api')
const config = require('../../utils/config')
const remote = require('../../utils/remote')
const session = require('../../utils/session')
const store = require('../../utils/store')
const { toast, showError, confirm } = require('../../utils/helpers')

Page({
  data: {
    stats: { elders: 0, families: 0, relations: 0, drugs: 0, records: 0, reminders: 0, contraindications: 0 },
    resetting: false,
    isRemote: false,
    homeName: '',
    roleLabel: '',
    roleText: '',
    nickname: '',
    nicknameInitial: '我',
    avatarUrl: '',
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ active: 4 })
    }
    const home = session.getHome()
    if (!config.useLocalApi && !home) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    if (!config.useLocalApi && home.role === 'elder') {
      wx.reLaunch({ url: '/pages/cloud-elder/index' })
      return
    }
    const user = session.getUser() || {}
    const role = store.currentRole()
    const roleTexts = { owner: '家庭创建人', caregiver_edit: '可录入家属', caregiver_view: '只读家属', elder: '老人本人' }
    this.setData({
      isRemote: !config.useLocalApi,
      homeName: (home && home.name) || '',
      roleLabel: role,
      roleText: roleTexts[role] || '',
      nickname: user.nickname || '',
      nicknameInitial: String(user.nickname || '我').slice(0, 1),
      avatarUrl: user.avatarUrl
        ? (/^https?:\/\//i.test(user.avatarUrl) ? user.avatarUrl : `${String(config.apiBaseUrl || '').replace(/\/$/, '')}${user.avatarUrl}`)
        : '',
    })
    this.loadStats()
  },
  navigate(event) { wx.navigateTo({ url: event.currentTarget.dataset.path }) },
  async loadStats() {
    if (!config.useLocalApi) {
      try {
        const homeId = store.getFamilyId()
        if (!homeId) return
        const [overview, drugs, records, reminders, contras] = await Promise.all([
          api.families.overview(homeId),
          api.drugs.list(),
          api.records.list(),
          api.reminders.list(),
          api.contraindications.list(),
        ])
        this.setData({
          stats: {
            elders: (overview.elders || []).length,
            families: 1,
            relations: 0,
            drugs: drugs.length,
            records: records.length,
            reminders: reminders.length,
            contraindications: contras.length,
          },
        })
      } catch (error) { showError(error) }
      return
    }
    try {
      const data = await api.local.export()
      this.setData({
        stats: {
          elders: data.elders.length,
          families: data.families.length,
          relations: data.relations.length,
          drugs: data.drugs.length,
          records: data.records.length,
          reminders: data.reminders.length,
          contraindications: data.contraindications.length,
        },
      })
    } catch (error) { showError(error) }
  },
  async exportData() {
    if (!config.useLocalApi) {
      toast('云端模式请在各业务页查看数据')
      return
    }
    try {
      const data = await api.local.export()
      wx.setClipboardData({ data: JSON.stringify(data, null, 2), success: () => toast('台账 JSON 已复制', 'success'), fail: showError })
    } catch (error) { showError(error) }
  },
  async resetData() {
    if (!config.useLocalApi) {
      toast('云端家庭不支持恢复演示数据')
      return
    }
    if (!(await confirm('这会删除当前设备上的所有修改并恢复 35 条演示数据，确定继续？', '恢复初始数据'))) return
    this.setData({ resetting: true })
    try {
      await api.local.reset()
      store.setFamilyId('F01')
      toast('已恢复初始数据', 'success')
      await this.loadStats()
    } catch (error) { showError(error) }
    finally { this.setData({ resetting: false }) }
  },
  openCloudHome() {
    wx.navigateTo({ url: '/pages/cloud-home/index' })
  },
  switchHome() {
    session.setHome(null)
    wx.reLaunch({ url: '/pages/launch/index' })
  },
  async logout() {
    if (!(await confirm('确定退出当前微信登录状态？', '退出登录'))) return
    remote.setToken('')
    session.clear()
    session.setSignedOut(true)
    wx.reLaunch({ url: '/pages/launch/index' })
  },
})
