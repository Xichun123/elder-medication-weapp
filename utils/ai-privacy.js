const CONSENT_KEY = 'yao_ling_tong.ai_privacy_consent_v2'
let pendingConsent

function hasConsent() {
  return wx.getStorageSync(CONSENT_KEY) === true
}

function ensureConsent() {
  if (hasConsent()) return Promise.resolve(true)
  if (pendingConsent) return pendingConsent
  pendingConsent = new Promise((resolve) => {
    const finish = (value) => {
      pendingConsent = null
      resolve(value)
    }
    wx.showModal({
      title: 'AI 与语音隐私说明',
      content: '为提供 AI 问答、语音和个性化用药播报，老人姓名与关系、用药信息、家属昵称、对话内容及主动录制的语音会发送给已配置的第三方 AI/语音服务处理。仅在您同意后使用；不同意仍可查看本地温情提醒。',
      confirmText: '同意使用',
      cancelText: '仅本地',
      success: (res) => {
        if (!res.confirm) {
          finish(false)
          return
        }
        wx.setStorageSync(CONSENT_KEY, true)
        finish(true)
      },
      fail: () => finish(false),
    })
  })
  return pendingConsent
}

module.exports = { CONSENT_KEY, hasConsent, ensureConsent }
