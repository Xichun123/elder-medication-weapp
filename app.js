const store = require('./utils/store')
const database = require('./utils/database')

App({
  globalData: {
    currentFamilyId: 'F01',
  },

  onLaunch() {
    // 首次启动写入内置种子数据，之后全部 CRUD 均持久化到 wx.storage。
    database.load()
    this.globalData.currentFamilyId = store.getFamilyId()
  },
})
