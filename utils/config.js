/**
 * 提交仓库的默认值必须始终指向生产 HTTPS 服务。
 * 本地联调请使用开发者工具的本地覆盖能力或临时未跟踪配置，不要提交 localhost。
 */
const config = {
  useLocalApi: false,
  apiBaseUrl: 'https://api.0721online.net',
  devLogin: false,
  requestTimeout: 10000,
  aiRequestTimeout: 30000,
  sttRequestTimeout: 20000,
  ttsRequestTimeout: 20000,
}

module.exports = config
