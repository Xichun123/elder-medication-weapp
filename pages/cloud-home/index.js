const config = require('../../utils/config')
const remote = require('../../utils/remote')
const session = require('../../utils/session')
const { toast, showError, confirm } = require('../../utils/helpers')

function resolveAvatarUrl(value) {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return `${String(config.apiBaseUrl || '').replace(/\/$/, '')}${value}`
}

const roleLabels = {
  owner: '家庭创建人',
  caregiver_edit: '可录入家属',
  caregiver_view: '只读家属',
  elder: '老人本人',
}

Page({
  data: {
    loading: true,
    home: null,
    members: [],
    elders: [],
    roleLabel: '',
    canEdit: false,
    isOwner: false,
    creating: false,
    saving: false,
    form: { name: '', age: '', relationship: '', gender: 'female' },
    invite: null,
  },

  onLoad() {
    if (!session.getHome()) {
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
      const [homeResult, eldersResult, membersResult] = await Promise.all([
        remote.request({ path: `/homes/${selected.id}` }),
        remote.request({ path: `/homes/${selected.id}/elders` }),
        remote.request({ path: `/homes/${selected.id}/members` }),
      ])
      const home = {
        ...selected,
        ...homeResult.home,
        role: homeResult.home.myRole || selected.role,
        elderProfileId: homeResult.home.myElderProfileId || selected.elderProfileId || null,
      }
      session.setHome(home)
      wx.setNavigationBarTitle({ title: home.name || '家庭空间' })
      const members = (membersResult.members || []).map((item) => ({
        ...item,
        avatarUrl: resolveAvatarUrl(item.avatarUrl),
        avatarText: String(item.nickname || '微').slice(0, 1),
      }))
      this.setData({
        home,
        elders: eldersResult.elders || [],
        members,
        roleLabel: roleLabels[home.role] || home.role,
        canEdit: home.role === 'owner' || home.role === 'caregiver_edit',
        isOwner: home.role === 'owner',
      })
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

  openCreate() {
    this.setData({ creating: true, form: { name: '', age: '', relationship: '', gender: 'female' } })
  },

  closeCreate() {
    this.setData({ creating: false })
  },

  onInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value })
  },

  chooseGender(event) {
    this.setData({ 'form.gender': event.currentTarget.dataset.value })
  },

  async createElder() {
    const home = this.data.home
    const form = this.data.form
    const age = Number(form.age)
    if (!form.name.trim() || !form.relationship.trim() || !Number.isInteger(age) || age < 1 || age > 130) {
      toast('请填写姓名、关系和正确年龄')
      return
    }
    this.setData({ saving: true })
    try {
      await remote.request({
        path: `/homes/${home.id}/elders`,
        method: 'POST',
        data: { name: form.name.trim(), age, relationship: form.relationship.trim(), gender: form.gender },
      })
      toast('长辈档案已创建', 'success')
      this.setData({ creating: false })
      await this.load()
    } catch (error) {
      showError(error)
    } finally {
      this.setData({ saving: false })
    }
  },

  createFamilyInvite(event) {
    this.createInvite(event.currentTarget.dataset.role)
  },

  createElderInvite(event) {
    this.createInvite('elder', event.currentTarget.dataset.id)
  },

  async createInvite(role, elderProfileId) {
    try {
      const result = await remote.request({
        path: `/homes/${this.data.home.id}/invites`,
        method: 'POST',
        data: { role, ...(elderProfileId ? { elderProfileId } : {}) },
      })
      this.setData({ invite: result.invite })
    } catch (error) {
      showError(error)
    }
  },

  copyInvite() {
    const invite = this.data.invite
    if (!invite) return
    wx.setClipboardData({ data: invite.code, success: () => toast('邀请码已复制', 'success') })
  },

  closeInvite() {
    this.setData({ invite: null })
  },

  openWorkbench() {
    wx.switchTab({ url: '/pages/home/index' })
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
