Component({
  data: {
    active: 0,
    badge: 0,
    list: [
      { pagePath: '/pages/home/index', text: '首页', icon: '/assets/icons/tab/home.png', iconOn: '/assets/icons/tab/home-on.png' },
      { pagePath: '/pages/elders/index', text: '长辈', icon: '/assets/icons/tab/elder.png', iconOn: '/assets/icons/tab/elder-on.png' },
      { pagePath: '/pages/medication/index', text: '录入', center: true },
      { pagePath: '/pages/reminders/index', text: '提醒', icon: '/assets/icons/tab/bell.png', iconOn: '/assets/icons/tab/bell-on.png' },
      { pagePath: '/pages/more/index', text: '我的', icon: '/assets/icons/tab/user.png', iconOn: '/assets/icons/tab/user-on.png' },
    ],
  },
  methods: {
    switchTab(event) {
      const { index, path } = event.currentTarget.dataset
      if (index === this.data.active) return
      wx.switchTab({ url: path })
    },
  },
})
