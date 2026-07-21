import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const appConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'))

test('所有自定义 TabBar 页面为底栏预留滚动空间', () => {
  for (const item of appConfig.tabBar.list) {
    const templatePath = path.join(projectRoot, `${item.pagePath}.wxml`)
    const template = fs.readFileSync(templatePath, 'utf8')
    const root = template.match(/^\s*<view\s+class="([^"]+)"/)
    assert.ok(root, `${item.pagePath} 缺少可识别的根容器`)
    assert.match(root[1], /(?:^|\s)with-tabbar(?:\s|$)/, `${item.pagePath} 未预留自定义 TabBar 空间`)
  }
})
