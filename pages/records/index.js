const api = require('../../utils/api')
const store = require('../../utils/store')
const { unwrap, toast, showError, confirm } = require('../../utils/helpers')

Page({
  data: { loading: false, list: [], filteredList: [], elderOptions: [{ elder_id: '', name: '全部长辈' }], elderIndex: 0, keyword: '', editing: false, saving: false, form: {}, frequencyOptions: ['每日1次', '每日2次', '每日3次'] },
  onShow() { if (!this.data.editing) this.loadOptions().then(() => this.load()) },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async loadOptions() { try { const overview = await api.families.overview(store.getFamilyId()); this.setData({ elderOptions: [{ elder_id: '', name: '全部长辈' }, ...(overview.elders || [])] }) } catch (error) { showError(error) } },
  async load() {
    this.setData({ loading: true })
    try {
      const elder = this.data.elderOptions[this.data.elderIndex]
      const params = elder && elder.elder_id ? { elder: elder.elder_id } : { family: store.getFamilyId() }
      const list = unwrap(await api.records.list(params))
      this.setData({ list }); this.applyFilter()
    } catch (error) { showError(error) }
    finally { this.setData({ loading: false }) }
  },
  onElderChange(event) { this.setData({ elderIndex: Number(event.detail.value) }, () => this.load()) },
  onKeyword(event) { this.setData({ keyword: event.detail.value }, () => this.applyFilter()) },
  applyFilter() { const keyword = this.data.keyword.trim().toLowerCase(); this.setData({ filteredList: keyword ? this.data.list.filter((item) => String(item.drug_name).toLowerCase().includes(keyword)) : this.data.list }) },
  add() { wx.setStorageSync('elder_medication.medication_elder_id', ''); wx.switchTab({ url: '/pages/medication/index' }) },
  edit(event) { const row = this.data.list.find((item) => item.record_id === event.currentTarget.dataset.id); if (row) this.setData({ editing: true, form: { ...row } }) },
  cancel() { this.setData({ editing: false }) },
  onInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }) },
  chooseFrequency(event) { this.setData({ 'form.frequency': event.currentTarget.dataset.value }) },
  onStartDate(event) { this.setData({ 'form.start_date': event.detail.value }) },
  onEndDate(event) { this.setData({ 'form.end_date': event.detail.value }) },
  clearEndDate() { this.setData({ 'form.end_date': '' }) },
  async save() { const f = this.data.form; if (!f.dose || !f.start_date) { toast('请完整填写剂量和日期'); return } this.setData({ saving: true }); try { await api.records.update(f.record_id, { dose: f.dose, frequency: f.frequency, start_date: f.start_date, end_date: f.end_date || null }); toast('修改成功', 'success'); this.setData({ editing: false }); await this.load() } catch (error) { showError(error) } finally { this.setData({ saving: false }) } },
  async remove(event) { const id = event.currentTarget.dataset.id; if (!(await confirm('相关提醒规则将一并删除，确定继续？', '删除用药记录'))) return; try { await api.records.remove(id); toast('已删除', 'success'); await this.load() } catch (error) { showError(error) } },
})
