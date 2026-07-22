const { dictionaries, createSeedData } = require('./seed')
const { commonDrugs } = require('./common-drugs')
const { getReminderTimes } = require('./frequencies')

const STORAGE_KEY = 'elder_medication.database.v1'
let cache = null

const clone = (value) => JSON.parse(JSON.stringify(value))
const now = () => new Date().toISOString()
const label = (name, value) => ((dictionaries[name] || []).find((item) => item.value === value) || {}).label || value || ''

function load() {
  if (cache) return cache
  try {
    const stored = wx.getStorageSync(STORAGE_KEY)
    cache = stored && stored.version === 1 ? stored : createSeedData()
    ensureCommonDrugs(cache)
  } catch (error) {
    console.warn('读取本地台账失败，已恢复种子数据', error)
    cache = createSeedData()
  }
  persist()
  return cache
}

function ensureCommonDrugs(data) {
  if (!data || !Array.isArray(data.drugs)) return
  const names = new Set(data.drugs.map((drug) => String(drug.generic_name || '').trim()).filter(Boolean))
  commonDrugs.forEach((drug) => {
    if (names.has(drug.generic_name)) return
    data.drugs.push(clone(drug))
    names.add(drug.generic_name)
  })
}

function persist() {
  try {
    wx.setStorageSync(STORAGE_KEY, cache)
  } catch (error) {
    throw new Error('本地数据保存失败，请检查小程序存储空间')
  }
}

function reset() {
  cache = createSeedData()
  persist()
  return clone(cache)
}

function exportData() {
  return clone(load())
}

function collection(name) {
  return load()[name]
}

function requireItem(name, field, id, message) {
  const item = collection(name).find((row) => row[field] === id)
  if (!item) throw new Error(message || '数据不存在')
  return item
}

function create(name, field, payload) {
  const rows = collection(name)
  if (!payload[field]) throw new Error(`${field} 不能为空`)
  if (rows.some((item) => item[field] === payload[field])) throw new Error(`${payload[field]} 已存在`)
  const item = { ...clone(payload), created_at: now() }
  rows.push(item)
  persist()
  return item
}

function update(name, field, id, payload) {
  const item = requireItem(name, field, id)
  Object.keys(payload || {}).forEach((key) => {
    if (key !== field && payload[key] !== undefined) item[key] = clone(payload[key])
  })
  item.updated_at = now()
  persist()
  return item
}

function remove(name, field, id) {
  const rows = collection(name)
  const index = rows.findIndex((item) => item[field] === id)
  if (index < 0) throw new Error('数据不存在')
  rows.splice(index, 1)
  persist()
}

function elderView(item) {
  return {
    ...clone(item),
    gender_label: label('gender', item.gender),
    voice_tone_label: label('voice_tone', item.voice_tone),
    medication_count: collection('records').filter((record) => record.elder === item.elder_id).length,
  }
}

function familyView(item) {
  return {
    ...clone(item),
    role_label: label('family_role', item.role),
    elder_count: collection('relations').filter((relation) => relation.family === item.family_id).length,
  }
}

function relationView(item) {
  const family = collection('families').find((row) => row.family_id === item.family)
  const elder = collection('elders').find((row) => row.elder_id === item.elder)
  return {
    ...clone(item),
    family_name: family ? family.name : '未知家属',
    elder_name: elder ? elder.name : '未知老人',
    relation_type_label: label('family_role', item.relation_type),
    permission_level_label: label('permission_level', item.permission_level),
  }
}

function drugView(item) {
  return { ...clone(item), category_label: label('drug_category', item.category) }
}

function recordView(item) {
  const elder = collection('elders').find((row) => row.elder_id === item.elder)
  const drug = collection('drugs').find((row) => row.drug_id === item.drug)
  return {
    ...clone(item),
    elder_name: elder ? elder.name : '未知老人',
    drug_name: drug ? drug.generic_name : '未知药物',
    drug_category: drug ? drug.category : 'other',
    drug_category_label: drug ? label('drug_category', drug.category) : '其他',
  }
}

