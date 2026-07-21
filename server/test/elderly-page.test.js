import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const pagePath = path.resolve(import.meta.dirname, '../../pages/elderly/index.js')
const pageSource = fs.readFileSync(pagePath, 'utf8')
const pageTemplate = fs.readFileSync(path.resolve(import.meta.dirname, '../../pages/elderly/index.wxml'), 'utf8')
const historyUtil = fs.readFileSync(path.resolve(import.meta.dirname, '../../utils/ai-chat-history.js'), 'utf8')
const aiChatSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../pages/ai-chat/index.js'), 'utf8')
const aiChatTemplate = fs.readFileSync(path.resolve(import.meta.dirname, '../../pages/ai-chat/index.wxml'), 'utf8')

test('elder page supports mark taken', () => {
  assert.match(pageSource, /async takeById\(id\)/)
  assert.match(pageSource, /api\.reminders\.take/)
  assert.match(pageTemplate, /catchtap="takeCurrent"/)
  assert.match(pageTemplate, /catchtap="takeReminder"/)
  assert.match(pageTemplate, /确认已服/)
  assert.match(pageTemplate, /status-badge/)
  assert.match(pageTemplate, /reminder-card/)
})

test('AI chat page persists local history', () => {
  assert.match(aiChatSource, /ai-chat-history/)
  assert.match(aiChatSource, /persistMessages/)
  assert.match(aiChatSource, /restoreMessages/)
  assert.match(aiChatSource, /clearHistory/)
  assert.match(aiChatTemplate, /bindtap="clearHistory"/)
  assert.match(historyUtil, /setStorageSync/)
  assert.match(historyUtil, /getStorageSync/)
})

test('AI history util isolates by home/role/elder', () => {
  const storage = new Map()
  const module = { exports: {} }
  vm.runInNewContext(historyUtil, {
    module,
    exports: module.exports,
    console,
    wx: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: (key) => storage.delete(key),
    },
  }, { filename: 'ai-chat-history.js' })

  const chatHistory = module.exports
  const optsA = { mode: 'elder', elderId: 'E1', homeId: 'H1' }
  const optsB = { mode: 'caregiver', elderId: 'E1', homeId: 'H1' }
  chatHistory.save(optsA, [{ role: 'user', content: '我刚吃了药' }, { role: 'assistant', content: '请核对' }])
  chatHistory.save(optsB, [{ role: 'user', content: '查漏服' }])
  const elderHistory = chatHistory.load(optsA)
  const caregiverHistory = chatHistory.load(optsB)
  assert.equal(elderHistory.length, 2)
  assert.equal(elderHistory[0].content, '我刚吃了药')
  assert.equal(caregiverHistory.length, 1)
  assert.equal(caregiverHistory[0].content, '查漏服')
})
