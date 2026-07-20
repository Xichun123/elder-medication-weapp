import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { config } from '../src/config.js'
import { normalizeRecognition, parseModelContent, recognizeMedicationImage } from '../src/recognition.js'

const originalFetch = global.fetch
const originalApiUrl = config.recognitionApiUrl
const originalApiKey = config.recognitionApiKey
const originalModel = config.recognitionModel

test.beforeEach(() => {
  config.recognitionApiUrl = 'https://example.test/v1/chat/completions'
  config.recognitionApiKey = 'test-model-token'
  config.recognitionModel = 'test-vision-model'
})
test.afterEach(() => {
  config.recognitionApiUrl = originalApiUrl
  config.recognitionApiKey = originalApiKey
  config.recognitionModel = originalModel
  global.fetch = originalFetch
})

const validPngBytes = await sharp({
  create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
}).png().toBuffer()

function testImage({ bytes = validPngBytes, ...overrides } = {}) {
  return {
    type: 'image/png',
    size: bytes.byteLength,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    ...overrides,
  }
}

test('解析模型返回的 JSON 与 Markdown 代码块', () => {
  const parsed = parseModelContent('说明文字\n```json\n{"generic_name":"阿司匹林"}\n```')
  assert.equal(parsed.generic_name, '阿司匹林')
})

test('归一化识别结果并过滤不支持的频次', () => {
  const result = normalizeRecognition({
    is_medication_package: true,
    generic_name: '  二甲双胍  ',
    frequency: '每周1次',
    visible_text: ['  盐酸二甲双胍片  ', '', 8],
    warnings: ['请核对剂量'],
  })

  assert.equal(result.genericName, '二甲双胍')
  assert.equal(result.frequency, '')
  assert.deepEqual(result.visibleText, ['盐酸二甲双胍片'])
  assert.deepEqual(result.warnings, ['请核对剂量'])
  assert.equal(normalizeRecognition({ generic_name: '缺少类型确认' }).isMedicationPackage, false)
})

test('模型未返回 JSON 时抛出可控服务错误', () => {
  assert.throws(
    () => parseModelContent('无法识别'),
    (error) => error.status === 502 && error.message === '模型未返回可解析的识别结果',
  )
})

test('识别请求上传图片并归一化成功结果', async () => {
  let requestBody
  const imageWithMetadata = await sharp({
    create: { width: 3, height: 2, channels: 3, background: '#f2f2f2' },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer()
  assert.ok((await sharp(imageWithMetadata).metadata()).exif)
  global.fetch = async (url, options) => {
    assert.equal(url, config.recognitionApiUrl)
    assert.deepEqual(options.headers, {
      Authorization: 'Bearer test-model-token',
      'Content-Type': 'application/json',
    })
    requestBody = JSON.parse(options.body)
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        is_medication_package: true,
        generic_name: '盐酸托鲁地文拉法辛缓释片',
        trade_name: '若欣林',
        strength: '80mg',
        dosage_form: '片剂',
        visible_text: ['80mg'],
        warnings: ['请核对处方'],
      }) } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const result = await recognizeMedicationImage(testImage({ bytes: imageWithMetadata, type: 'image/jpeg' }))
  assert.equal(result.genericName, '盐酸托鲁地文拉法辛缓释片')
  assert.equal(result.tradeName, '若欣林')
  assert.equal(result.strength, '80mg')
  assert.equal(requestBody.model, config.recognitionModel)
  const forwardedUrl = requestBody.messages[0].content[1].image_url.url
  assert.match(forwardedUrl, /^data:image\/jpeg;base64,/)
  const forwardedBytes = Buffer.from(forwardedUrl.split(',')[1], 'base64')
  const forwardedMetadata = await sharp(forwardedBytes).metadata()
  assert.equal(forwardedMetadata.format, 'jpeg')
  assert.equal(forwardedMetadata.exif, undefined)
})

test('识别前拒绝非法格式与超过 5MB 的图片', async () => {
  await assert.rejects(
    recognizeMedicationImage(testImage({ type: 'image/gif' })),
    (error) => error.status === 400 && error.message.includes('JPG'),
  )
  await assert.rejects(
    recognizeMedicationImage(testImage({ size: 5 * 1024 * 1024 + 1 })),
    (error) => error.status === 400 && error.message.includes('5MB'),
  )
})

test('伪造图片 MIME 的非图片不会调用识别上游', async () => {
  let upstreamCalled = false
  global.fetch = async () => {
    upstreamCalled = true
    throw new Error('不应调用上游')
  }

  const bytes = Buffer.from('not an image')
  await assert.rejects(
    recognizeMedicationImage(testImage({ bytes, type: 'image/jpeg' })),
    (error) => error.status === 400 && error.message.includes('无法解析'),
  )
  assert.equal(upstreamCalled, false)
})

test('映射上游限流与超时错误', async () => {
  global.fetch = async () => new Response('', { status: 429 })
  await assert.rejects(
    recognizeMedicationImage(testImage()),
    (error) => error.status === 429 && error.message.includes('额度'),
  )

  global.fetch = async () => {
    const error = new Error('timeout')
    error.name = 'TimeoutError'
    throw error
  }
  await assert.rejects(
    recognizeMedicationImage(testImage()),
    (error) => error.status === 504,
  )
})
