const remote = require('./remote')
const config = require('./config')
const session = require('./session')
const { dictionaries } = require('./seed')

const label = (name, value) => ((dictionaries[name] || []).find((item) => item.value === value) || {}).label || value || ''

function requireHome() {
  const home = session.getHome()
  if (!home || !home.id) throw new Error('请先选择家庭')
  return home
}

function homePath(suffix = '') {
  return `/homes/${requireHome().id}${suffix}`
}

function mapElder(item) {
  if (!item) return item
  return {
    elder_id: item.id,
    home_id: item.homeId,
    name: item.name,
    gender: item.gender,
    gender_label: item.genderLabel || label('gender', item.gender),
    age: item.age,
    relationship: item.relationship,
    allergy_note: item.allergyNote,
    voice_tone: item.voiceTone,
    voice_tone_label: item.voiceToneLabel || label('voice_tone', item.voiceTone),
    linked_user_id: item.linkedUserId || null,
    medication_count: item.medicationCount != null ? item.medicationCount : 0,
    reminder_pending_count: item.reminderPendingCount != null ? item.reminderPendingCount : 0,
    contraindication_count: item.contraindicationCount != null ? item.contraindicationCount : 0,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }
}

function mapDrug(item) {
  if (!item) return item
  return {
    drug_id: item.id,
    home_id: item.homeId,
    is_system: item.isSystem,
    generic_name: item.genericName,
    trade_name: item.tradeName,
    aliases: item.aliases,
    category: item.category,
    category_label: item.categoryLabel || label('drug_category', item.category),
    ingredient: item.ingredient,
    dosage_text: item.dosageText,
    contraindication_note: item.contraindicationNote,
    interaction_note: item.interactionNote,
    primary_package_image_url: item.primaryPackageImageUrl || '',
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }
}

function mapRecord(item) {
  if (!item) return item
  return {
    record_id: item.id,
    home_id: item.homeId,
    elder: item.elderProfileId,
    elder_name: item.elderName,
    drug: item.drugId,
    drug_name: item.drugName,
    drug_category: item.drugCategory,
    drug_category_label: item.drugCategoryLabel || label('drug_category', item.drugCategory),
    dose: item.dose,
    frequency: item.frequency,
    start_date: item.startDate,
    end_date: item.endDate,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }
}

function mapReminder(item) {
  if (!item) return item
  return {
    rule_id: item.id,
    home_id: item.homeId,
    elder: item.elderProfileId,
    elder_name: item.elderName,
    medication_record: item.recordId,
    drug_name: item.drugName,
    remind_time: item.remindTime,
    status: item.status,
    status_label: item.statusLabel || label('reminder_status', item.status),
    voice_text: item.voiceText,
    voice_generated_on: item.voiceGeneratedOn || '',
    voice_generation_source: item.voiceGenerationSource || 'template',
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }
}

function mapContra(item) {
  if (!item) return item
  return {
    relation_id: item.id,
    home_id: item.homeId,
    is_system: item.isSystem,
    drug_a: item.drugAId,
    drug_a_name: item.drugAName,
    drug_b: item.drugBId || '',
    drug_b_name: item.drugBName,
    drug_b_text: item.drugBText || '',
    drug_a_id: item.drugAId,
    drug_b_id: item.drugBId || '',
    drug_b_is_food: item.drugBIsFood != null ? item.drugBIsFood : !item.drugBId,
    contra_type: item.contraType,
    contra_type_label: item.contraTypeLabel || label('contraindication_type', item.contraType),
    severity: item.severity,
    severity_label: item.severityLabel || label('severity', item.severity),
    note: item.note,
    relevance: item.relevance,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }
}

function mapFamily(home) {
  return {
    family_id: home.id,
    name: home.name,
    role: home.role || home.myRole || '',
    role_label: label('home_role', home.role || home.myRole) || home.role || home.myRole || '',
    elder_profile_id: home.elderProfileId || home.myElderProfileId || null,
    elderProfileId: home.elderProfileId || home.myElderProfileId || null,
    phone: '',
    elder_count: home.elderCount != null ? home.elderCount : undefined,
  }
}

