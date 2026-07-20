const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const voice = require('../../utils/voice')
const { unwrap, showError } = require('../../utils/helpers')

Page({
  data: { elders: [], elderIndex: -1, elder: null, reminders: [], currentReminder: null, nextReminder: null, promptReminder: null, showMedicationPrompt: false, autoPlay: true, highContrast: false, greeting: '', today: '' },
  onLoad(options) {
    if (!config.useLocalApi && !session.getHome()) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    this.initialElderId = options.elder || ''
    this.setDateText()
    this.loadElders()
  },
  onUnload() { if (this.timer) clearInterval(this.timer); voice.stop() },
  setDateText() { const d = new Date(); const week = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]; const h = d.getHours(); this.setData({ today: `${d.getMonth()+1}月${d.getDate()}日 ${week}`, greeting: h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好' }) },
  async loadElders() { try { const elders = unwrap(await api.elders.list()); let elderIndex = elders.findIndex((item) => item.elder_id === this.initialElderId); if (elderIndex < 0 && elders.length) elderIndex = 0; this.setData({ elders, elderIndex }); await this.loadReminders(); this.startTimer() } catch (error) { showError(error) } },
  async loadReminders() {
    const selected = this.data.elders[this.data.elderIndex]
    if (!selected) return
    try {
      const previousId = this.data.currentReminder && this.data.currentReminder.rule_id
      const [elder, data] = await Promise.all([
        api.elders.get(selected.elder_id),
        api.reminders.list({ elder: selected.elder_id }),
      ])
      const reminders = unwrap(data)
      const currentReminder = reminders.find((item) => item.status === 'pending') || null
      const promptChanged = currentReminder && currentReminder.rule_id !== previousId
      this.setData({
        elder,
        reminders,
        currentReminder,
        nextReminder: currentReminder,
        ...(!currentReminder ? { promptReminder: null, showMedicationPrompt: false } : {}),
        ...(promptChanged ? { promptReminder: currentReminder, showMedicationPrompt: true } : {}),
      })
    } catch (error) { showError(error) }
  },
  onElderChange(event) { this.setData({ elderIndex: Number(event.detail.value) }, () => this.loadReminders()) },
  toggleContrast() { this.setData({ highContrast: !this.data.highContrast }) },
  onAutoChange(event) { this.setData({ autoPlay: event.detail.value }) },
  playCurrent() { if (this.data.currentReminder) this.playText(this.data.currentReminder.voice_text) },
  playReminder(event) {
    const row = this.data.reminders.find((item) => item.rule_id === event.currentTarget.dataset.id)
    if (row) {
      this.setData({ promptReminder: row, showMedicationPrompt: true })
      this.playText(row.voice_text)
    }
  },
  closeMedicationPrompt() { this.setData({ showMedicationPrompt: false }) },
  playPrompt() { if (this.data.promptReminder) this.playText(this.data.promptReminder.voice_text) },
  noop() {},
  playText(text) { voice.speak(text, { tone: this.data.elder && this.data.elder.voice_tone }).catch(showError) },
  startTimer() { if (this.timer) clearInterval(this.timer); this.timer = setInterval(async () => { if (!this.data.autoPlay) return; await this.loadReminders(); const current = this.data.currentReminder; if (current && this.lastPlayedId !== current.rule_id) { this.lastPlayedId = current.rule_id; this.playText(current.voice_text) } }, 60000) },
})
