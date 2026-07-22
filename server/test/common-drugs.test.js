import assert from 'node:assert/strict'
import test from 'node:test'
import commonDrugCatalog from '../../utils/common-drugs.js'
import frequencyConfig from '../../utils/frequencies.js'

const { commonDrugs } = commonDrugCatalog
const { getReminderTimes, isValidFrequency } = frequencyConfig

test('常见药物目录至少包含三百种且通用名唯一', () => {
  assert.ok(commonDrugs.length >= 300)
  assert.equal(new Set(commonDrugs.map((drug) => drug.generic_name)).size, commonDrugs.length)
  for (const name of ['阿司匹林', '阿莫西林', '氨氯地平', '二甲双胍', '奥美拉唑', '左甲状腺素钠']) {
    assert.ok(commonDrugs.some((drug) => drug.generic_name === name), `缺少常见药物：${name}`)
  }
})

test('每日一至十二次都能生成对应数量的提醒', () => {
  for (let count = 1; count <= 12; count += 1) {
    assert.equal(getReminderTimes(`每日${count}次`).length, count)
  }
})

test('高频次提醒使用中文时段文案', () => {
  for (const time of getReminderTimes('每日8次')) {
    assert.match(time, /^(凌晨|早|上午|午|下午|晚)\d{1,2}:\d{2}$/)
  }
  assert.deepEqual(getReminderTimes('每日4次'), ['早8:00', '午12:00', '下午16:00', '晚20:00'])
})

test('仅接受每日一至十二次作为合法频次', () => {
  for (let count = 1; count <= 12; count += 1) assert.equal(isValidFrequency(`每日${count}次`), true)
  for (const value of ['', '每日0次', '每日13次', '每日99次', '每天2次', 'foo']) {
    assert.equal(isValidFrequency(value), false, `不应接受频次：${value}`)
  }
})
