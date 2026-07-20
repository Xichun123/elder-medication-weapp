import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function loadEnvFile() {
  const envPath = path.join(rootDir, '.env')
  if (!fs.existsSync(envPath)) return
  const text = fs.readFileSync(envPath, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 0) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile()

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

const databasePath = path.isAbsolute(process.env.DATABASE_PATH || '')
  ? process.env.DATABASE_PATH
  : path.resolve(rootDir, process.env.DATABASE_PATH || './data/app.db')

export const config = {
  rootDir,
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-jwt-secret-change-me',
  jwtExpiresInSec: Number(process.env.JWT_EXPIRES_IN_SEC || 60 * 60 * 24 * 7),
  wxAppId: process.env.WX_APP_ID || '',
  wxAppSecret: process.env.WX_APP_SECRET || '',
  allowDevLogin: bool(process.env.ALLOW_DEV_LOGIN, false),
  databasePath,
  publicBaseUrl: String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),

  aiApiUrl: process.env.AI_API_URL || '',
  aiApiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || '',
  aiUpstreamTimeoutMs: Number(process.env.AI_UPSTREAM_TIMEOUT_MS || 12_000),
  aiRequestTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS || 25_000),
  aiActionTtlMs: Number(process.env.AI_ACTION_TTL_MS || 5 * 60_000),

  sttApiUrl: process.env.STT_API_URL || '',
  sttProvider: process.env.STT_PROVIDER || 'openai_multipart',
  sttApiKey: process.env.STT_API_KEY || process.env.AI_API_KEY || '',
  sttModel: process.env.STT_MODEL || '',
  sttUpstreamTimeoutMs: Number(process.env.STT_UPSTREAM_TIMEOUT_MS || 15_000),

  ttsApiUrl: process.env.TTS_API_URL || '',
  ttsApiKey: process.env.TTS_API_KEY || '',
  ttsModel: process.env.TTS_MODEL || '',
  ttsVoice: process.env.TTS_VOICE || '',
  // 例：female_warm:longxiaochun,male:longshu,dialect_dongbei:longlaotie
  ttsVoiceMap: parseVoiceMap(process.env.TTS_VOICE_MAP || ''),
  ttsUpstreamTimeoutMs: Number(process.env.TTS_UPSTREAM_TIMEOUT_MS || 15_000),
}

function parseVoiceMap(raw) {
  const map = {}
  String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const index = pair.indexOf(':')
      if (index <= 0) return
      const key = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      if (key && value) map[key] = value
    })
  return map
}

function assertInteger(name, value, minimum) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} 必须是不小于 ${minimum} 的整数`)
}

export function validateConfig() {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT 必须是 1-65535 的整数')
  }
  assertInteger('JWT_EXPIRES_IN_SEC', config.jwtExpiresInSec, 300)
  assertInteger('AI_UPSTREAM_TIMEOUT_MS', config.aiUpstreamTimeoutMs, 500)
  assertInteger('AI_REQUEST_TIMEOUT_MS', config.aiRequestTimeoutMs, 1_000)
  assertInteger('AI_ACTION_TTL_MS', config.aiActionTtlMs, 100)
  assertInteger('STT_UPSTREAM_TIMEOUT_MS', config.sttUpstreamTimeoutMs, 500)
  assertInteger('TTS_UPSTREAM_TIMEOUT_MS', config.ttsUpstreamTimeoutMs, 500)
  if (config.isProd && config.jwtSecret.length < 32) throw new Error('生产环境 JWT_SECRET 至少需要 32 个字符')
  if (config.isProd && config.allowDevLogin) throw new Error('生产环境禁止开启 ALLOW_DEV_LOGIN')
  if (config.isProd && (config.sttProvider === 'dashscope_async' || config.ttsApiUrl) && !config.publicBaseUrl) {
    throw new Error('生产环境启用语音能力时必须配置 PUBLIC_BASE_URL')
  }
}

export default config
