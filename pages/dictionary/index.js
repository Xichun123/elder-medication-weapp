const api = require('../../utils/api')
const { showError } = require('../../utils/helpers')

const meta = {
  drug_category: ['药物分类','DrugMaster','category','DRUG_CATEGORY_CHOICES'], reminder_status: ['提醒状态','ReminderRule','status','REMINDER_STATUS_CHOICES'],
  contraindication_type: ['禁忌类型','DrugContraindication','contra_type','CONTRAINDICATION_TYPE_CHOICES'], family_role: ['家属角色','FamilyAccount / Relation','role / relation_type','FAMILY_ROLE_CHOICES'],
  permission_level: ['权限级别','FamilyElderRelation','permission_level','PERMISSION_LEVEL_CHOICES'], gender: ['性别','Elder','gender','GENDER_CHOICES'], voice_tone: ['音色偏好','Elder','voice_tone','VOICE_TONE_CHOICES'], severity: ['严重程度','DrugContraindication','severity','inline choices'],
}

Page({
  data: { dictionaries: [], loading: false },
  onLoad() { this.load() },
  async load() { this.setData({ loading: true }); try { const data = await api.dataDictionary(); const dictionaries = Object.keys(meta).map((key) => ({ key, name: meta[key][0], model: meta[key][1], field: meta[key][2], constName: meta[key][3], items: data[key] || [] })); this.setData({ dictionaries }) } catch (error) { showError(error) } finally { this.setData({ loading: false }) } },
})
