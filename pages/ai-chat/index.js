const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const voice = require('../../utils/voice')
const { showError } = require('../../utils/helpers')

Page({
  data: { mode: 'caregiver', elderId: '', elders: [], elderIndex: -1, input: '', sending: false, messages: [] },
  onLoad(options) {
    if (!config.useLocalApi && !session.getHome()) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    this.setData({ mode: options.mode === 'elder' ? 'elder' : 'caregiver', elderId: options.elder || '' })
    this.setData({ messages: [{ role: 'assistant', content: this.data.mode === 'elder' ? '您好，我是用药小助手。您可以告诉我“我刚吃了药”或“我头晕”。' : '您好，我可以帮您查询老人近期服药情况和家庭药品库中的注意事项。' }] })
    this.loadElders()
  },
  onUnload() { voice.destroy() },
  async loadElders() {
    try {
      const elders = await api.elders.list()
      const elderIndex = Math.max(0, elders.findIndex((item) => item.elder_id === this.data.elderId))
      const selected = elders[elderIndex] || null
      this.setData({ elders, elderIndex: selected ? elderIndex : -1, elderId: selected ? selected.elder_id : '' })
    } catch (error) { console.warn('加载长辈列表失败', error) }
  },
  onElderChange(event) {
    const elderIndex = Number(event.detail.value)
    const elder = this.data.elders[elderIndex]
    if (elder) this.setData({ elderIndex, elderId: elder.elder_id })
  },
  onInput(event) { this.setData({ input: event.detail.value }) },
  usePhrase(event) { this.setData({ input: event.currentTarget.dataset.text }, () => this.send()) },
  playMessage(event) {
    voice.playUrl(event.currentTarget.dataset.url).catch(showError)
  },
  async send() {
    const text = String(this.data.input || '').trim()
    if (!text || this.data.sending) return
    if (!api.ai || !api.ai.chat) { wx.showToast({ title: 'AI 对话需要云端模式', icon: 'none' }); return }
    const messages = this.data.messages.concat({ role: 'user', content: text })
    this.setData({ messages, input: '', sending: true })
    try {
      const result = await api.ai.chat({ message: text, mode: this.data.mode, elderId: this.data.elderId, history: messages.slice(-8) })
      const actionText = (result.actions || []).filter((item) => item.message).map((item) => item.message).join('\n')
      const assistantMessage = { role: 'assistant', content: `${result.answer || ''}${actionText ? `\n\n操作结果：${actionText}` : ''}`, audioUrl: result.audioUrl || '' }
      this.setData({ messages: this.data.messages.concat(assistantMessage) })
      if (this.data.mode === 'elder' && assistantMessage.audioUrl) voice.playUrl(assistantMessage.audioUrl).catch(showError)
    } catch (error) { showError(error) } finally { this.setData({ sending: false }) }
  },
})
