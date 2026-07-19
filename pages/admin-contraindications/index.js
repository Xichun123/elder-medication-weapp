const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const store = require('../../utils/store')
const { unwrap, toast, showError, confirm, makeId } = require('../../utils/helpers')

const typeOptions = [
  { value: 'co_administration', label: '同服禁忌' },
  { value: 'diet', label: '饮食禁忌' },
  { value: 'disease', label: '疾病禁忌' },
]
const severityOptions = [
  { value: 'light', label: '轻' },
  { value: 'middle', label: '中' },
  { value: 'severe', label: '严重' },
]

function emptyForm() {
  return {
    relation_id: makeId('C'),
    drug_a: '',
    drug_b: '',
    drug_b_text: '',
    contra_type: 'co_administration',
    severity: 'middle',
    note: '',
  }
}

Page({
  data: {
    loading: false,
    saving: false,
    editing: false,
    isEdit: false,
    canEdit: true,
    list: [],
    drugs: [],
    drugBOptions: [{ drug_id: '', generic_name: '文本项（食物/疾病等）' }],
    drugAIndex: 0,
    drugBIndex: 0,
    typeOptions,
    severityOptions,
    typeIndex: 0,
    severityIndex: 1,
    form: emptyForm(),
  },

  onShow() {
    if (!config.useLocalApi && !session.getHome()) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    this.setData({ canEdit: store.canEdit() })
    if (!this.data.editing) this.load()
  },

  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },

  async load() {
    this.setData({ loading: true })
    try {
      const [list, drugs] = await Promise.all([
        api.contraindications.list(),
        api.drugs.list(),
      ])
      const drugRows = unwrap(drugs)
      this.setData({
        list: unwrap(list),
        drugs: drugRows,
        drugBOptions: [{ drug_id: '', generic_name: '文本项（食物/疾病等）' }, ...drugRows],
      })
    } catch (error) { showError(error) }
    finally { this.setData({ loading: false }) }
  },

  openCreate() {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    const form = emptyForm()
    if (this.data.drugs[0]) form.drug_a = this.data.drugs[0].drug_id
    this.setData({
      editing: true,
      isEdit: false,
      form,
      drugAIndex: 0,
      drugBIndex: 0,
      typeIndex: 0,
      severityIndex: 1,
    })
  },

  openEdit(event) {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    const row = this.data.list.find((item) => item.relation_id === event.currentTarget.dataset.id)
    if (!row) return
    if (row.is_system) { toast('系统禁忌只读'); return }
    this.setData({
      editing: true,
      isEdit: true,
      form: { ...row },
      drugAIndex: Math.max(0, this.data.drugs.findIndex((drug) => drug.drug_id === row.drug_a)),
      drugBIndex: Math.max(0, this.data.drugBOptions.findIndex((drug) => drug.drug_id === row.drug_b)),
      typeIndex: Math.max(0, typeOptions.findIndex((item) => item.value === row.contra_type)),
      severityIndex: Math.max(0, severityOptions.findIndex((item) => item.value === row.severity)),
    })
  },

  cancel() { this.setData({ editing: false }) },
  onInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }) },
  onDrugAChange(event) {
    const index = Number(event.detail.value)
    const drug = this.data.drugs[index]
    if (drug) this.setData({ drugAIndex: index, 'form.drug_a': drug.drug_id })
  },
  onDrugBChange(event) {
    const index = Number(event.detail.value)
    const drug = this.data.drugBOptions[index]
    if (!drug) return
    this.setData({
      drugBIndex: index,
      'form.drug_b': drug.drug_id,
      ...(drug.drug_id ? { 'form.drug_b_text': '' } : {}),
    })
  },
  onTypeChange(event) {
    const index = Number(event.detail.value)
    this.setData({ typeIndex: index, 'form.contra_type': typeOptions[index].value })
  },
  onSeverityChange(event) {
    const index = Number(event.detail.value)
    this.setData({ severityIndex: index, 'form.severity': severityOptions[index].value })
  },

  async save() {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    const form = this.data.form
    if (!form.drug_a || (!form.drug_b && !String(form.drug_b_text || '').trim())) {
      toast('请选择药物并填写相互作用项')
      return
    }
    this.setData({ saving: true })
    try {
      if (this.data.isEdit) await api.contraindications.update(form.relation_id, form)
      else await api.contraindications.create(form)
      toast(this.data.isEdit ? '修改成功' : '新增成功', 'success')
      this.setData({ editing: false })
      await this.load()
    } catch (error) { showError(error) }
    finally { this.setData({ saving: false }) }
  },

  async remove(event) {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    const row = this.data.list.find((item) => item.relation_id === event.currentTarget.dataset.id)
    if (row && row.is_system) { toast('系统禁忌不可删除'); return }
    if (!(await confirm('确定删除该家庭禁忌？', '删除禁忌'))) return
    try {
      await api.contraindications.remove(event.currentTarget.dataset.id)
      toast('已删除', 'success')
      await this.load()
    } catch (error) { showError(error) }
  },
})
