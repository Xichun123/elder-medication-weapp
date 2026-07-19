/**
 * 微信小程序没有与浏览器 Web Speech API 对等的离线文字转语音能力。
 * 为保证项目完全离线、零插件、零服务依赖，这里使用振动提示 + 大字播报卡降级。
 */
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

module.exports = { speak, stop }
