const api = require('../../utils/api')
const config = require('../../utils/config')
const session = require('../../utils/session')
const { showError, toast } = require('../../utils/helpers')

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

Page({
  data: {
    loading: false,
    markingAll: false,
    alerts: [],
    unreadCount: 0,
  },

  onShow() {
    if (!config.useLocalApi && !session.getHome()) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const result = await api.alerts.list()
      const alerts = (result.alerts || []).map((item) => ({
        ...item,
        createdAtLabel: formatTime(item.createdAt),
        severityLabel: item.severity === 'urgent' ? '紧急' : '健康反馈',
      }))
      const unreadCount = Number(result.unreadCount || 0)
      this.setData({ alerts, unreadCount })
      this.syncBadge(unreadCount)
    } catch (error) {
      if (error.statusCode === 401) {
        wx.reLaunch({ url: '/pages/launch/index' })
        return
      }
      showError(error)
    } finally {
      this.setData({ loading: false })
    }
  },

  async markRead(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    try {
      await api.alerts.markRead(id)
      const alerts = this.data.alerts.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item)
      const unreadCount = alerts.filter((item) => !item.readAt).length
      this.setData({ alerts, unreadCount })
      this.syncBadge(unreadCount)
    } catch (error) {
      showError(error)
    }
  },

  async markAllRead() {
    const unread = this.data.alerts.filter((item) => !item.readAt)
    if (!unread.length || this.data.markingAll) return
    this.setData({ markingAll: true })
    try {
      await Promise.all(unread.map((item) => api.alerts.markRead(item.id)))
      const readAt = new Date().toISOString()
      this.setData({ alerts: this.data.alerts.map((item) => ({ ...item, readAt: item.readAt || readAt })), unreadCount: 0 })
      this.syncBadge(0)
      toast('已全部标记为已读', 'success')
    } catch (error) {
      showError(error)
      await this.load()
    } finally {
      this.setData({ markingAll: false })
    }
  },

  syncBadge(count) {
    if (count > 0 && wx.setTabBarBadge) {
      wx.setTabBarBadge({ index: 0, text: String(Math.min(count, 99)), fail: () => {} })
    } else if (wx.removeTabBarBadge) {
      wx.removeTabBarBadge({ index: 0, fail: () => {} })
    }
  },
})