function reminderView(item) {
  const elder = collection('elders').find((row) => row.elder_id === item.elder)
  const record = collection('records').find((row) => row.record_id === item.medication_record)
  const drug = record && collection('drugs').find((row) => row.drug_id === record.drug)
  return {
    ...clone(item),
    elder_name: elder ? elder.name : '未知老人',
    drug_name: drug ? drug.generic_name : '未知药物',
    status_label: label('reminder_status', item.status),
  }
}

function contraindicationView(item) {
  const drugA = collection('drugs').find((row) => row.drug_id === item.drug_a)
  const drugB = collection('drugs').find((row) => row.drug_id === item.drug_b)
  return {
    ...clone(item),
    drug_a_name: drugA ? drugA.generic_name : '未知药物',
    drug_b_name: drugB ? drugB.generic_name : item.drug_b_text || '未知',
    contra_type_label: label('contraindication_type', item.contra_type),
    severity_label: label('severity', item.severity),
  }
}

function companionHonorific(elder = {}) {
  const full = String(elder.name || '').trim()
  if (/(?:爷爷|奶奶|外公|外婆|叔叔|阿姨)$/.test(full)) return full
  const name = full.length > 2 ? full.slice(-2) : (full || '亲爱的')
  const relationship = String(elder.relationship || '')
  const gender = elder.gender === 'male' ? 'male' : 'female'
  if (/父|爷|公|叔|舅|爹/.test(relationship) || gender === 'male') return `${name}爷爷`
  if (/母|奶|婆|姨|姑|妈/.test(relationship) || gender === 'female') return `${name}奶奶`
  return name
}

function greetingByRemindTime(remindTime) {
  const match = String(remindTime || '').match(/(\d{1,2}):(\d{2})/)
  const hour = match ? Number(match[1]) : new Date().getHours()
  if (hour < 6) return '凌晨好'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function careTip(salt = '') {
  const tips = ['别着急，慢慢来', '今天也要保持好心情', '家人一直惦记着您', '每一天都要好好照顾自己', '我会一直陪着您']
  let hash = 0
  const key = String(salt || '')
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return tips[hash % tips.length]
}

function generateVoiceText(elder, drug, remindTime = '') {
  const category = drug.category || 'other'
  const categoryLabel = label('drug_category', category)
  const medicine = categoryLabel && categoryLabel !== '其他'
    ? `${categoryLabel}${drug.generic_name}`
    : drug.generic_name
  const tip = careTip(`${remindTime}:${drug.generic_name}`)
  const tone = elder.voice_tone || 'female_warm'
  const flavorEnd = {
    dialect_dongbei: '啊，我可惦记着您呢',
    dialect_sichuan: '噻，我一直陪到您',
    dialect_cantonese: '啦，慢慢食药，唔使急',
    dialect_henan: '中不中？我一直陪着您',
  }[tone] || '我一直陪着您'
  return `${companionHonorific(elder)}${greetingByRemindTime(remindTime)}，该吃${medicine}了。${tip}，${flavorEnd}。`
}

function autoCreateReminders(record) {
  const times = getReminderTimes(record.frequency)
  const elder = requireItem('elders', 'elder_id', record.elder, '老人不存在')
  const drug = requireItem('drugs', 'drug_id', record.drug, '药物不存在')
  const rows = collection('reminders')
  return times.map((remindTime, index) => {
    let ruleId = `${record.record_id}T${String(index + 1).padStart(2, '0')}`
    let suffix = index + 1
    while (rows.some((item) => item.rule_id === ruleId)) {
      suffix += 1
      ruleId = `${record.record_id}T${String(suffix).padStart(2, '0')}`
    }
    const item = {
      rule_id: ruleId,
      elder: record.elder,
      medication_record: record.record_id,
      remind_time: remindTime,
      status: 'pending',
      voice_text: generateVoiceText(elder, drug, remindTime),
      created_at: now(),
    }
    rows.push(item)
    return reminderView(item)
  })
}

module.exports = {
  dictionaries,
  clone,
  load,
  persist,
  reset,
  exportData,
  collection,
  requireItem,
  create,
  update,
  remove,
  elderView,
  familyView,
  relationView,
  drugView,
  recordView,
  reminderView,
  contraindicationView,
  generateVoiceText,
  autoCreateReminders,
  label,
}
