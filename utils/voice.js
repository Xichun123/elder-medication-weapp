// 本地提醒保留大字弹窗降级；AI 回答通过服务端 TTS URL 使用 InnerAudioContext 播放。
function speak(text) {
  const value = String(text || '').trim()
  if (!value) return Promise.resolve()
  try { wx.vibrateShort({ type: 'medium' }) } catch (error) { console.warn(error) }
  return new Promise((resolve) => {
    wx.showModal({
      title: '🔊 用药提醒',
      content: value,
      showCancel: false,
      confirmText: '我知道了',
      complete: resolve,
    })
  })
}

function stop() {}

let audioContext

function getAudioContext() {
  if (!audioContext) audioContext = wx.createInnerAudioContext({ useWebAudioImplement: true })
  return audioContext
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
}

module.exports = { speak, stop, playUrl, stopRemote, destroy }
