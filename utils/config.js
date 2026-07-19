/**
 * 运行时配置。
 * USE_LOCAL_API=true 时走本地 database.js（演示）；false 时请求 VPS。
 * 远程模式需在微信公众平台配置 request 合法域名：api.0721online.net
 */
const USE_LOCAL_API = false

const config = {
  useLocalApi: USE_LOCAL_API,
  /** 生产 API（HTTPS，已部署 dm VPS） */
  apiBaseUrl: 'https://api.0721online.net',
  requestTimeout: 10000,
}

module.exports = config
