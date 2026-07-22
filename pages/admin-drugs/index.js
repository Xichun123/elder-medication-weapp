const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const store = require('../../utils/store')
const { categoryLabels } = require('../../utils/common-drugs')
const { unwrap, toast, showError, confirm, makeId } = require('../../utils/helpers')

const currentCategories = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))
// 旧分类仅用于筛选历史数据；新建药品时不可继续选择。
const legacyCategories = [
  { value: 'antihypertensive', label: '降压药（旧分类）' },
  { value: 'antiplatelet', label: '抗血小板（旧分类）' },
]
const categories = [{ value: '', label: '全部分类' }, ...currentCategories, ...legacyCategories]
const emptyForm = () => ({
  drug_id: makeId('D'), generic_name: '', trade_name: '', aliases: '', category: 'other',
  ingredient: '', dosage_text: '', contraindication_note: '', interaction_note: '',
})
const formCategoriesFor = (value) => {
  const legacy = legacyCategories.find((item) => item.value === value)
  return legacy ? [...currentCategories, legacy] : currentCategories
}
const formCategoryIndexOf = (value, options = currentCategories) => {
  const index = options.findIndex((item) => item.value === value)
  return index >= 0 ? index : options.findIndex((item) => item.value === 'other')
}

Page({
  data: {
    list: [], loading: false, keyword: '', categories, formCategories: currentCategories, categoryIndex: 0,
    editing: false, isEdit: false, saving: false, form: emptyForm(), formCategoryIndex: formCategoryIndexOf('other'),
    canEdit: true, isRemote: false,
  },
  onLoad(options = {}) {
    if (options.mode !== 'create' || options.source !== 'medication') return
    this.returnCreatedDrug = true
    this.prepareCreateForm()
    const eventChannel = typeof this.getOpenerEventChannel === 'function' && this.getOpenerEventChannel()
    if (eventChannel && typeof eventChannel.on === 'function') {
      eventChannel.on('drugCreateDraft', (draft) => this.prepareCreateForm(draft))
    }
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
  prepareCreateForm(draft = {}) {
    const category = currentCategories.some((item) => item.value === draft.category) ? draft.category : 'other'
    this.setData({
      editing: true,
      isEdit: false,
      formCategories: currentCategories,
      form: {
        ...emptyForm(),
        generic_name: String(draft.generic_name || ''),
        trade_name: String(draft.trade_name || ''),
        dosage_text: String(draft.dosage_text || ''),
        category,
      },
      formCategoryIndex: formCategoryIndexOf(category),
    })
  },
  openCreate() {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    this.prepareCreateForm()
  },
  openEdit(event) {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    const row = this.data.list.find((item) => item.drug_id === event.currentTarget.dataset.id)
    if (!row) return
    if (row.is_system) { toast('系统药库只读，请新增家庭药物'); return }
    const formCategories = formCategoriesFor(row.category)
    this.setData({
      editing: true,
      isEdit: true,
      formCategories,
      form: { ...row },
      formCategoryIndex: formCategoryIndexOf(row.category, formCategories),
    })
  },
  cancel() {
    if (this.returnCreatedDrug) { wx.navigateBack(); return }
    this.setData({ editing: false })
  },
  onInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }) },
  onFormCategory(event) {
    const formCategoryIndex = Number(event.detail.value)
    const category = this.data.formCategories[formCategoryIndex]
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
      const drug = this.data.isEdit
        ? await api.drugs.update(f.drug_id, f)
        : await api.drugs.create(config.useLocalApi ? f : { ...f, drug_id: undefined })
      toast(this.data.isEdit ? '修改成功' : '新增成功', 'success')
      if (this.returnCreatedDrug && !this.data.isEdit) {
        const eventChannel = typeof this.getOpenerEventChannel === 'function' && this.getOpenerEventChannel()
        if (eventChannel && typeof eventChannel.emit === 'function') eventChannel.emit('drugCreated', drug)
        wx.navigateBack()
        return
      }
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
