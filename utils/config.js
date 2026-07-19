/**
 * 运行时配置。
 * USE_LOCAL_API=true 时走本地 database.js（演示）；false 时请求 VPS。
 * 远程模式需在微信公众平台配置 request 合法域名：api.0721online.net
 */
// 微信开发者工具调试：请求本机 AI 后端。上线前改为 false 并部署 server 到 HTTPS 域名。
const USE_LOCAL_SERVER = true

const config = {
  useLocalApi: false,
  // 开发者工具可访问本机服务；project.private.config.json 已关闭域名校验。
  apiBaseUrl: USE_LOCAL_SERVER ? 'http://127.0.0.1:8787' : 'https://api.0721online.net',
  devLogin: USE_LOCAL_SERVER,
  requestTimeout: 10000,
}

module.exports = config
