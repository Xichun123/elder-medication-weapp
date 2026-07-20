// 优先走服务端 TTS（支持方言音色）；失败时降级为大字弹窗。
const api = require('./api')
const aiPrivacy = require('./ai-privacy')
const config = require('./config')

let audioContext
let speaking = false

function getAudioContext() {
  if (!audioContext) audioContext = wx.createInnerAudioContext({ useWebAudioImplement: true })
  return audioContext
}

function showModalFallback(text) {
  return new Promise((resolve) => {
    wx.showModal({
      title: '🔊 温情用药提醒',
      content: text,
      showCancel: false,
      confirmText: '我知道了',
      complete: resolve,
    })
  })
}

function speak(text, options = {}) {
  const value = String(text || '').trim()
  if (!value) return Promise.resolve()
  try { wx.vibrateShort({ type: 'medium' }) } catch (error) { console.warn(error) }

  const preferTts = options.preferTts !== false && !config.useLocalApi && api.ai && typeof api.ai.speech === 'function'
  if (!preferTts) return showModalFallback(value)

  if (speaking) return Promise.resolve()
  speaking = true
  return aiPrivacy.ensureConsent()
    .then((consented) => {
      if (!consented) return showModalFallback(value)
      return api.ai.speech(value, {
        tone: options.tone || options.voiceTone || '',
        aiConsent: true,
      }).then((result) => playUrl(result.audioUrl))
    })
    .catch((error) => {
      console.warn('TTS 播报失败，已降级弹窗', error)
      return showModalFallback(value)
    })
    .finally(() => {
      speaking = false
    })
}

function stop() {
  stopRemote()
}

function playUrl(url) {
  if (!url) return Promise.reject(new Error('没有可播放的语音'))
  const context = getAudioContext()
  context.stop()
  context.src = url
  context.play()
  return Promise.resolve()
}

function stopRemote() {
  if (audioContext) audioContext.stop()
}

function destroy() {
  if (audioContext) {
    audioContext.destroy()
    audioContext = null
  }
  speaking = false
}

module.exports = { speak, stop, playUrl, stopRemote, destroy }
