const config = require('../../utils/config')
const remote = require('../../utils/remote')
const session = require('../../utils/session')

Page({
  data: {
    loading: true,
    submitting: false,
    error: '',
    user: null,
    homes: [],
    mode: '',
    homeName: '',
    inviteCode: '',
    signedOut: false,
  },

  onLoad() {
    if (!config.useLocalApi && !remote.getToken() && session.isSignedOut()) {
      this.setData({ loading: false, signedOut: true })
      return
    }
    this.bootstrap()
  },

  async bootstrap() {
    if (config.useLocalApi) {
      wx.switchTab({ url: '/pages/home/index' })
      return
    }

    this.setData({ loading: true, error: '' })
    try {
      let user
      if (remote.getToken()) {
        try {
          const me = await remote.request({ path: '/me' })
          user = me.user
        } catch (error) {
          if (error.statusCode !== 401) throw error
        }
      }
      if (!user) {
        const loginResult = await remote.login()
        user = loginResult.user
      }
      session.setSignedOut(false)
      session.setUser(user)
      getApp().globalData.currentUser = user
      const result = await remote.request({ path: '/homes' })
      this.setData({ user, homes: result.homes || [] })
    } catch (error) {
      this.setData({ error: error.message || '登录失败，请稍后重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  chooseMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode, error: '' })
  },

  closeMode() {
    this.setData({ mode: '', homeName: '', inviteCode: '', error: '' })
  },

  onHomeName(event) {
    this.setData({ homeName: event.detail.value })
  },

  onInviteCode(event) {
    this.setData({ inviteCode: String(event.detail.value || '').toUpperCase() })
  },

  async createHome() {
    const name = this.data.homeName.trim()
    if (!name) {
      this.setData({ error: '请输入家庭名称' })
      return
    }
    await this.submitHome('/homes', { name })
  },

  async joinHome() {
    const code = this.data.inviteCode.trim()
    if (!code) {
      this.setData({ error: '请输入邀请码' })
      return
    }
    await this.submitHome('/homes/join', { code })
  },

  async submitHome(path, data) {
    if (this.data.submitting) return
    this.setData({ submitting: true, error: '' })
    try {
      const result = await remote.request({ path, method: 'POST', data })
      this.enterHomeByData(result.home)
    } catch (error) {
      this.setData({ error: error.message || '操作失败' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  enterHome(event) {
    const home = this.data.homes.find((item) => item.id === event.currentTarget.dataset.id)
    if (home) this.enterHomeByData(home)
  },

  enterHomeByData(home) {
    session.setHome(home)
    if (home.role === 'elder') {
      wx.redirectTo({ url: '/pages/cloud-elder/index' })
    } else {
      wx.redirectTo({ url: '/pages/cloud-home/index' })
    }
  },

  loginAgain() {
    session.setSignedOut(false)
    this.setData({ signedOut: false })
    this.bootstrap()
  },

  retry() {
    this.bootstrap()
  },
})
