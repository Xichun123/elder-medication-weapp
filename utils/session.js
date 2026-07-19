const USER_KEY = 'yao_ling_tong.current_user'
const HOME_KEY = 'yao_ling_tong.current_home'
const SIGNED_OUT_KEY = 'yao_ling_tong.signed_out'

function getUser() {
  return wx.getStorageSync(USER_KEY) || null
}

function setUser(user) {
  if (user) wx.setStorageSync(USER_KEY, user)
  else wx.removeStorageSync(USER_KEY)
}

function getHome() {
  return wx.getStorageSync(HOME_KEY) || null
}

function setHome(home) {
  if (home) wx.setStorageSync(HOME_KEY, home)
  else wx.removeStorageSync(HOME_KEY)
  const app = getApp()
  if (app && app.globalData) app.globalData.currentHome = home || null
}

function isSignedOut() {
  return Boolean(wx.getStorageSync(SIGNED_OUT_KEY))
}

function setSignedOut(value) {
  if (value) wx.setStorageSync(SIGNED_OUT_KEY, true)
  else wx.removeStorageSync(SIGNED_OUT_KEY)
}

function clear() {
  wx.removeStorageSync(USER_KEY)
  wx.removeStorageSync(HOME_KEY)
  const app = getApp()
  if (app && app.globalData) {
    app.globalData.currentUser = null
    app.globalData.currentHome = null
  }
}

module.exports = { getUser, setUser, getHome, setHome, isSignedOut, setSignedOut, clear }
