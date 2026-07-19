const api = require('../../utils/api')
const { unwrap, toast, showError, confirm, makeId } = require('../../utils/helpers')

const emptyForm = () => ({
  elder_id: makeId('E'), name: '', gender: 'female', age: '70', relationship: '', allergy_note: '无', voice_tone: 'female_warm',
})

Page({
  data: { list: [], filteredList: [], keyword: '', loading: false, editing: false, isEdit: false, saving: false, form: emptyForm() },
  onShow() { if (!this.data.editing) this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },

  async load() {
    this.setData({ loading: true })
    try {
      const list = unwrap(await api.elders.list({ keyword: this.data.keyword }))
      this.setData({ list, filteredList: list })
    } catch (error) { showError(error) }
    finally { this.setData({ loading: false }) }
  },
  onSearchInput(event) { this.setData({ keyword: event.detail.value }) },
  onSearch() { this.load() },
  openCreate() { this.setData({ editing: true, isEdit: false, form: emptyForm() }) },
  openEdit(event) {
    const row = this.data.list.find((item) => item.elder_id === event.currentTarget.dataset.id)
    if (row) this.setData({ editing: true, isEdit: true, form: { ...row, age: String(row.age) } })
  },
  closeForm() { this.setData({ editing: false }) },
  onInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }) },
  choose(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.currentTarget.dataset.value }) },
  async save() {
    const form = { ...this.data.form, age: Number(this.data.form.age) }
    if (!form.elder_id || !form.name || !form.relationship || !form.age) { toast('请完整填写必填项'); return }
    this.setData({ saving: true })
    try {
      if (this.data.isEdit) await api.elders.update(form.elder_id, form)
      else await api.elders.create(form)
      toast(this.data.isEdit ? '修改成功' : '新增成功', 'success')
      this.setData({ editing: false })
      await this.load()
    } catch (error) { showError(error) }
    finally { this.setData({ saving: false }) }
  },
  async remove(event) {
    const id = event.currentTarget.dataset.id
    if (!(await confirm('相关用药记录与提醒将一并删除，确定继续？', '删除老人'))) return
    try { await api.elders.remove(id); toast('已删除', 'success'); await this.load() } catch (error) { showError(error) }
  },
  openDetail(event) { wx.navigateTo({ url: `/pages/elder-detail/index?id=${event.currentTarget.dataset.id}` }) },
})
