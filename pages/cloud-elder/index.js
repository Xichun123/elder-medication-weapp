const remote = require('../../utils/remote')
const session = require('../../utils/session')
const { showError, confirm } = require('../../utils/helpers')

Page({
  data: { loading: true, home: null, elder: null },

  onLoad() {
    const home = session.getHome()
    if (!home || home.role !== 'elder') {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    const selected = session.getHome()
    if (!selected) return
    this.setData({ loading: true })
    try {
      const [homeResult, eldersResult] = await Promise.all([
        remote.request({ path: `/homes/${selected.id}` }),
        remote.request({ path: `/homes/${selected.id}/elders` }),
      ])
      const home = {
        ...selected,
        ...homeResult.home,
        role: homeResult.home.myRole || selected.role,
        elderProfileId: homeResult.home.myElderProfileId || selected.elderProfileId,
      }
      session.setHome(home)
      const elder = (eldersResult.elders || []).find((item) => item.id === home.elderProfileId) || eldersResult.elders[0] || null
      this.setData({ home, elder })
    } catch (error) {
      if (error.statusCode === 401 || error.statusCode === 403) {
        this.logout(false)
        return
      }
      showError(error)
    } finally {
      this.setData({ loading: false })
    }
  },

  switchHome() {
    session.setHome(null)
    wx.reLaunch({ url: '/pages/launch/index' })
  },

  async logout(ask = true) {
    if (ask && !(await confirm('确定退出当前微信登录状态？', '退出登录'))) return
    remote.setToken('')
    session.clear()
    session.setSignedOut(true)
    wx.reLaunch({ url: '/pages/launch/index' })
  },
})
