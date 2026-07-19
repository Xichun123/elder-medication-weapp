import crypto from 'node:crypto'
import { config } from './config.js'

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function fromB64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8')
}

export function signToken(payload, expiresInSec = config.jwtExpiresInSec) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const body = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSec,
  }
  const p1 = b64url(JSON.stringify(header))
  const p2 = b64url(JSON.stringify(body))
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(`${p1}.${p2}`).digest('base64url')
  return `${p1}.${p2}.${sig}`
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') throw new Error('未登录')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('登录态无效')
  const [p1, p2, sig] = parts
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(`${p1}.${p2}`).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('登录态无效')
  const payload = JSON.parse(fromB64url(p2))
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error('登录已过期')
  return payload
}

export async function code2Session(code) {
  if (!config.wxAppId || !config.wxAppSecret) {
    throw new Error('服务器未配置 WX_APP_ID / WX_APP_SECRET')
  }
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', config.wxAppId)
  url.searchParams.set('secret', config.wxAppSecret)
  url.searchParams.set('js_code', code)
  url.searchParams.set('grant_type', 'authorization_code')
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? '微信登录服务响应超时' : '微信登录服务不可用')
  }
  if (!response.ok) throw new Error(`微信登录服务异常(${response.status})`)
  const data = await response.json()
  if (data.errcode) {
    throw new Error(data.errmsg || `微信登录失败(${data.errcode})`)
  }
  if (!data.openid) throw new Error('微信登录未返回 openid')
  // session_key 只保留在服务端流程中，绝不下发到小程序。
  return { openid: data.openid, unionid: data.unionid || null, sessionKey: data.session_key }
}
