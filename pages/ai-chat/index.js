const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const voice = require('../../utils/voice')
const { showError } = require('../../utils/helpers')

const PRIVACY_KEY = 'yao_ling_tong.ai_privacy_consent_v1'

function makeMessage(role, content, extra = {}) {
  return { role, content: String(content || ''), audioUrl: '', pendingAction: null, candidates: [], ...extra }
}

Page({
  data: {
    mode: 'caregiver', elderId: '', elders: [], elderIndex: -1,
    input: '', sending: false, speaking: false, recording: false, transcribing: false,
    messages: [], privacyConsented: false,
  },

  onLoad(options) {
    if (!config.useLocalApi && !session.getHome()) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    this.setData({ mode: options.mode === 'elder' ? 'elder' : 'caregiver', elderId: options.elder || '' })
    this.initializePage()
    this.ensurePrivacyConsent()
  },

  onUnload() {
    this.unloading = true
    if (this.data.recording && this.recorder) this.recorder.stop()
    voice.destroy()
  },

  initializeRecorder() {
    if (!wx.getRecorderManager) return
    const recorder = wx.getRecorderManager()
    if (!recorder
      || typeof recorder.start !== 'function'
      || typeof recorder.stop !== 'function'
      || typeof recorder.onStop !== 'function') return
    this.recorder = recorder
    if (typeof recorder.onStart === 'function') recorder.onStart(() => this.setData({ recording: true }))
    recorder.onStop((result) => {
      this.setData({ recording: false })
      if (!this.unloading) this.transcribeRecording(result)
    })
    if (typeof recorder.onError === 'function') {
      recorder.onError((error) => {
        console.warn('录音失败', error)
        this.setData({ recording: false, transcribing: false })
        wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' })
      })
    }
  },

  ensurePrivacyConsent() {
    if (wx.getStorageSync(PRIVACY_KEY)) {
      this.setData({ privacyConsented: true })
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      wx.showModal({
        title: 'AI 隐私说明',
        content: '为回答问题，相关用药记录、过敏史、症状、对话内容和主动录制的语音会发送给已配置的第三方 AI/语音服务处理。请确认知情后继续。',
        confirmText: '同意并继续',
        cancelText: '暂不使用',
        success: (res) => {
          if (!res.confirm) { resolve(false); return }
          wx.setStorageSync(PRIVACY_KEY, true)
          this.setData({ privacyConsented: true })
          resolve(true)
        },
        fail: () => {
          wx.showToast({ title: '无法打开隐私确认，请重试', icon: 'none' })
          resolve(false)
        },
      })
    })
  },

  initializePage() {
    const content = this.data.mode === 'elder'
      ? '您好，我是用药小助手。您可以告诉我“我刚吃了药”或“我头晕”。涉及记录修改时，我会先请您核对并确认。'
      : '您好，我可以查询服药历史和药品注意事项。涉及服药状态或症状记录时，需要您在确认卡上再次确认。'
    this.setData({ messages: [makeMessage('assistant', content)] })
    this.loadElders()
  },

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

  async toggleRecording() {
    if (this.data.sending || this.data.transcribing) return
    if (!this.data.privacyConsented && !(await this.ensurePrivacyConsent())) return
    if (!this.recorder) {
      try { this.initializeRecorder() } catch (error) { console.warn('当前环境无法初始化录音', error) }
    }
    if (!this.recorder) { wx.showToast({ title: '当前微信版本不支持录音', icon: 'none' }); return }
    if (this.data.recording) {
      this.recorder.stop()
      return
    }
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        this.recorder.start({
          duration: 15000,
          sampleRate: 16000,
          numberOfChannels: 1,
          encodeBitRate: 48000,
          format: 'mp3',
        })
        this.setData({ recording: true })
      },
      fail: () => wx.showModal({
        title: '需要麦克风权限',
        content: '请在设置中允许使用麦克风，才能通过语音和用药助手对话。',
        confirmText: '去设置',
        success: (res) => { if (res.confirm) wx.openSetting() },
      }),
    })
  },

  async transcribeRecording(result) {
    if (!api.ai || !api.ai.transcribe) {
      wx.showToast({ title: '语音识别需要云端模式', icon: 'none' })
      return
    }
    if (!result?.tempFilePath || Number(result.duration || 0) < 400) {
      wx.showToast({ title: '录音太短，请重新说', icon: 'none' })
      return
    }
    this.setData({ transcribing: true })
    try {
      const audioBase64 = await new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({
          filePath: result.tempFilePath,
          encoding: 'base64',
          success: (data) => resolve(data.data),
          fail: reject,
        })
      })
      const recognized = await api.ai.transcribe({ audioBase64, format: 'mp3' })
      const text = String(recognized.text || '').trim()
      if (!text) throw new Error('没有识别到文字')
      this.setData({ input: text, transcribing: false }, () => this.send())
    } catch (error) {
      this.setData({ transcribing: false })
      showError(error)
    }
  },

  async speakText(text, existingAudioUrl = '') {
    const value = String(text || '').trim()
    if (!value || this.data.speaking) return
    this.setData({ speaking: true })
    try {
      let audioUrl = existingAudioUrl
      if (!audioUrl) {
        const result = await api.ai.speech(value)
        audioUrl = result.audioUrl
      }
      await voice.playUrl(audioUrl)
    } catch (error) {
      console.warn('语音播报失败', error)
      wx.showToast({
        title: error.statusCode === 404 ? '服务器语音接口尚未部署' : '语音播报暂不可用',
        icon: 'none',
      })
    } finally {
      this.setData({ speaking: false })
    }
  },

  playMessage(event) {
    this.speakText(event.currentTarget.dataset.text, event.currentTarget.dataset.audio)
  },

  async send() {
    const text = String(this.data.input || '').trim()
    if (!text || this.data.sending) return
    if (!this.data.privacyConsented && !(await this.ensurePrivacyConsent())) return
    if (!api.ai || !api.ai.chat) { wx.showToast({ title: 'AI 对话需要云端模式', icon: 'none' }); return }

    // history 只包含请求前已经存在的消息；当前问题由 message 字段单独发送。
    const history = this.data.messages
      .filter((item) => item.content)
      .slice(-8)
      .map((item) => ({ role: item.role, content: item.content }))
    const nextMessages = this.data.messages.concat(makeMessage('user', text))
    this.setData({ messages: nextMessages, input: '', sending: true })
    try {
      const result = await api.ai.chat({
        message: text,
        mode: this.data.mode,
        elderId: this.data.elderId,
        history,
      })
      const assistant = makeMessage('assistant', result.answer || '', {
        audioUrl: result.audioUrl || '',
        pendingAction: result.pendingAction || null,
        candidates: result.candidates || [],
      })
      this.setData({ messages: this.data.messages.concat(assistant) })
      if (this.data.mode === 'elder') this.speakText(assistant.content, assistant.audioUrl)
    } catch (error) {
      if (error.statusCode === 404) {
        wx.showModal({
          title: 'AI 服务端尚未升级',
          content: '小程序已经更新，但生产服务器仍是旧版本或缺少 AI 路由，请先部署最新 server 代码。',
          showCancel: false,
        })
      } else showError(error)
    } finally {
      this.setData({ sending: false })
    }
  },

  async chooseCandidate(event) {
    const reminderId = event.currentTarget.dataset.id
    if (!reminderId) return
    try {
      const result = await api.ai.createPendingAction({
        actionType: 'mark_taken',
        elderId: this.data.elderId,
        reminderId,
      })
      this.setData({ messages: this.data.messages.concat(makeMessage(
        'assistant',
        '请核对以下药品信息，确认无误后再提交。',
        {
        pendingAction: result.pendingAction,
        },
      )) })
    } catch (error) { showError(error) }
  },

  async confirmAction(event) {
    const actionId = event.currentTarget.dataset.id
    if (!actionId) return
    wx.showLoading({ title: '正在确认' })
    try {
      const result = await api.ai.confirmPendingAction(actionId)
      const messages = this.data.messages.map((item) => item.pendingAction?.id === actionId
        ? { ...item, pendingAction: { ...item.pendingAction, status: 'confirmed' } }
        : item)
      const reply = makeMessage('assistant', result.message || '操作已确认。')
      this.setData({ messages: messages.concat(reply) })
      if (this.data.mode === 'elder') this.speakText(reply.content)
    } catch (error) { showError(error) } finally { wx.hideLoading() }
  },
})
