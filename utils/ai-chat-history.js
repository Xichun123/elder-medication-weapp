const PREFIX = 'yao_ling_tong.ai_chat_history.v1'
const MAX_MESSAGES = 80

function storageKey({ mode = 'caregiver', elderId = '', homeId = '' } = {}) {
  const home = homeId || 'local'
  const elder = elderId || 'all'
  const chatMode = mode === 'elder' ? 'elder' : 'caregiver'
  return `${PREFIX}:${home}:${chatMode}:${elder}`
}

function sanitizeMessage(item) {
  if (!item || !item.role || !item.content) return null
  const role = item.role === 'assistant' ? 'assistant' : 'user'
  const pendingAction = item.pendingAction && typeof item.pendingAction === 'object'
    ? {
      id: item.pendingAction.id || '',
      type: item.pendingAction.type || '',
      status: item.pendingAction.status || '',
      safetyWarning: item.pendingAction.safetyWarning || '',
      symptom: item.pendingAction.symptom || '',
      severity: item.pendingAction.severity || '',
      reminder: item.pendingAction.reminder
        ? {
          drugName: item.pendingAction.reminder.drugName || '',
          dose: item.pendingAction.reminder.dose || '',
          remindTime: item.pendingAction.reminder.remindTime || '',
          packageImageUrl: item.pendingAction.reminder.packageImageUrl || '',
        }
        : null,
    }
    : null
  const candidates = Array.isArray(item.candidates)
    ? item.candidates.slice(0, 8).map((candidate) => ({
      reminderId: candidate.reminderId || candidate.id || '',
      drugName: candidate.drugName || '',
      dose: candidate.dose || '',
      remindTime: candidate.remindTime || '',
      packageImageUrl: candidate.packageImageUrl || '',
    })).filter((candidate) => candidate.reminderId || candidate.drugName)
    : []
  return {
    role,
    content: String(item.content || '').slice(0, 2000),
    // 服务端音频代理地址有效期很短，历史消息播放时应重新调用 TTS。
    audioUrl: '',
    pendingAction,
    candidates,
  }
}

function load(options = {}) {
  try {
    const raw = wx.getStorageSync(storageKey(options))
    if (!raw) return []
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw.messages) ? raw.messages : [])
    return list.map(sanitizeMessage).filter(Boolean).slice(-MAX_MESSAGES)
  } catch (error) {
    console.warn('读取 AI 对话历史失败', error)
    return []
  }
}

function save(options = {}, messages = []) {
  try {
    const list = (Array.isArray(messages) ? messages : [])
      .map(sanitizeMessage)
      .filter(Boolean)
      .slice(-MAX_MESSAGES)
    wx.setStorageSync(storageKey(options), {
      updatedAt: Date.now(),
      messages: list,
    })
    return list
  } catch (error) {
    console.warn('保存 AI 对话历史失败', error)
    return []
  }
}

function clear(options = {}) {
  try {
    wx.removeStorageSync(storageKey(options))
  } catch (error) {
    console.warn('清除 AI 对话历史失败', error)
  }
}

module.exports = {
  storageKey,
  load,
  save,
  clear,
  MAX_MESSAGES,
}
