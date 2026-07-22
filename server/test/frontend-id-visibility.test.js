import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const pagesRoot = path.resolve(import.meta.dirname, '../../pages')

function listTemplates(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listTemplates(fullPath)
    return entry.isFile() && entry.name.endsWith('.wxml') ? [fullPath] : []
  })
}

test('前端文本不展示内部数据 ID', () => {
  for (const templatePath of listTemplates(pagesRoot)) {
    const source = fs.readFileSync(templatePath, 'utf8')
    const visibleText = source.replace(/<[^>]*>/g, '')
    assert.doesNotMatch(visibleText, /\b(?:药物|关系|记录|提醒|长辈|家庭)ID\b/, templatePath)
    assert.doesNotMatch(visibleText, /\{\{[^}]*\b(?:drug|relation|record|rule|elder|family)_id\b[^}]*\}\}/, templatePath)
  }
})
