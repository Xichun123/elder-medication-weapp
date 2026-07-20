import { Hono } from 'hono'
import { getDb } from '../db.js'
import { verifyPackageImageSignature } from '../package-images.js'

const packageImages = new Hono()

packageImages.get('/:imageId', (c) => {
  const imageId = c.req.param('imageId')
  const expiresAt = Number(c.req.query('expires'))
  if (!verifyPackageImageSignature(imageId, expiresAt, c.req.query('signature'))) {
    return c.json({ error: '图片地址已失效' }, 403)
  }
  const row = getDb().prepare(`
    SELECT content_type, image_data
    FROM drug_package_images
    WHERE id = ?
  `).get(imageId)
  if (!row) return c.json({ error: '药品包装照片不存在' }, 404)

  return new Response(row.image_data, {
    headers: {
      'Cache-Control': `private, max-age=${Math.max(0, expiresAt - Math.floor(Date.now() / 1000))}`,
      'Content-Type': row.content_type,
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

export default packageImages
