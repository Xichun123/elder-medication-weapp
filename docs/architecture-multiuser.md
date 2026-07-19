# 药灵通 · 多人分端架构

## 产品定位

药灵通是**家庭用药协作小程序**：多名家属与老人各自使用自己的设备，共享同一家庭空间中的长辈档案、用药记录、服药提醒与禁忌信息。

- **不是**单机本地台账、多人共用一台手机
- **真相来源**是自建后端 API + 数据库
- 小程序端负责登录、按角色展示与操作；权限在服务端强制校验

## 端与角色

| 角色 | 代码值 | 端体验 | 权限摘要 |
|------|--------|--------|----------|
| 家庭创建人 | `owner` | 家属工作台 | 全部业务 + 成员邀请/移除 |
| 可录入家属 | `caregiver_edit` | 家属工作台 | 长辈/用药/提醒/禁忌的读写 |
| 只读家属 | `caregiver_view` | 家属工作台 | 只读 |
| 老人 | `elder` | 老人端（大字提醒） | 查看本人待服；可确认「已服」 |

默认决策：

1. 老人**可以**在自己的端点「已服」（写回云端，家属端刷新可见）。
2. 一期登录仅用**微信小程序登录**（`openid`），手机号绑定二期再做。
3. 后端部署在**自有 VPS**，经 HTTPS 反代对外提供 API。

## 核心流程

### 家属

```text
微信登录 → 创建家庭 / 邀请码加入 → 选择当前家庭
  → 维护长辈与用药 → 自动生成提醒 → 确认已服/跳过 → 查看禁忌
  → 生成邀请（家属或老人）
```

### 老人

```text
微信登录 或 扫家属绑定码
  → 进入老人端（非家属 Tab）
  → 今日待服、播报、确认已服
```

## 领域模型

```text
User ──< Membership >── Home
                           │
                     ElderProfile
                           │
              MedicationRecord ── Drug
                           │
                     ReminderRule
                           
Drug ── Contraindication ── (Drug | 文本)
Home ── Invite
```

- 业务数据均带 `home_id`，接口强制家庭范围。
- `role=elder` 的成员通过 `elder_profile_id` 绑定本人档案；接口只返回该档案数据。
- 药物主数据一期按家庭隔离；系统级药库可作为 `home_id IS NULL` 的只读种子。

## 后端（VPS）

| 项 | 选型 |
|----|------|
| 运行时 | Node.js 22.5+ |
| 框架 | Hono |
| 数据库 | SQLite（Node 内置 `node:sqlite`，需 Node 22+），单机家庭场景足够；可迁移 Postgres |
| 鉴权 | 微信 `code2session` + JWT |
| 进程 | systemd 或 pm2 |
| 反代 | Caddy（推荐）或 Nginx，终止 TLS |
| 代码位置 | 仓库 `server/` |

环境变量见 `server/.env.example`。

### 主要 API（一期）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/auth/wx-login` | `{ code }` → `{ token, user }`；开发环境可传 `devOpenid` |
| GET | `/me` | 当前用户 |
| GET | `/homes` | 我加入的家庭 |
| POST | `/homes` | 创建家庭（创建人为 owner） |
| POST | `/homes/join` | `{ code }` 加入 |
| POST | `/homes/:homeId/invites` | 创建邀请 |
| GET/POST | `/homes/:homeId/elders` | 长辈档案 |
| PATCH/DELETE | `/homes/:homeId/elders/:elderId` | 更新/删除长辈 |
| GET | `/homes/:homeId/overview` | 家庭概览（长辈/用药/待服/风险计数） |
| GET/POST/PATCH/DELETE | `/homes/:homeId/drugs` | 药物（含系统药库只读 + 家庭药库） |
| GET/POST/PATCH/DELETE | `/homes/:homeId/records` | 用药记录；创建/改频次同步提醒 |
| GET + take/skip/regenerate-voice | `/homes/:homeId/reminders` | 提醒；老人可确认本人已服 |
| GET | `/homes/:homeId/elders/:elderId/dashboard` | 长辈禁忌看板 |
| GET/POST/PATCH/DELETE | `/homes/:homeId/contraindications` | 禁忌 |
| GET/DELETE | `/homes/:homeId/invites` | 邀请列表/撤销（owner） |
| PATCH/DELETE | `/homes/:homeId/members/:memberId` | 改角色/移除（owner） |

## 小程序改造原则

1. `utils/api.js` 按 `USE_LOCAL_API` 切换 `api-local.js` / `api-remote.js`；两套 adapter 对页面暴露相同业务接口。
2. 启动门闸：无 token → 登录页；有 token → 拉家庭列表 → 按角色进首页。
3. `role=elder`：不展示家属 Tab，直接老人端。
4. 去掉「无登录切换家属」；改为真实用户 + 当前家庭。
5. `project.config.json` 的 `packOptions.ignore` 排除 `server/`、`docs/` 等非小程序目录。

## 分期

| 期 | 目标 |
|----|------|
| 0 | 架构文档、仓库结构、VPS 目录与域名规划 |
| 1 | ✅ 已完成：登录、家庭、邀请、角色中间件、小程序门闸与长辈建档 |
| 2 | ✅ 已完成：用药/提醒/禁忌上云，家属工作台远程适配 |
| 3 | ✅ 已完成：老人端今日提醒与确认已服 |
| 4 | 订阅消息、缓存与冲突、体验增强 |

## 本地数据迁移

- 旧版 `wx.storage` **不再**作为多端真相。
- 保留导出 JSON；新版可提供「导入到当前家庭」（可选工具）。
- 演示：服务端种子家庭，或仅在非生产环境开启 `ALLOW_DEV_LOGIN=1` 后传 `devOpenid` 一键体验。

## 安全要点

- `WX_APP_SECRET` 和微信返回的 `session_key` 只留在服务器，不进小程序、不进 git。
- `wx.login` 的 code 有效期 5 分钟且只能用一次，小程序获取后立即发给后端换取自定义登录态。
- 全站 HTTPS；在微信后台把 `https://api.0721online.net` 配为 request 合法域名（不显式写 `:443`）。
- 合法域名按官方要求需完成 ICP 备案；域名后台配置完成后，应关闭开发工具的“跳过域名校验”再做真机测试。
- 所有写操作校验 `membership.role`；成员邀请仅允许 `owner`。
- `openid`、`unionid` 不返回给客户端，JWT 当前 7 天有效，后续可增加 refresh 与撤销机制。

## 微信官方文档依据

- 登录流程：`weapp-docs/references/docs/framework/open-ability/login.md`
- `wx.login`：`weapp-docs/references/docs/api/open-api/login/wx.login.md`
- 网络与合法域名：`weapp-docs/references/docs/framework/ability/network.md`
- `wx.request`：`weapp-docs/references/docs/api/network/request/wx.request.md`
- `app.json networkTimeout`：`weapp-docs/references/docs/reference/configuration/app.md`
