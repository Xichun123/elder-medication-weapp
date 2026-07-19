const config = require('./utils/config')
const session = require('./utils/session')

App({
  globalData: {
    currentUser: null,
    currentHome: null,
  },

  onLaunch() {
    this.globalData.currentUser = session.getUser()
    this.globalData.currentHome = session.getHome()

    // 本地数据库仅保留给显式开启的演示模式，远程模式不再初始化种子数据。
    if (config.useLocalApi) {
      const store = require('./utils/store')
      const database = require('./utils/database')
      database.load()
      this.globalData.currentFamilyId = store.getFamilyId()
    }
  },
})
