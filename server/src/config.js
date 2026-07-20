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
  recognitionApiUrl: process.env.RECOGNITION_API_URL || '',
  recognitionApiKey: process.env.RECOGNITION_API_KEY || '',
  recognitionModel: process.env.RECOGNITION_MODEL || '',
  recognitionTimeoutMs: Number(process.env.RECOGNITION_TIMEOUT_MS || 30_000),
}

export function validateConfig() {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT 必须是 1-65535 的整数')
  }
  if (!Number.isInteger(config.jwtExpiresInSec) || config.jwtExpiresInSec < 300) {
    throw new Error('JWT_EXPIRES_IN_SEC 必须是不小于 300 的整数')
  }
  if (config.isProd && config.jwtSecret.length < 32) {
    throw new Error('生产环境 JWT_SECRET 至少需要 32 个字符')
  }
  if (config.isProd && config.allowDevLogin) {
    throw new Error('生产环境禁止开启 ALLOW_DEV_LOGIN')
  }
  if (!Number.isInteger(config.recognitionTimeoutMs) || config.recognitionTimeoutMs < 5_000) {
    throw new Error('RECOGNITION_TIMEOUT_MS 必须是不小于 5000 的整数')
  }
}

export default config
