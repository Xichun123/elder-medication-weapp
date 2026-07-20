const api = require('../../utils/api')
const aiPrivacy = require('../../utils/ai-privacy')
const remote = require('../../utils/remote')
const session = require('../../utils/session')
const voice = require('../../utils/voice')
const { toast, showError, confirm } = require('../../utils/helpers')

const PROMPT_SNOOZE_MS = 10 * 60 * 1000

Page({
  data: {
    loading: true,
    home: null,
    elder: null,
    reminders: [],
    pending: [],
    current: null,
    currentDue: false,
    promptReminder: null,
    showMedicationPrompt: false,
    autoPlay: true,
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
    this.startTimer()
    if (this.data.home) this.loadReminders()
  },

  onHide() {
    this.stopTimer()
    voice.stop()
  },

  onUnload() {
    this.stopTimer()
    voice.stop()
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

  getNow() {
    return new Date()
  },

  applyReminders(reminders) {
    const pending = reminders
      .filter((item) => item.status === 'pending')
      .sort((left, right) => this.reminderMinutes(left.remind_time) - this.reminderMinutes(right.remind_time))
    const now = this.getNow()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const due = pending.filter((item) => this.reminderMinutes(item.remind_time) <= nowMinutes)
    const latestDue = due[due.length - 1] || null
    const current = latestDue || pending[0] || null
    const nextData = {
      reminders,
      pending,
      current,
      currentDue: Boolean(latestDue),
    }
    let shouldPlay = false

    if (!latestDue) {
      nextData.promptReminder = null
      nextData.showMedicationPrompt = false
    } else {
      const promptKey = this.reminderPromptKey(latestDue, now)
      const snoozed = promptKey === this.snoozedPromptKey && now.getTime() < this.snoozedUntil
      const snoozeExpired = promptKey === this.snoozedPromptKey && now.getTime() >= this.snoozedUntil
      if (!snoozed && (promptKey !== this.lastPromptedKey || snoozeExpired)) {
        this.lastPromptedKey = promptKey
        this.snoozedPromptKey = ''
        this.snoozedUntil = 0
        nextData.promptReminder = latestDue
        nextData.showMedicationPrompt = true
        shouldPlay = this.data.autoPlay
      } else if (this.data.promptReminder
        && promptKey === this.reminderPromptKey(this.data.promptReminder, now)) {
        nextData.promptReminder = latestDue
        if (snoozed) nextData.showMedicationPrompt = false
      }
    }

    this.setData(nextData)
    if (shouldPlay) this.playText(latestDue.voice_text)
  },

  localDayKey() {
    const date = this.getNow()
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

  reminderPromptKey(reminder, now) {
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')
    return [date, reminder.rule_id, reminder.remind_time].join(':')
  },

  startTimer() {
    this.stopTimer()
    this.timer = setInterval(() => this.loadReminders(), 60000)
  },

  stopTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  },

  onAutoChange(event) {
    this.setData({ autoPlay: event.detail.value })
  },

  playText(text) {
    voice.speak(text, { tone: this.data.elder && this.data.elder.voice_tone }).catch(showError)
  },

  playCurrent() {
    if (this.data.current) this.playText(this.data.current.voice_text)
  },

  playReminder(event) {
    const row = this.data.reminders.find((item) => item.rule_id === event.currentTarget.dataset.id)
    if (row) this.playText(row.voice_text)
  },

  closeMedicationPrompt() {
    const reminder = this.data.promptReminder
    if (reminder) {
      const now = this.getNow()
      this.snoozedPromptKey = this.reminderPromptKey(reminder, now)
      this.snoozedUntil = now.getTime() + PROMPT_SNOOZE_MS
    }
    this.setData({ showMedicationPrompt: false })
  },

  playPrompt() {
    if (this.data.promptReminder) this.playText(this.data.promptReminder.voice_text)
  },

  async takePrompt() {
    const reminder = this.data.promptReminder
    if (!reminder) return
    this.snoozedPromptKey = ''
    this.snoozedUntil = 0
    this.setData({ showMedicationPrompt: false })
    const taken = await this.takeById(reminder.rule_id)
    if (!taken && this.data.promptReminder && this.data.promptReminder.rule_id === reminder.rule_id) {
      this.setData({ showMedicationPrompt: true })
    }
  },

  noop() {},

  async takeCurrent() {
    if (!this.data.current || this.data.acting) return
    await this.takeById(this.data.current.rule_id)
  },

  async takeReminder(event) {
    await this.takeById(event.currentTarget.dataset.id)
  },

  async takeById(id) {
    if (this.data.acting) return false
    this.setData({ acting: true })
    try {
      await api.reminders.take(id)
      toast('已确认服药', 'success')
      await this.loadReminders()
      return true
    } catch (error) {
      showError(error)
      return false
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
