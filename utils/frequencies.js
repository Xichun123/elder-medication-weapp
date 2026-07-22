const frequencyOptions = Array.from({ length: 12 }, (_, index) => `每日${index + 1}次`)

const frequencyTimes = {
  每日1次: ['早8:00'],
  每日2次: ['早8:00', '晚20:00'],
  每日3次: ['早8:00', '午12:00', '晚20:00'],
  每日4次: ['早8:00', '午12:00', '下午16:00', '晚20:00'],
  每日5次: ['早7:00', '上午10:00', '午13:00', '下午17:00', '晚21:00'],
  每日6次: ['早7:00', '上午10:00', '午13:00', '下午16:00', '晚19:00', '晚22:00'],
}

function formatTime(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60)
  const minute = totalMinutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function getReminderTimes(frequency) {
  if (frequencyTimes[frequency]) return frequencyTimes[frequency]
  const match = String(frequency || '').match(/^每日(\d+)次$/)
  const count = Math.max(1, Math.min(Number(match && match[1]) || 1, 12))
  if (count === 1) return frequencyTimes['每日1次']
  const start = 7 * 60
  const end = 22 * 60
  const interval = (end - start) / (count - 1)
  return Array.from({ length: count }, (_, index) => formatTime(Math.round(start + interval * index)))
}

module.exports = { frequencyOptions, frequencyTimes, getReminderTimes }
