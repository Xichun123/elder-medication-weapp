const api = require('../../utils/api')
const aiPrivacy = require('../../utils/ai-privacy')
const config = require('../../utils/config')
const session = require('../../utils/session')
const store = require('../../utils/store')
const voice = require('../../utils/voice')
const { unwrap, toast, showError } = require('../../utils/helpers')

Page({
  data: {
    loading: false, allList: [], list: [], elders: [], elderIndex: 0, elderOptions: [{ elder_id: '', name: '全部长辈' }],
    status: '', counts: { pending: 0, taken: 0, skipped: 0, abnormal: 0 },
    canEdit: true, canTake: true,
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ active: 3 })
    }
    if (!config.useLocalApi && !session.getHome()) {
      wx.reLaunch({ url: '/pages/launch/index' })
      return
    }
    const role = store.currentRole()
    this.setData({
      canEdit: store.canEdit(),
      // 老人确认已服走 cloud-elder；家属端 owner/edit 可代为标记，view 只读。
      canTake: store.canEdit() || role === 'elder',
    })
    this.load()
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    this.setData({ loading: true })
    try {
      const familyId = store.getFamilyId()
      const [data, overview] = await Promise.all([api.reminders.list({ family: familyId }), api.families.overview(familyId)])
      const allList = unwrap(data)
      const elderOptions = [{ elder_id: '', name: '全部长辈' }, ...(overview.elders || [])]
      const counts = ['pending', 'taken', 'skipped', 'abnormal'].reduce((result, key) => ({ ...result, [key]: allList.filter((item) => item.status === key).length }), {})
      this.setData({ allList, elderOptions, elders: overview.elders || [], counts })
      this.applyFilters()
    } catch (error) { showError(error) }
    finally { this.setData({ loading: false }) }
  },
  applyFilters() {
    const elder = this.data.elderOptions[this.data.elderIndex]
    const list = this.data.allList.filter((item) => (!this.data.status || item.status === this.data.status) && (!elder || !elder.elder_id || item.elder === elder.elder_id))
    this.setData({ list })
  },
  toggleStatus(event) { const value = event.currentTarget.dataset.value; this.setData({ status: this.data.status === value ? '' : value }, () => this.applyFilters()) },
  onElderChange(event) { this.setData({ elderIndex: Number(event.detail.value) }, () => this.applyFilters()) },
  async take(event) {
    if (!this.data.canTake) { toast('当前角色仅可查看'); return }
    await this.action('take', event.currentTarget.dataset.id, '已标记为已服')
  },
  async skip(event) {
    if (!this.data.canTake) { toast('当前角色仅可查看'); return }
    await this.action('skip', event.currentTarget.dataset.id, '已标记为跳过')
  },
  async action(name, id, message) { try { await api.reminders[name](id); toast(message, 'success'); await this.load() } catch (error) { showError(error) } },
  async regenerate(event) {
    if (!store.canEdit()) { toast('当前角色仅可查看'); return }
    try {
      const consented = await aiPrivacy.ensureConsent()
      const reminder = await api.reminders.regenerateVoice(event.currentTarget.dataset.id, {
        preferAi: consented,
        aiConsent: consented,
      })
      toast(reminder.voice_generation_source === 'ai' ? 'AI 温情文案已更新' : '本地温情文案已更新', 'success')
      await this.load()
    } catch (error) { showError(error) }
  },
  play(event) {
    const row = this.data.allList.find((item) => item.rule_id === event.currentTarget.dataset.id)
    if (!row) return
    const elder = (this.data.elders || []).find((item) => item.elder_id === row.elder)
    voice.speak(row.voice_text, { tone: elder && elder.voice_tone }).catch(showError)
  },
})
