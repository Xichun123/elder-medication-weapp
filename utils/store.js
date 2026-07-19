const config = require('./config')

const FAMILY_ID_KEY = 'elder_medication.current_family_id'

function getFamilyId() {
  if (!config.useLocalApi) {
    const session = require('./session')
    const home = session.getHome()
    if (home && home.id) return home.id
  }
  return wx.getStorageSync(FAMILY_ID_KEY) || 'F01'
}

function setFamilyId(familyId) {
  if (!config.useLocalApi) {
    // 远程模式以 session.currentHome 为准，避免与本地 family 缓存串味。
    return familyId || getFamilyId()
  }
  const value = familyId || 'F01'
  wx.setStorageSync(FAMILY_ID_KEY, value)
  const app = getApp()
  if (app && app.globalData) app.globalData.currentFamilyId = value
  return value
}

function canEdit() {
  if (config.useLocalApi) return true
  const session = require('./session')
  const home = session.getHome()
  return Boolean(home && (home.role === 'owner' || home.role === 'caregiver_edit'))
}

function isOwner() {
  if (config.useLocalApi) return true
  const session = require('./session')
  const home = session.getHome()
  return Boolean(home && home.role === 'owner')
}

function currentRole() {
  if (config.useLocalApi) return 'owner'
  const session = require('./session')
  const home = session.getHome()
  return (home && home.role) || ''
}

module.exports = { getFamilyId, setFamilyId, canEdit, isOwner, currentRole }
