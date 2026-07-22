const config = require('./config')

const TOKEN_KEY = 'yao_ling_tong.auth_token'

function networkErrorMessage(error, action = '请求') {
  const detail = String((error && error.errMsg) || '')
  if (/timeout/i.test(detail)) return `${action}超时，请检查网络后重试`
  if (/domain list|合法域名/i.test(detail)) return '服务地址未配置为微信合法域名'
  if (/ssl|certificate/i.test(detail)) return '无法安全连接服务器，请稍后重试'
  return `无法连接服务器，请检查网络后重试`
}

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || ''
}

function setToken(token) {
  if (token) wx.setStorageSync(TOKEN_KEY, token)
  else wx.removeStorageSync(TOKEN_KEY)
}

function request({ path, method = 'GET', data, authenticated = true, timeout = config.requestTimeout }) {
  const token = getToken()
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.apiBaseUrl}${path}`,
      method,
      data,
      timeout,
      header: {
        'content-type': 'application/json',
        ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success(res) {
        // 官方文档：收到 HTTP 响应即进入 success，4xx/5xx 必须自行判断。
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
          return
        }
        if (res.statusCode === 401) setToken('')
        const message = res.data && res.data.error
        const error = new Error(message || `请求失败(${res.statusCode})`)
        error.statusCode = res.statusCode
        error.data = res.data
        reject(error)
      },
      fail(error) {
        const requestError = new Error(networkErrorMessage(error))
        requestError.isNetworkError = true
        requestError.originalError = error
        reject(requestError)
      },
    })
  })
}

function upload({ path, filePath, name = 'file', formData = {}, authenticated = true, timeout }) {
  const token = getToken()
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${config.apiBaseUrl}${path}`,
      filePath,
      name,
      formData,
      timeout: timeout || config.requestTimeout,
      header: authenticated && token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        let data = res.data
        try { data = JSON.parse(res.data) } catch (error) { /* 保留原始响应，便于展示服务端错误 */ }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data)
          return
        }
        if (res.statusCode === 401) setToken('')
        const message = data && data.error
        const requestError = new Error(message || `上传失败(${res.statusCode})`)
        requestError.statusCode = res.statusCode
        requestError.data = data
        reject(requestError)
      },
      fail(error) {
        const requestError = new Error(networkErrorMessage(error, '图片上传'))
        requestError.isNetworkError = true
        requestError.originalError = error
        reject(requestError)
      },
    })
  })
}

function getLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout: 8000,
      success(res) {
        if (res.code) resolve(res.code)
        else reject(new Error('微信登录未返回临时凭证'))
      },
      fail(error) {
        reject(new Error((error && error.errMsg) || '微信登录失败'))
      },
    })
  })
}

async function login() {
  if (config.devLogin) {
    const result = await request({
      path: '/auth/wx-login',
      method: 'POST',
      data: { devOpenid: config.devOpenid, nickname: config.devNickname },
      authenticated: false,
    })
    if (!result || !result.token) throw new Error('本地服务器未返回登录态')
    setToken(result.token)
    return result
  }
  // wx.login 的 code 有效期短且只能使用一次，获取后立即换取服务端登录态。
  const code = await getLoginCode()
  const result = await request({
    path: '/auth/wx-login',
    method: 'POST',
    data: { code },
    authenticated: false,
  })
  if (!result || !result.token) throw new Error('服务器未返回登录态')
  setToken(result.token)
  return result
}

module.exports = { request, upload, login, getToken, setToken }
