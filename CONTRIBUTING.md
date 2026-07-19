# 协作开发约定

本项目由三人共同维护，采用 GitHub Pull Request 协作。

## 分支规则

- `main` 始终保持可编译、可演示，不直接提交日常功能开发。
- 每项工作从最新的 `main` 创建独立分支，完成后通过 Pull Request 合并。
- 一条分支只处理一个主题，避免混入无关重构或格式化。

分支命名：

- `feat/<name>`：新功能
- `fix/<name>`：缺陷修复
- `docs/<name>`：文档修改
- `refactor/<name>`：不改变功能的重构
- `chore/<name>`：配置和工具调整

名称使用简短的小写英文和连字符，例如 `feat/daily-reminders`。

## 开发流程

```bash
git switch main
git pull --rebase origin main
git switch -c feat/your-feature
```

开发完成后提交并推送分支，在 GitHub 创建 Pull Request。`@Xichun123` 是项目负责人和默认代码负责人：两位队友提交的 Pull Request 由项目负责人审核并合并；项目负责人提交的 Pull Request 必须由至少一位队友审核，任何人都不能自审。作者处理完评审意见后再合并。推荐使用 **Squash and merge**，保持 `main` 历史简洁。

## 提交信息

使用以下格式：

```text
<type>: <简短说明>
```

常用类型：`feat`、`fix`、`docs`、`refactor`、`test`、`style`、`chore`。

示例：

```text
feat: 增加每日服药提醒实例
fix: 修改用药频次时同步提醒规则
docs: 更新本地数据说明
```

## Pull Request 要求

- 描述改动目的和主要实现。
- 说明已执行的验证步骤及结果。
- 涉及页面时附模拟器截图或录屏。
- 涉及数据结构时说明兼容方案。
- 不提交调试代码、真实个人信息、密钥或个人配置。
- 避免一个 Pull Request 同时包含大规模格式化和业务修改。

## 小程序项目约定

- 公共 AppID 和公共编译配置保存在 `project.config.json`。
- `project.private.config.json` 是个人配置，不得提交。
- 所有成员需由小程序管理员授予开发者权限。
- 页面统一通过 `utils/api.js` 访问数据，不直接操作数据库集合。
- 数据结构变更必须同步考虑：种子数据、存储版本、迁移逻辑、数据字典和已有本地数据。
- 禁忌、提醒等医疗相关逻辑需保留明确的数据来源和适用边界，不能将演示逻辑描述为医疗结论。

## 合并前检查

1. 在微信开发者工具中编译成功，无控制台错误。
2. 手动验证本次改动涉及的主要流程和异常流程。
3. 检查新增、编辑、删除后的本地数据一致性。
4. 必要时执行“恢复初始数据”，验证首次启动场景。
5. 确认未提交 `project.private.config.json`、密钥或无关文件。
6. 功能或使用方式改变时同步更新项目文档。

## GitHub 仓库设置

首次推送后，建议为 `main` 开启分支保护：

- 合并前必须创建 Pull Request；
- 至少需要 1 位成员批准；
- 合并前必须解决所有评审对话；
- 禁止强制推送和删除 `main`。

`.github/CODEOWNERS` 会自动请求 `@Xichun123` 审核仓库内的改动。暂不启用“必须由 Code Owner 批准”，否则项目负责人自己的 Pull Request 可能因无法自审而被阻塞；负责人自己的改动由队友按上述规则审核。
