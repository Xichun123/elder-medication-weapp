import frequencyConfig from '../../utils/frequencies.js'
import { config } from './config.js'
import { HttpError } from './errors.js'
import { sanitizePackageImage } from './package-images.js'

const { frequencyOptions } = frequencyConfig

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const FREQUENCIES = new Set(frequencyOptions)

const prompt = `你是药品包装信息提取助手。请只提取图片中清晰可见的信息，不要根据常识补全，不要提供诊断或用药建议，也不要仅凭散装药片外观判断药名。

只返回一个 JSON 对象，不要使用 Markdown。格式如下：
{
  "is_medication_package": true,
  "generic_name": "药品通用名，无法确认则为空字符串",
  "trade_name": "商品名，无法确认则为空字符串",
  "strength": "包装规格，如10mg，无法确认则为空字符串",
  "dosage_form": "剂型，如片剂/胶囊，无法确认则为空字符串",
  "dosage_text": "图片上明确可见的每次剂量或用法原文，无法确认则为空字符串",
  "frequency": "仅当图片明确写出每日服用次数时返回每日1次至每日12次之一（如每日4次），否则为空字符串",
  "manufacturer": "生产企业，无法确认则为空字符串",
  "visible_text": ["支持判断的关键原文"],
  "uncertain_fields": ["无法确认或存在歧义的字段名"],
  "warnings": ["需要家属人工核对的事项"]
}

如果不是药品包装、药瓶标签、处方或明确的用药标签，将 is_medication_package 设为 false。所有剂量与频次必须由家属结合医生处方确认。`

function text(value, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function stringList(value, maxItems = 8) {
  if (!Array.isArray(value)) return []
  return value.map((item) => text(item, 240)).filter(Boolean).slice(0, maxItems)
}

export function parseModelContent(content) {
  const raw = Array.isArray(content)
    ? content.map((item) => (typeof item === 'string' ? item : item?.text || '')).join('')
    : String(content || '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : raw).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new HttpError(502, '模型未返回可解析的识别结果')
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    throw new HttpError(502, '模型返回格式异常，请重新拍摄')
  }
}

export function normalizeRecognition(value) {
  const frequency = text(value?.frequency, 20)
  return {
    isMedicationPackage: value?.is_medication_package === true,
    genericName: text(value?.generic_name, 100),
    tradeName: text(value?.trade_name, 100),
    strength: text(value?.strength, 60),
    dosageForm: text(value?.dosage_form, 60),
    dosageText: text(value?.dosage_text, 160),
    frequency: FREQUENCIES.has(frequency) ? frequency : '',
    manufacturer: text(value?.manufacturer, 120),
    visibleText: stringList(value?.visible_text),
    uncertainFields: stringList(value?.uncertain_fields),
    warnings: stringList(value?.warnings),
  }
}

export async function recognizeMedicationImage(image) {
  if (!config.recognitionApiUrl || !config.recognitionApiKey || !config.recognitionModel) {
    throw new HttpError(503, '拍照识别尚未配置，请先手动录入')
  }
  if (!image || typeof image.arrayBuffer !== 'function') throw new HttpError(400, '请选择药盒照片')
  if (!ALLOWED_IMAGE_TYPES.has(image.type)) throw new HttpError(400, '仅支持 JPG、PNG 或 WebP 图片')
  if (!image.size || image.size > MAX_IMAGE_BYTES) throw new HttpError(400, '图片大小不能超过 5MB')

  const processed = await sanitizePackageImage(image)
  const imageUrl = 'data:' + processed.contentType + ';base64,' + processed.data.toString('base64')
  let response
  try {
    response = await fetch(config.recognitionApiUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(config.recognitionTimeoutMs),
      headers: {
        Authorization: `Bearer ${config.recognitionApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.recognitionModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          ],
        }],
      }),
    })
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new HttpError(504, '识别超时，请稍后重试')
    throw new HttpError(502, '识别服务暂时不可用')
  }

  if (!response.ok) {
    if (response.status === 429) throw new HttpError(429, '识别服务繁忙或额度已用完，请稍后再试')
    if (response.status === 401 || response.status === 403) throw new HttpError(503, '识别服务配置无效')
    throw new HttpError(502, '识别服务返回异常')
  }

  const payload = await response.json().catch(() => null)
  const content = payload?.choices?.[0]?.message?.content
  const result = normalizeRecognition(parseModelContent(content))
  if (!result.isMedicationPackage) throw new HttpError(422, '未识别到药盒或处方，请重新拍摄')
  if (!result.genericName && !result.tradeName) throw new HttpError(422, '药名不清晰，请拍摄药盒正面后重试')
  return { ...result, model: config.recognitionModel }
}
