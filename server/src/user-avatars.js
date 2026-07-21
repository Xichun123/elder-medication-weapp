import sharp from 'sharp'
import { HttpError } from './errors.js'

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ALLOWED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp'])

export async function sanitizeAvatarImage(image) {
  if (!image || typeof image.arrayBuffer !== 'function') throw new HttpError(400, '请选择头像图片')
  if (!image.size || image.size > MAX_AVATAR_BYTES) throw new HttpError(400, '头像大小不能超过 2MB')

  const input = Buffer.from(await image.arrayBuffer())
  let data
  try {
    // wx.uploadFile 在部分机型上不会携带可靠的 MIME；以实际文件内容为准。
    const metadata = await sharp(input, { limitInputPixels: 20_000_000 }).metadata()
    if (!ALLOWED_IMAGE_FORMATS.has(metadata.format)) {
      throw new HttpError(400, '头像仅支持 JPG、PNG 或 WebP')
    }
    data = await sharp(input, { limitInputPixels: 20_000_000 })
      .rotate()
      .resize({ width: 320, height: 320, fit: 'cover', position: 'centre' })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer()
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, '头像图片无法解析，请重新选择')
  }
  if (!data.length || data.length > MAX_AVATAR_BYTES) {
    throw new HttpError(400, '处理后的头像仍然过大，请重新选择')
  }
  return { data, contentType: 'image/jpeg', byteSize: data.length }
}
