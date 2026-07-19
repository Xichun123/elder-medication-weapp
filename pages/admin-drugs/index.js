const api = require('../../utils/api')
const { unwrap, toast, showError, confirm, makeId } = require('../../utils/helpers')
const categories = [{ value:'',label:'全部分类'},{value:'antibiotic',label:'抗生素'},{value:'antihypertensive',label:'降压药'},{value:'hypoglycemic',label:'降糖药'},{value:'antiplatelet',label:'抗血小板'},{value:'other',label:'其他'}]
const emptyForm = () => ({ drug_id: makeId('D'), generic_name:'', trade_name:'', aliases:'', category:'other', ingredient:'', dosage_text:'', contraindication_note:'', interaction_note:'' })

Page({
  data: { list: [], loading:false, keyword:'', categories, categoryIndex:0, editing:false, isEdit:false, saving:false, form:emptyForm(), formCategoryIndex:5 },
  onShow() { if (!this.data.editing) this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() { this.setData({ loading:true }); try { const category = categories[this.data.categoryIndex].value; this.setData({ list:unwrap(await api.drugs.list({ keyword:this.data.keyword, category })) }) } catch(error) { showError(error) } finally { this.setData({ loading:false }) } },
  onKeyword(event) { this.setData({ keyword:event.detail.value }) }, onSearch() { this.load() },
  onCategory(event) { this.setData({ categoryIndex:Number(event.detail.value) }, () => this.load()) },
  openCreate() { this.setData({ editing:true, isEdit:false, form:emptyForm(), formCategoryIndex:5 }) },
  openEdit(event) { const row=this.data.list.find((item)=>item.drug_id===event.currentTarget.dataset.id); if(row) this.setData({ editing:true,isEdit:true,form:{...row},formCategoryIndex:Math.max(1,categories.findIndex((x)=>x.value===row.category)) }) },
  cancel() { this.setData({ editing:false }) },
  onInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]:event.detail.value }) },
  onFormCategory(event) { const formCategoryIndex=Number(event.detail.value); this.setData({ formCategoryIndex,'form.category':categories[formCategoryIndex].value }) },
  async save() { const f=this.data.form; if(!f.drug_id||!f.generic_name||!f.category){toast('请完整填写必填项');return} this.setData({saving:true}); try { if(this.data.isEdit) await api.drugs.update(f.drug_id,f); else await api.drugs.create(f); toast(this.data.isEdit?'修改成功':'新增成功','success'); this.setData({editing:false}); await this.load() } catch(error){showError(error)} finally{this.setData({saving:false})} },
  async remove(event) { const id=event.currentTarget.dataset.id; if(!(await confirm('若已有用药记录引用，本地数据引擎会拒绝删除。确定继续？','删除药物')))return; try{await api.drugs.remove(id);toast('已删除','success');await this.load()}catch(error){showError(error)} },
})
