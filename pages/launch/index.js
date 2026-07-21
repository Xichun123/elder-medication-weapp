const config = require('../../utils/config')
const remote = require('../../utils/remote')
const session = require('../../utils/session')

function resolveAvatarUrl(user) {
  if (!user || !user.avatarUrl) return ''
  const value = String(user.avatarUrl)
  if (/^https?:\/\//i.test(value) || value.startsWith('wxfile://') || value.startsWith('/assets/')) {
    return value
  }
  if (value.startsWith('/')) return `${config.apiBaseUrl}${value}`
  return value
}

function monogramOf(user) {
  const name = (user && user.nickname) || ''
  return name ? name[0] : '我'
}

function needsProfile(user) {
  return !(user && String(user.nickname || '').trim() && user.avatarUrl)
}

Page({
  data: {
    loading: true,
    loadingText: '正在恢复登录…',
    needLogin: false,
    loggingIn: false,
    submitting: false,
    savingProfile: false,
    uploadingAvatar: false,
    showProfileSheet: false,
    error: '',
    profileError: '',
    homeError: '',
    user: null,
    displayAvatarUrl: '',
    sheetAvatarUrl: '',
    monogram: '我',
    nickInput: '',
    homes: [],
    mode: '',
    homeName: '',
    inviteCode: '',
  },

  onLoad() {
    if (config.useLocalApi) {
      wx.switchTab({ url: '/pages/home/index' })
      return
    }
    if (!remote.getToken() || session.isSignedOut()) {
      this.setData({ loading: false, needLogin: true, user: null })
      return
    }
    this.restoreSession()
  },

  noop() {},

  async restoreSession() {
    this.setData({ loading: true, loadingText: '正在恢复登录…', error: '', needLogin: false })
    try {
      const me = await remote.request({ path: '/me' })
      await this.afterLogin(me.user, { promptProfile: false })
    } catch (error) {
      if (error.statusCode === 401) {
        remote.setToken('')
        session.setSignedOut(false)
        this.setData({ loading: false, needLogin: true, user: null })
        return
      }
      this.setData({ loading: false, error: error.message || '恢复登录失败', needLogin: true })
    }
  },

  // 身份登录与资料填写分离：先用 wx.login 建立登录态，再弹出官方头像昵称填写控件。
  async login() {
    if (this.data.loggingIn) return
    this.setData({ loggingIn: true, error: '', needLogin: false, loading: true, loadingText: '登录中…' })
    try {
      session.setSignedOut(false)
      const result = await remote.login()
      if (!result || !result.user) throw new Error('服务器未返回用户信息')
      await this.afterLogin(result.user, { promptProfile: needsProfile(result.user) })
    } catch (error) {
      this.setData({
        loggingIn: false,
        loading: false,
        needLogin: true,
        error: error.message || '暂时没登录上，请重试',
      })
    }
  },

  async afterLogin(user, { promptProfile = false } = {}) {
    session.setSignedOut(false)
    session.setUser(user)
    getApp().globalData.currentUser = user
    const displayAvatarUrl = resolveAvatarUrl(user)
    this.setData({
      user,
      displayAvatarUrl,
      sheetAvatarUrl: displayAvatarUrl,
      monogram: monogramOf(user),
      nickInput: (user && user.nickname) || '',
      loggingIn: false,
      loading: true,
      loadingText: '加载家庭…',
      needLogin: false,
      error: '',
      showProfileSheet: Boolean(promptProfile),
      profileError: '',
      homeError: '',
    })
    await this.loadHomes()
  },

  async loadHomes() {
    this.setData({ loading: true, loadingText: '加载家庭…', homeError: '' })
    try {
      const result = await remote.request({ path: '/homes' })
      this.setData({ homes: result.homes || [], loading: false })
    } catch (error) {
      this.setData({
        loading: false,
        homeError: error.message || '家庭列表加载失败，请重试',
      })
    }
  },

  openProfileSheet() {
    const user = this.data.user
    this.setData({
      showProfileSheet: true,
      sheetAvatarUrl: this.data.displayAvatarUrl,
      nickInput: (user && user.nickname) || '',
      profileError: '',
    })
  },

  closeProfileSheet() {
    if (this.data.savingProfile || this.data.uploadingAvatar) return
    this.setData({ showProfileSheet: false, profileError: '' })
  },

  // 选完头像立即预览、上传并替换；上传失败则恢复上一个已保存头像。
  async onChooseAvatar(event) {
    const tempUrl = event.detail && event.detail.avatarUrl
    const previousAvatarUrl = this.data.displayAvatarUrl
    if (!tempUrl || !this.data.user || this.data.uploadingAvatar) return
    this.setData({
      sheetAvatarUrl: tempUrl,
      displayAvatarUrl: tempUrl,
      uploadingAvatar: true,
      profileError: '',
    })
    try {
      const uploaded = await remote.upload({
        path: '/me/avatar',
        filePath: tempUrl,
        name: 'file',
      })
      if (!uploaded || !uploaded.user) throw new Error('服务器未返回头像信息')
      const user = uploaded.user
      session.setUser(user)
      getApp().globalData.currentUser = user
      const displayAvatarUrl = resolveAvatarUrl(user)
      this.setData({
        user,
        displayAvatarUrl,
        sheetAvatarUrl: displayAvatarUrl,
        monogram: monogramOf(user),
        uploadingAvatar: false,
      })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (error) {
      this.setData({
        displayAvatarUrl: previousAvatarUrl,
        sheetAvatarUrl: previousAvatarUrl,
        uploadingAvatar: false,
        profileError: error.message || '头像上传失败，请重试',
      })
    }
  },

  onNickInput(event) {
    this.setData({ nickInput: (event.detail && event.detail.value) || '' })
  },

  onNicknameReview(event) {
    const detail = (event && event.detail) || {}
    if (detail.pass === false && !detail.timeout) {
      this.setData({ nickInput: '', profileError: '昵称未通过微信安全检测，请重新填写' })
    }
  },

  async confirmProfile(event) {
    if (this.data.savingProfile || this.data.uploadingAvatar) return
    const submitted = event && event.detail && event.detail.value
    const nickname = String((submitted && submitted.nickname) || this.data.nickInput || '').trim()
    if (!this.data.user || !this.data.user.avatarUrl) {
      this.setData({ profileError: '请先选择微信头像' })
      return
    }
    if (!nickname) {
      this.setData({ profileError: '请填写微信昵称' })
      return
    }
    this.setData({ savingProfile: true, nickInput: nickname, profileError: '' })
    try {
      const patched = await remote.request({ path: '/me', method: 'PATCH', data: { nickname } })
      if (!patched || !patched.user) throw new Error('服务器未返回用户信息')
      const user = patched.user
      session.setUser(user)
      getApp().globalData.currentUser = user
      this.setData({
        user,
        monogram: monogramOf(user),
        displayAvatarUrl: resolveAvatarUrl(user),
        sheetAvatarUrl: resolveAvatarUrl(user),
        savingProfile: false,
        showProfileSheet: false,
      })
      wx.showToast({ title: '资料已保存', icon: 'success' })
    } catch (error) {
      this.setData({
        savingProfile: false,
        profileError: error.message || '保存失败，请重试',
      })
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
      wx.switchTab({ url: '/pages/home/index' })
    }
  },
})
