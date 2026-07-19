const FAMILY_ID_KEY = 'elder_medication.current_family_id'

function getFamilyId() {
  return wx.getStorageSync(FAMILY_ID_KEY) || 'F01'
}

function setFamilyId(familyId) {
  const value = familyId || 'F01'
  wx.setStorageSync(FAMILY_ID_KEY, value)
  getApp().globalData.currentFamilyId = value
  return value
}

module.exports = { getFamilyId, setFamilyId }
