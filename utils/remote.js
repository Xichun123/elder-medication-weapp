const config = require('./config')

const TOKEN_KEY = 'yao_ling_tong.auth_token'

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || ''
}

function setToken(token) {
  if (token) wx.setStorageSync(TOKEN_KEY, token)
  else wx.removeStorageSync(TOKEN_KEY)
}

function request({ path, method = 'GET', data, authenticated = true }) {
  const token = getToken()
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.apiBaseUrl}${path}`,
      method,
      data,
      timeout: config.requestTimeout,
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
        reject(new Error((error && error.errMsg) || '网络请求失败'))
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
  // 开发者工具连本机服务时不依赖微信 AppID；生产仍用 wx.login 的一次性 code。
  const data = config.devLogin
    ? { devOpenid: 'wechat-devtools-user', nickname: '开发调试用户' }
    : { code: await getLoginCode() }
  const result = await request({
    path: '/auth/wx-login',
    method: 'POST',
    data,
    authenticated: false,
  })
  if (!result || !result.token) throw new Error('服务器未返回登录态')
  setToken(result.token)
  return result
}

module.exports = { request, login, getToken, setToken }
