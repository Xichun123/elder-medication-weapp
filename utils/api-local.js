const db = require('./database')

const asyncValue = (value) => Promise.resolve(db.clone(value))
const contains = (value, keyword) => String(value || '').toLowerCase().includes(String(keyword || '').toLowerCase())
const pick = (source, fields) => fields.reduce((result, field) => {
  if (source && source[field] !== undefined) result[field] = source[field]
  return result
}, {})

function removeWhere(rows, predicate) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (predicate(rows[index])) rows.splice(index, 1)
  }
}

function listElders(params = {}) {
  let rows = db.collection('elders')
  if (params.family) {
    const ids = new Set(db.collection('relations').filter((item) => item.family === params.family).map((item) => item.elder))
    rows = rows.filter((item) => ids.has(item.elder_id))
  }
  if (params.keyword) rows = rows.filter((item) => contains(item.name, params.keyword) || contains(item.relationship, params.keyword))
  return rows.map(db.elderView)
}

function listFamilies() {
  return db.collection('families').map(db.familyView)
}

function listRelations(params = {}) {
  let rows = db.collection('relations')
  if (params.family) rows = rows.filter((item) => item.family === params.family)
  if (params.elder) rows = rows.filter((item) => item.elder === params.elder)
  return rows.map(db.relationView)
}

function listDrugs(params = {}) {
  let rows = db.collection('drugs')
  if (params.keyword) rows = rows.filter((item) => contains(item.generic_name, params.keyword) || contains(item.trade_name, params.keyword) || contains(item.aliases, params.keyword))
  if (params.category) rows = rows.filter((item) => item.category === params.category)
  return rows.map(db.drugView)
}

function familyElderIds(familyId) {
  return new Set(db.collection('relations').filter((item) => item.family === familyId).map((item) => item.elder))
}

function listRecords(params = {}) {
  let rows = db.collection('records')
  if (params.elder) rows = rows.filter((item) => item.elder === params.elder)
  if (params.family) {
    const ids = familyElderIds(params.family)
    rows = rows.filter((item) => ids.has(item.elder))
  }
  return rows.map(db.recordView)
}

function listReminders(params = {}) {
  let rows = db.collection('reminders')
  if (params.elder) rows = rows.filter((item) => item.elder === params.elder)
  if (params.family) {
    const ids = familyElderIds(params.family)
    rows = rows.filter((item) => ids.has(item.elder))
  }
  if (params.status) rows = rows.filter((item) => item.status === params.status)
  return rows.map(db.reminderView)
}

function listContraindications(params = {}) {
  let rows = db.collection('contraindications')
  if (params.severity) rows = rows.filter((item) => item.severity === params.severity)
  if (params.contra_type) rows = rows.filter((item) => item.contra_type === params.contra_type)
  if (params.drug) rows = rows.filter((item) => item.drug_a === params.drug || item.drug_b === params.drug)
  return rows.map(db.contraindicationView)
}

function buildDashboard(elderId) {
  const elder = db.requireItem('elders', 'elder_id', elderId, '老人不存在')
  const records = db.collection('records').filter((item) => item.elder === elderId)
  const drugIds = new Set(records.map((item) => item.drug))
  const medications = records.map((record) => {
    const drug = db.requireItem('drugs', 'drug_id', record.drug, '药物不存在')
    return {
      record_id: record.record_id,
      drug_id: drug.drug_id,
      drug_name: drug.generic_name,
      category: drug.category,
      category_label: db.label('drug_category', drug.category),
      dose: record.dose,
      frequency: record.frequency,
    }
  })
  const risks = db.collection('contraindications')
    .filter((item) => drugIds.has(item.drug_a) || (item.drug_b && drugIds.has(item.drug_b)))
    .map((item) => {
      const view = db.contraindicationView(item)
      const bothTaken = Boolean(item.drug_b) && drugIds.has(item.drug_a) && drugIds.has(item.drug_b)
      return {
        ...view,
        drug_a_id: item.drug_a,
        drug_b_id: item.drug_b || '',
        drug_b_is_food: !item.drug_b,
        relevance: item.drug_b ? (bothTaken ? '同时服用中' : '注意未同时服用') : '饮食注意事项',
      }
    })
    .sort((a, b) => ({ severe: 0, middle: 1, light: 2 }[a.severity] - ({ severe: 0, middle: 1, light: 2 }[b.severity])))
  return {
    elder: { elder_id: elder.elder_id, name: elder.name, gender: elder.gender, age: elder.age, allergy_note: elder.allergy_note },
    medications,
    risks,
    stats: {
      total: risks.length,
      severe: risks.filter((item) => item.severity === 'severe').length,
      middle: risks.filter((item) => item.severity === 'middle').length,
      light: risks.filter((item) => item.severity === 'light').length,
    },
  }
}

