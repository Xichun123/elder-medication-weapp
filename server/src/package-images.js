import crypto from 'node:crypto'
import sharp from 'sharp'
import { config } from './config.js'
import { HttpError } from './errors.js'

export const MAX_PACKAGE_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_STORED_IMAGE_BYTES = 2 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const SIGNED_URL_TTL_SECONDS = 15 * 60

export async function sanitizePackageImage(image) {
  if (!image || typeof image.arrayBuffer !== 'function') throw new HttpError(400, '请选择药品包装照片')
  if (!ALLOWED_IMAGE_TYPES.has(image.type)) throw new HttpError(400, '仅支持 JPG、PNG 或 WebP 图片')
  if (!image.size || image.size > MAX_PACKAGE_IMAGE_BYTES) throw new HttpError(400, '图片大小不能超过 5MB')

  const input = Buffer.from(await image.arrayBuffer())
  let data
  try {
    data = await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer()
  } catch {
    throw new HttpError(400, '图片无法解析，请重新拍摄')
  }
  if (!data.length || data.length > MAX_STORED_IMAGE_BYTES) {
    throw new HttpError(400, '处理后的图片仍然过大，请重新拍摄')
  }
  return { data, contentType: 'image/jpeg', byteSize: data.length }
}

function imageSignature(imageId, expiresAt) {
  return crypto.createHmac('sha256', config.jwtSecret)
    .update(`${imageId}:${expiresAt}`)
    .digest('base64url')
}

export function createPackageImagePath(imageId, now = Date.now()) {
  if (!imageId) return ''
  const expiresAt = Math.floor(now / 1000) + SIGNED_URL_TTL_SECONDS
  const signature = imageSignature(imageId, expiresAt)
  return `/package-images/${encodeURIComponent(imageId)}?expires=${expiresAt}&signature=${signature}`
}

export function verifyPackageImageSignature(imageId, expiresAtValue, signature) {
  const expiresAt = Number(expiresAtValue)
  if (!Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) || !signature) return false
  const expected = Buffer.from(imageSignature(imageId, expiresAt))
  const received = Buffer.from(String(signature))
  return expected.length === received.length && crypto.timingSafeEqual(expected, received)
}
