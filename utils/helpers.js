function unwrap(data) {
  if (Array.isArray(data)) return data
  return (data && data.results) || []
}

function toast(title, icon = 'none') {
  wx.showToast({ title: String(title || ''), icon, duration: 2200 })
}

function showError(error) {
  console.error(error)
  toast((error && error.message) || '操作失败')
}

function confirm(content, title = '请确认') {
  return new Promise((resolve) => {
    wx.showModal({ title, content, success: (res) => resolve(Boolean(res.confirm)), fail: () => resolve(false) })
  })
}

function today() {
  const d = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function makeId(prefix) {
  return `${prefix}${String(Date.now()).slice(-6)}`
}

function pickerValue(items, index, field) {
  return items[Number(index)] && items[Number(index)][field]
}

module.exports = { unwrap, toast, showError, confirm, today, makeId, pickerValue }
