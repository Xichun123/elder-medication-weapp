const { dictionaries, createSeedData } = require('./seed')

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
  } catch (error) {
    console.warn('读取本地台账失败，已恢复种子数据', error)
    cache = createSeedData()
  }
  persist()
  return cache
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

function generateVoiceText(elder, drug) {
  const category = label('drug_category', drug.category)
  return category && category !== '其他'
    ? `${elder.name}，该服${category}${drug.generic_name}了`
    : `${elder.name}，该服${drug.generic_name}了`
}

function autoCreateReminders(record) {
  const times = {
    '每日1次': ['早8:00'],
    '每日2次': ['早8:00', '晚20:00'],
    '每日3次': ['早8:00', '午12:00', '晚20:00'],
  }[record.frequency] || ['早8:00']
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
      voice_text: generateVoiceText(elder, drug),
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
