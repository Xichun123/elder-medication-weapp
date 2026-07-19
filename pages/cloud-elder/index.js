const api = require('../../utils/api')
const remote = require('../../utils/remote')
const session = require('../../utils/session')
const voice = require('../../utils/voice')
const { toast, showError, confirm } = require('../../utils/helpers')

Page({
  data: {
    loading: true,
    home: null,
    elder: null,
    reminders: [],
    pending: [],
    current: null,
    currentDue: false,
    acting: false,
  },

  onLoad() {
    const home = session.getHome()
    if (!home || home.role !== 'elder') {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    this.load()
  },

  onShow() {
    if (this.data.home) this.loadReminders()
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
      const elderRaw = (eldersResult.elders || []).find((item) => item.id === home.elderProfileId) || eldersResult.elders[0] || null
      const elder = elderRaw ? {
        id: elderRaw.id,
        name: elderRaw.name,
        gender: elderRaw.gender,
        age: elderRaw.age,
        relationship: elderRaw.relationship,
        voice_tone: elderRaw.voiceTone,
      } : null
      this.setData({ home, elder })
      await this.loadReminders()
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

  async loadReminders() {
    try {
      const reminders = await api.reminders.list()
      const pending = reminders.filter((item) => item.status === 'pending')
      const now = new Date()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      const due = pending.filter((item) => this.reminderMinutes(item.remind_time) <= nowMinutes)
      const current = due[due.length - 1] || pending[0] || null
      this.setData({ reminders, pending, current, currentDue: due.length > 0 })
    } catch (error) {
      showError(error)
    }
  },

  reminderMinutes(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/)
    return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER
  },

  playCurrent() {
    const current = this.data.current
    if (!current) return
    voice.speak(current.voice_text, { tone: this.data.elder && this.data.elder.voice_tone }).catch(showError)
  },

  playReminder(event) {
    const row = this.data.reminders.find((item) => item.rule_id === event.currentTarget.dataset.id)
    if (row) voice.speak(row.voice_text, { tone: this.data.elder && this.data.elder.voice_tone }).catch(showError)
  },

  async takeCurrent() {
    if (!this.data.current || this.data.acting) return
    await this.takeById(this.data.current.rule_id)
  },

  async takeReminder(event) {
    await this.takeById(event.currentTarget.dataset.id)
  },

  async takeById(id) {
    if (this.data.acting) return
    this.setData({ acting: true })
    try {
      await api.reminders.take(id)
      toast('已确认服药', 'success')
      await this.loadReminders()
    } catch (error) {
      showError(error)
    } finally {
      this.setData({ acting: false })
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
