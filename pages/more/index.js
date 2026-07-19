const api = require('../../utils/api')
const store = require('../../utils/store')
const { toast, showError, confirm } = require('../../utils/helpers')

Page({
  data: { stats: { elders: 0, families: 0, relations: 0, drugs: 0, records: 0, reminders: 0, contraindications: 0 }, resetting: false },
  onShow() { this.loadStats() },
  navigate(event) { wx.navigateTo({ url: event.currentTarget.dataset.path }) },
  async loadStats() {
    try {
      const data = await api.local.export()
      this.setData({
        stats: {
          elders: data.elders.length,
          families: data.families.length,
          relations: data.relations.length,
          drugs: data.drugs.length,
          records: data.records.length,
          reminders: data.reminders.length,
          contraindications: data.contraindications.length,
        },
      })
    } catch (error) { showError(error) }
  },
  async exportData() {
    try {
      const data = await api.local.export()
      wx.setClipboardData({ data: JSON.stringify(data, null, 2), success: () => toast('台账 JSON 已复制', 'success'), fail: showError })
    } catch (error) { showError(error) }
  },
  async resetData() {
    if (!(await confirm('这会删除当前设备上的所有修改并恢复 35 条演示数据，确定继续？', '恢复初始数据'))) return
    this.setData({ resetting: true })
    try {
      await api.local.reset()
      store.setFamilyId('F01')
      toast('已恢复初始数据', 'success')
      await this.loadStats()
    } catch (error) { showError(error) }
    finally { this.setData({ resetting: false }) }
  },
})