function familyOverview(familyId) {
  const family = db.requireItem('families', 'family_id', familyId, '家属不存在')
  const relations = db.collection('relations').filter((item) => item.family === familyId)
  const elders = relations.map((relation) => {
    const elder = db.requireItem('elders', 'elder_id', relation.elder, '老人不存在')
    return {
      elder_id: elder.elder_id,
      name: elder.name,
      age: elder.age,
      gender: elder.gender,
      gender_label: db.label('gender', elder.gender),
      relationship: elder.relationship,
      permission_level: relation.permission_level,
      permission_level_label: db.label('permission_level', relation.permission_level),
      medication_count: db.collection('records').filter((item) => item.elder === elder.elder_id).length,
      reminder_pending_count: db.collection('reminders').filter((item) => item.elder === elder.elder_id && item.status === 'pending').length,
      contraindication_count: buildDashboard(elder.elder_id).stats.total,
    }
  })
  return { family: db.familyView(family), elders }
}

const api = {
  recognition: {
    recognize: () => Promise.reject(new Error('本地演示模式不支持 AI 拍照识别，请手动录入药名')),
  },
  elders: {
    list: (params) => asyncValue(listElders(params)),
    get: (id) => asyncValue(db.elderView(db.requireItem('elders', 'elder_id', id, '老人不存在'))),
    create: (data) => asyncValue(db.elderView(db.create('elders', 'elder_id', data))),
    update: (id, data) => asyncValue(db.elderView(db.update('elders', 'elder_id', id, pick(data, ['name', 'gender', 'age', 'relationship', 'allergy_note', 'voice_tone'])))),
    remove: async (id) => {
      db.requireItem('elders', 'elder_id', id, '老人不存在')
      const recordIds = new Set(db.collection('records').filter((item) => item.elder === id).map((item) => item.record_id))
      removeWhere(db.collection('relations'), (item) => item.elder === id)
      removeWhere(db.collection('reminders'), (item) => item.elder === id || recordIds.has(item.medication_record))
      removeWhere(db.collection('records'), (item) => item.elder === id)
      db.remove('elders', 'elder_id', id)
      return null
    },
  },
  families: {
    list: () => asyncValue(listFamilies()),
    get: (id) => asyncValue(db.familyView(db.requireItem('families', 'family_id', id, '家属不存在'))),
    create: (data) => asyncValue(db.familyView(db.create('families', 'family_id', data))),
    update: (id, data) => asyncValue(db.familyView(db.update('families', 'family_id', id, pick(data, ['name', 'phone', 'role'])))),
    overview: (id) => asyncValue(familyOverview(id)),
  },
  relations: {
    list: (params) => asyncValue(listRelations(params)),
    create: (data) => {
      db.requireItem('families', 'family_id', data.family, '家属不存在')
      db.requireItem('elders', 'elder_id', data.elder, '老人不存在')
      if (db.collection('relations').some((item) => item.family === data.family && item.elder === data.elder)) return Promise.reject(new Error('该家属与老人已关联'))
      return asyncValue(db.relationView(db.create('relations', 'relation_id', data)))
    },
    update: (id, data) => asyncValue(db.relationView(db.update('relations', 'relation_id', id, pick(data, ['relation_type', 'permission_level'])))),
    remove: async (id) => { db.remove('relations', 'relation_id', id); return null },
  },
  drugs: {
    list: (params) => asyncValue(listDrugs(params)),
    get: (id) => asyncValue(db.drugView(db.requireItem('drugs', 'drug_id', id, '药物不存在'))),
    create: (data) => asyncValue(db.drugView(db.create('drugs', 'drug_id', data))),
    update: (id, data) => asyncValue(db.drugView(db.update('drugs', 'drug_id', id, pick(data, ['generic_name', 'trade_name', 'aliases', 'category', 'ingredient', 'dosage_text', 'contraindication_note', 'interaction_note'])))),
    remove: async (id) => {
      if (db.collection('records').some((item) => item.drug === id)) throw new Error('该药物已被用药记录引用，无法删除')
      removeWhere(db.collection('contraindications'), (item) => item.drug_a === id || item.drug_b === id)
      db.remove('drugs', 'drug_id', id)
      return null
    },
    match: (keyword) => asyncValue(listDrugs({ keyword }).slice(0, 10)),
  },
  records: {
    list: (params) => asyncValue(listRecords(params)),
    get: (id) => asyncValue(db.recordView(db.requireItem('records', 'record_id', id, '用药记录不存在'))),
    create: (data) => {
      db.requireItem('elders', 'elder_id', data.elder, '老人不存在')
      db.requireItem('drugs', 'drug_id', data.drug, '药物不存在')
      const record = db.create('records', 'record_id', data)
      const autoCreated = db.autoCreateReminders(record)
      db.persist()
      return asyncValue({ ...db.recordView(record), auto_created_reminders: autoCreated })
    },
    update: (id, data) => {
      const previous = db.requireItem('records', 'record_id', id, '用药记录不存在')
      const previousFrequency = previous.frequency
      const payload = pick(data, ['dose', 'frequency', 'start_date', 'end_date'])
      const record = db.update('records', 'record_id', id, payload)
      if (payload.frequency && payload.frequency !== previousFrequency) {
        removeWhere(db.collection('reminders'), (item) => item.medication_record === id)
        db.autoCreateReminders(record)
        db.persist()
      }
      return asyncValue(db.recordView(record))
    },
    remove: async (id) => {
      db.requireItem('records', 'record_id', id, '用药记录不存在')
      removeWhere(db.collection('reminders'), (item) => item.medication_record === id)
      db.remove('records', 'record_id', id)
      return null
    },
  },
  reminders: {
    list: (params) => asyncValue(listReminders(params)),
    get: (id) => asyncValue(db.reminderView(db.requireItem('reminders', 'rule_id', id, '提醒规则不存在'))),
    create: (data) => asyncValue(db.reminderView(db.create('reminders', 'rule_id', data))),
    update: (id, data) => asyncValue(db.reminderView(db.update('reminders', 'rule_id', id, pick(data, ['remind_time', 'status', 'voice_text'])))),
    remove: async (id) => { db.remove('reminders', 'rule_id', id); return null },
    take: (id) => asyncValue(db.reminderView(db.update('reminders', 'rule_id', id, { status: 'taken' }))),
    skip: (id) => asyncValue(db.reminderView(db.update('reminders', 'rule_id', id, { status: 'skipped' }))),
    regenerateVoice: (id) => {
      const reminder = db.requireItem('reminders', 'rule_id', id, '提醒规则不存在')
      const elder = db.requireItem('elders', 'elder_id', reminder.elder, '老人不存在')
      const record = db.requireItem('records', 'record_id', reminder.medication_record, '用药记录不存在')
      const drug = db.requireItem('drugs', 'drug_id', record.drug, '药物不存在')
      return asyncValue(db.reminderView(db.update('reminders', 'rule_id', id, { voice_text: db.generateVoiceText(elder, drug) })))
    },
  },
  contraindications: {
    list: (params) => asyncValue(listContraindications(params)),
    create: (data) => asyncValue(db.contraindicationView(db.create('contraindications', 'relation_id', data))),
    update: (id, data) => asyncValue(db.contraindicationView(db.update('contraindications', 'relation_id', id, pick(data, ['drug_a', 'drug_b', 'drug_b_text', 'contra_type', 'severity', 'note'])))),
    remove: async (id) => { db.remove('contraindications', 'relation_id', id); return null },
  },
  dashboard: (elderId) => asyncValue(buildDashboard(elderId)),
  dataDictionary: () => asyncValue(db.dictionaries),
  local: {
    reset: () => asyncValue(db.reset()),
    export: () => asyncValue(db.exportData()),
  },
}

module.exports = api
