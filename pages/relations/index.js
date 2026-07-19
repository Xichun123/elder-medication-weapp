const api = require('../../utils/api')
const { unwrap, toast, showError, confirm, makeId } = require('../../utils/helpers')

const createForm = () => ({ relation_id: makeId('FE'), family: '', elder: '', relation_type: 'child', permission_level: 'editable' })

Page({
  data: { list: [], families: [], elders: [], loading: false, editing: false, isEdit: false, saving: false, form: createForm(), familyIndex: 0, elderIndex: 0, roleOptions: [{ value: 'child', label: '子女' }, { value: 'spouse', label: '配偶' }, { value: 'caregiver', label: '护工' }] },
  onShow() { if (!this.data.editing) this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    this.setData({ loading: true })
    try { const [relations, families, elders] = await Promise.all([api.relations.list(), api.families.list(), api.elders.list()]); this.setData({ list: unwrap(relations), families: unwrap(families), elders: unwrap(elders) }) }
    catch (error) { showError(error) }
    finally { this.setData({ loading: false }) }
  },
  openCreate() { const form = createForm(); const families = this.data.families; const elders = this.data.elders; if (families[0]) form.family = families[0].family_id; if (elders[0]) form.elder = elders[0].elder_id; this.setData({ editing: true, isEdit: false, form, familyIndex: 0, elderIndex: 0 }) },
  openEdit(event) { const row = this.data.list.find((item) => item.relation_id === event.currentTarget.dataset.id); if (!row) return; this.setData({ editing: true, isEdit: true, form: { ...row }, familyIndex: Math.max(0, this.data.families.findIndex((x) => x.family_id === row.family)), elderIndex: Math.max(0, this.data.elders.findIndex((x) => x.elder_id === row.elder)) }) },
  cancel() { this.setData({ editing: false }) },
  onInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }) },
  onFamilyChange(event) { const familyIndex = Number(event.detail.value); this.setData({ familyIndex, 'form.family': this.data.families[familyIndex].family_id }) },
  onElderChange(event) { const elderIndex = Number(event.detail.value); this.setData({ elderIndex, 'form.elder': this.data.elders[elderIndex].elder_id }) },
  choose(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.currentTarget.dataset.value }) },
  async save() { const f = this.data.form; if (!f.relation_id || !f.family || !f.elder) { toast('请完整填写必填项'); return } this.setData({ saving: true }); try { if (this.data.isEdit) await api.relations.update(f.relation_id, { relation_type: f.relation_type, permission_level: f.permission_level }); else await api.relations.create(f); toast(this.data.isEdit ? '修改成功' : '新增成功', 'success'); this.setData({ editing: false }); await this.load() } catch (error) { showError(error) } finally { this.setData({ saving: false }) } },
  async remove(event) { const id = event.currentTarget.dataset.id; if (!(await confirm('确定解除该家属与老人的关联？', '解除关联'))) return; try { await api.relations.remove(id); toast('已解除关联', 'success'); await this.load() } catch (error) { showError(error) } },
})
