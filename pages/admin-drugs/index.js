const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const store = require('../../utils/store')
const { unwrap, toast, showError, confirm, makeId } = require('../../utils/helpers')

const categories = [
  { value: '', label: '全部分类' },
  { value: 'antibiotic', label: '抗生素' },
  { value: 'antihypertensive', label: '降压药' },
  { value: 'hypoglycemic', label: '降糖药' },
  { value: 'antiplatelet', label: '抗血小板' },
  { value: 'other', label: '其他' },
]
const formCategories = categories.filter((item) => item.value)
const emptyForm = () => ({
  drug_id: makeId('D'), generic_name: '', trade_name: '', aliases: '', category: 'other',
  ingredient: '', dosage_text: '', contraindication_note: '', interaction_note: '',
})
const formCategoryIndexOf = (value) => {
  const index = formCategories.findIndex((item) => item.value === value)
  return index >= 0 ? index : formCategories.findIndex((item) => item.value === 'other')
}

Page({
  data: {
    list: [], loading: false, keyword: '', categories, formCategories, categoryIndex: 0,
    editing: false, isEdit: false, saving: false, form: emptyForm(), formCategoryIndex: formCategoryIndexOf('other'),
    canEdit: true, isRemote: false,
  },
  onShow() {
    if (!config.useLocalApi && !session.getHome()) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    this.setData({ canEdit: store.canEdit(), isRemote: !config.useLocalApi })
    if (!this.data.editing) this.load()
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    this.setData({ loading: true })
    try {
      const category = categories[this.data.categoryIndex].value
      this.setData({ list: unwrap(await api.drugs.list({ keyword: this.data.keyword, category })) })
    } catch (error) { showError(error) }
    finally { this.setData({ loading: false }) }
  },
  onKeyword(event) { this.setData({ keyword: event.detail.value }) },
  onSearch() { this.load() },
  onCategory(event) { this.setData({ categoryIndex: Number(event.detail.value) }, () => this.load()) },
  openCreate() {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    this.setData({ editing: true, isEdit: false, form: emptyForm(), formCategoryIndex: formCategoryIndexOf('other') })
  },
  openEdit(event) {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    const row = this.data.list.find((item) => item.drug_id === event.currentTarget.dataset.id)
    if (!row) return
    if (row.is_system) { toast('系统药库只读，请新增家庭药物'); return }
    this.setData({ editing: true, isEdit: true, form: { ...row }, formCategoryIndex: formCategoryIndexOf(row.category) })
  },
  cancel() { this.setData({ editing: false }) },
  onInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }) },
  onFormCategory(event) {
    const formCategoryIndex = Number(event.detail.value)
    const category = formCategories[formCategoryIndex]
    if (!category) return
    this.setData({ formCategoryIndex, 'form.category': category.value })
  },
  async save() {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    const f = this.data.form
    if (!f.generic_name || !f.category) { toast('请完整填写必填项'); return }
    if (config.useLocalApi && !f.drug_id) { toast('请完整填写必填项'); return }
    this.setData({ saving: true })
    try {
      if (this.data.isEdit) await api.drugs.update(f.drug_id, f)
      else await api.drugs.create(config.useLocalApi ? f : { ...f, drug_id: undefined })
      toast(this.data.isEdit ? '修改成功' : '新增成功', 'success')
      this.setData({ editing: false })
      await this.load()
    } catch (error) { showError(error) }
    finally { this.setData({ saving: false }) }
  },
  async remove(event) {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    const id = event.currentTarget.dataset.id
    const row = this.data.list.find((item) => item.drug_id === id)
    if (row && row.is_system) { toast('系统药库不可删除'); return }
    if (!(await confirm('若已有用药记录引用将无法删除。确定继续？', '删除药物'))) return
    try { await api.drugs.remove(id); toast('已删除', 'success'); await this.load() } catch (error) { showError(error) }
  },
})
