const api = require('../../utils/api')
const aiPrivacy = require('../../utils/ai-privacy')
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
      this.applyReminders(reminders)
      this.refreshCompanionInBackground()
    } catch (error) {
      showError(error)
    }
  },

  applyReminders(reminders) {
    const pending = reminders.filter((item) => item.status === 'pending')
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const due = pending.filter((item) => this.reminderMinutes(item.remind_time) <= nowMinutes)
    const current = due[due.length - 1] || pending[0] || null
    this.setData({ reminders, pending, current, currentDue: due.length > 0 })
  },

  localDayKey() {
    const date = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  },

  async refreshCompanionInBackground() {
    if (!api.reminders.refreshCompanion || this._companionRefreshing) return
    const dayKey = this.localDayKey()
    const savedConsent = aiPrivacy.hasConsent()
    if (this._companionDay === dayKey && (!savedConsent || this._companionMode === 'ai')) return

    this._companionRefreshing = true
    try {
      let consented = savedConsent
      if (!consented && !this._privacyPrompted) {
        this._privacyPrompted = true
        consented = await aiPrivacy.ensureConsent()
      }

      let refreshed = 0
      let aiGenerated = 0
      let hasMore = true
      let rounds = 0
      let serverDay = dayKey
      while (hasMore && rounds < 4) {
        const result = await api.reminders.refreshCompanion({
          preferAi: consented,
          aiConsent: consented,
        })
        refreshed += Number(result.refreshed || 0)
        aiGenerated += Number(result.aiGenerated || 0)
        hasMore = result.hasMore === true
        serverDay = result.date || serverDay
        rounds += 1
      }

      this._companionDay = serverDay
      this._companionMode = consented && aiGenerated === refreshed && !hasMore ? 'ai' : 'template'
      if (refreshed > 0) this.applyReminders(await api.reminders.list())
    } catch (error) {
      // 可选 AI 失败不得阻断提醒查看和确认。
      console.warn('后台刷新温情播报文案失败', error)
    } finally {
      this._companionRefreshing = false
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

  openAi() {
    if (!this.data.elder) return
    wx.navigateTo({ url: `/pages/ai-chat/index?mode=elder&elder=${this.data.elder.id}` })
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