const api = {
  elders: {
    async list(params = {}) {
      // overview 自带 medication/reminder/risk 计数，避免列表页再拼请求。
      const result = await remote.request({ path: homePath('/overview') })
      let rows = (result.elders || []).map(mapElder)
      if (params.keyword) {
        const keyword = String(params.keyword).toLowerCase()
        rows = rows.filter((item) => String(item.name).toLowerCase().includes(keyword)
          || String(item.relationship).toLowerCase().includes(keyword))
      }
      return rows
    },
    async get(id) {
      const list = await api.elders.list()
      const row = list.find((item) => item.elder_id === id)
      if (!row) throw new Error('老人不存在')
      return row
    },
    async create(data) {
      const result = await remote.request({
        path: homePath('/elders'),
        method: 'POST',
        data: {
          name: data.name,
          gender: data.gender,
          age: Number(data.age),
          relationship: data.relationship,
          allergyNote: data.allergy_note || data.allergyNote || '无',
          voiceTone: data.voice_tone || data.voiceTone || 'female_warm',
        },
      })
      return mapElder(result.elder)
    },
    async update(id, data) {
      const result = await remote.request({
        path: homePath(`/elders/${id}`),
        method: 'PATCH',
        data: {
          name: data.name,
          gender: data.gender,
          age: data.age != null ? Number(data.age) : undefined,
          relationship: data.relationship,
          allergyNote: data.allergy_note,
          voiceTone: data.voice_tone,
        },
      })
      return mapElder(result.elder)
    },
    async remove(id) {
      await remote.request({ path: homePath(`/elders/${id}`), method: 'DELETE' })
      return null
    },
  },

  families: {
    async list() {
      const result = await remote.request({ path: '/homes' })
      return (result.homes || []).map(mapFamily)
    },
    async get(id) {
      const home = requireHome()
      if (id && id !== home.id) {
        const result = await remote.request({ path: `/homes/${id}` })
        return mapFamily({ id: result.home.id, name: result.home.name, role: result.home.myRole })
      }
      return mapFamily(home)
    },
    async create(data) {
      const result = await remote.request({ path: '/homes', method: 'POST', data: { name: data.name } })
      return mapFamily(result.home)
    },
    async update() {
      throw new Error('云端家庭名称修改尚未开放')
    },
    async overview(id) {
      const homeId = id || requireHome().id
      const result = await remote.request({ path: `/homes/${homeId}/overview` })
      return {
        family: mapFamily({
          id: result.home.id,
          name: result.home.name,
          role: result.home.myRole,
          elderCount: result.stats && result.stats.elderCount,
        }),
        elders: (result.elders || []).map(mapElder),
        stats: result.stats,
      }
    },
  },

  relations: {
    async list() {
      const result = await remote.request({ path: homePath('/members') })
      return (result.members || []).map((item) => ({
        relation_id: item.id,
        family: requireHome().id,
        family_name: requireHome().name,
        elder: item.elderProfileId || '',
        elder_name: '',
        relation_type: item.role,
        relation_type_label: label('home_role', item.role) || item.role,
        permission_level: item.role === 'caregiver_view' || item.role === 'elder' ? 'readonly' : 'editable',
        permission_level_label: item.role === 'caregiver_view' || item.role === 'elder' ? '仅查看' : '可录入',
        nickname: item.nickname,
        user_id: item.userId,
        role: item.role,
      }))
    },
    create() { return Promise.reject(new Error('请使用家庭邀请码添加成员')) },
    update() { return Promise.reject(new Error('请在成员管理中修改角色')) },
    remove() { return Promise.reject(new Error('请在成员管理中移除成员')) },
  },

  drugs: {
    async list(params = {}) {
      const query = []
      if (params.keyword) query.push(`keyword=${encodeURIComponent(params.keyword)}`)
      if (params.category) query.push(`category=${encodeURIComponent(params.category)}`)
      const qs = query.length ? `?${query.join('&')}` : ''
      const result = await remote.request({ path: homePath(`/drugs${qs}`) })
      return (result.drugs || []).map(mapDrug)
    },
    async get(id) {
      const result = await remote.request({ path: homePath(`/drugs/${id}`) })
      return mapDrug(result.drug)
    },
    async create(data) {
      const result = await remote.request({
        path: homePath('/drugs'),
        method: 'POST',
        data: {
          genericName: data.generic_name,
          tradeName: data.trade_name,
          aliases: data.aliases,
          category: data.category,
          ingredient: data.ingredient,
          dosageText: data.dosage_text,
          contraindicationNote: data.contraindication_note,
          interactionNote: data.interaction_note,
          primaryPackageImageUrl: data.primary_package_image_url,
        },
      })
      return mapDrug(result.drug)
    },
    async update(id, data) {
      const result = await remote.request({
        path: homePath(`/drugs/${id}`),
        method: 'PATCH',
        data: {
          genericName: data.generic_name,
          tradeName: data.trade_name,
          aliases: data.aliases,
          category: data.category,
          ingredient: data.ingredient,
          dosageText: data.dosage_text,
          contraindicationNote: data.contraindication_note,
          interactionNote: data.interaction_note,
          primaryPackageImageUrl: data.primary_package_image_url,
        },
      })
      return mapDrug(result.drug)
    },
    async remove(id) {
      await remote.request({ path: homePath(`/drugs/${id}`), method: 'DELETE' })
      return null
    },
    async match(keyword) {
      const rows = await api.drugs.list({ keyword })
      return rows.slice(0, 10)
    },
  },

  records: {
    async list(params = {}) {
      const query = []
      if (params.elder) query.push(`elderId=${encodeURIComponent(params.elder)}`)
      const qs = query.length ? `?${query.join('&')}` : ''
      const result = await remote.request({ path: homePath(`/records${qs}`) })
      return (result.records || []).map(mapRecord)
    },
    async get(id) {
      const result = await remote.request({ path: homePath(`/records/${id}`) })
      return mapRecord(result.record)
    },
    async create(data) {
      const result = await remote.request({
        path: homePath('/records'),
        method: 'POST',
        data: {
          elderProfileId: data.elder,
          drugId: data.drug,
          dose: data.dose,
          frequency: data.frequency,
          startDate: data.start_date,
          endDate: data.end_date || null,
        },
      })
      return {
        ...mapRecord(result.record),
        auto_created_reminders: (result.autoCreatedReminders || []).map(mapReminder),
      }
    },
    async update(id, data) {
      const result = await remote.request({
        path: homePath(`/records/${id}`),
        method: 'PATCH',
        data: {
          dose: data.dose,
          frequency: data.frequency,
          startDate: data.start_date,
          endDate: data.end_date,
        },
      })
      return mapRecord(result.record)
    },
    async remove(id) {
      await remote.request({ path: homePath(`/records/${id}`), method: 'DELETE' })
      return null
    },
  },

  reminders: {
    async list(params = {}) {
      const query = []
      if (params.elder) query.push(`elderId=${encodeURIComponent(params.elder)}`)
      if (params.status) query.push(`status=${encodeURIComponent(params.status)}`)
      const qs = query.length ? `?${query.join('&')}` : ''
      const result = await remote.request({ path: homePath(`/reminders${qs}`) })
      return (result.reminders || []).map(mapReminder)
    },
    async get(id) {
      const result = await remote.request({ path: homePath(`/reminders/${id}`) })
      return mapReminder(result.reminder)
    },
    create() { return Promise.reject(new Error('提醒由用药记录自动生成')) },
    async update(id, data) {
      if (data.status === 'taken') return api.reminders.take(id)
      if (data.status === 'skipped') return api.reminders.skip(id)
      throw new Error('云端仅支持更新提醒状态')
    },
    remove() { return Promise.reject(new Error('请通过删除用药记录清理提醒')) },
    async take(id) {
      const result = await remote.request({ path: homePath(`/reminders/${id}/take`), method: 'POST' })
      return mapReminder(result.reminder)
    },
    async skip(id) {
      const result = await remote.request({ path: homePath(`/reminders/${id}/skip`), method: 'POST' })
      return mapReminder(result.reminder)
    },
    async regenerateVoice(id, options = {}) {
      const result = await remote.request({
        path: homePath(`/reminders/${id}/regenerate-voice`),
        method: 'POST',
        data: {
          preferAi: options.preferAi === true,
          aiConsent: options.aiConsent === true,
        },
        timeout: config.aiRequestTimeout,
      })
      return mapReminder(result.reminder)
    },
    async refreshCompanion(data = {}) {
      const result = await remote.request({
        path: homePath('/reminders/refresh-companion'),
        method: 'POST',
        data,
        timeout: config.aiRequestTimeout,
      })
      return result
    },
  },

  contraindications: {
    async list(params = {}) {
      const query = []
      if (params.severity) query.push(`severity=${encodeURIComponent(params.severity)}`)
      if (params.contra_type) query.push(`contraType=${encodeURIComponent(params.contra_type)}`)
      if (params.drug) query.push(`drugId=${encodeURIComponent(params.drug)}`)
      const qs = query.length ? `?${query.join('&')}` : ''
      const result = await remote.request({ path: homePath(`/contraindications${qs}`) })
      return (result.contraindications || []).map(mapContra)
    },
    async create(data) {
      const result = await remote.request({
        path: homePath('/contraindications'),
        method: 'POST',
        data: {
          drugAId: data.drug_a,
          drugBId: data.drug_b || null,
          drugBText: data.drug_b_text || '',
          contraType: data.contra_type,
          severity: data.severity,
          note: data.note,
        },
      })
      return mapContra(result.contraindication)
    },
    async update(id, data) {
      const result = await remote.request({
        path: homePath(`/contraindications/${id}`),
        method: 'PATCH',
        data: {
          drugAId: data.drug_a,
          drugBId: data.drug_b,
          drugBText: data.drug_b_text,
          contraType: data.contra_type,
          severity: data.severity,
          note: data.note,
        },
      })
      return mapContra(result.contraindication)
    },
    async remove(id) {
      await remote.request({ path: homePath(`/contraindications/${id}`), method: 'DELETE' })
      return null
    },
  },

  async dashboard(elderId) {
    const result = await remote.request({ path: homePath(`/elders/${elderId}/dashboard`) })
    return {
      elder: {
        elder_id: result.elder.id,
        name: result.elder.name,
        gender: result.elder.gender,
        age: result.elder.age,
        allergy_note: result.elder.allergyNote,
      },
      medications: (result.medications || []).map((item) => ({
        record_id: item.recordId,
        drug_id: item.drugId,
        drug_name: item.drugName,
        category: item.category,
        category_label: item.categoryLabel,
        dose: item.dose,
        frequency: item.frequency,
      })),
      risks: (result.risks || []).map(mapContra),
      stats: result.stats,
    }
  },

  dataDictionary: () => Promise.resolve(dictionaries),

  ai: {
    async chat(data) {
      try {
        return await remote.request({ path: homePath('/ai/chat'), method: 'POST', data, timeout: config.aiRequestTimeout })
      } catch (error) {
        // 兼容生产环境旧后端：本地缓存的 elderId 可能已不属于当前家庭，
        // 旧后端会返回 404。去掉 elderId 后，单老人家庭可由服务端自动选择，
        // 药品安全等不依赖具体老人的问题也能继续回答。
        if (error.statusCode === 404 && data && data.elderId) {
          const fallback = { ...data }
          delete fallback.elderId
          return remote.request({ path: homePath('/ai/chat'), method: 'POST', data: fallback, timeout: config.aiRequestTimeout })
        }
        throw error
      }
    },
    async createPendingAction(data) {
      return remote.request({ path: homePath('/ai/pending-actions'), method: 'POST', data })
    },
    async confirmPendingAction(actionId) {
      return remote.request({ path: homePath(`/ai/pending-actions/${actionId}/confirm`), method: 'POST' })
    },
    async transcribe(data) {
      return remote.request({ path: homePath('/ai/transcribe'), method: 'POST', data, timeout: config.sttRequestTimeout })
    },
    async speech(text, options = {}) {
      return remote.request({
        path: homePath('/ai/speech'),
        method: 'POST',
        data: {
          text,
          tone: options.tone || options.voiceTone || '',
          voice: options.voice || '',
          aiConsent: options.aiConsent === true,
        },
        timeout: config.ttsRequestTimeout,
      })
    },
  },

  alerts: {
    async list({ unread = false } = {}) {
      const result = await remote.request({ path: homePath(`/alerts${unread ? '?unread=1' : ''}`) })
      return result
    },
    async markRead(alertId) {
      const result = await remote.request({ path: homePath(`/alerts/${alertId}/read`), method: 'PATCH' })
      return result.alert
    },
  },

  local: {
    reset() {
      return Promise.reject(new Error('云端家庭不支持恢复演示数据'))
    },
    export() {
      return Promise.reject(new Error('云端家庭请使用各业务列表导出，暂不提供整库导出'))
    },
  },

  /** 远程专有：成员与邀请 */
  members: {
    async list() {
      const result = await remote.request({ path: homePath('/members') })
      return result.members || []
    },
    async updateRole(memberId, role) {
      const result = await remote.request({
        path: homePath(`/members/${memberId}`),
        method: 'PATCH',
        data: { role },
      })
      return result.member
    },
    async remove(memberId) {
      await remote.request({ path: homePath(`/members/${memberId}`), method: 'DELETE' })
      return null
    },
  },
  invites: {
    async list() {
      const result = await remote.request({ path: homePath('/invites') })
      return result.invites || []
    },
    async create(data) {
      const result = await remote.request({
        path: homePath('/invites'),
        method: 'POST',
        data,
      })
      return result.invite
    },
    async revoke(inviteId) {
      await remote.request({ path: homePath(`/invites/${inviteId}`), method: 'DELETE' })
      return null
    },
  },
}

module.exports = api
