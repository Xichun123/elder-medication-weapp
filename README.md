# 药灵通

面向家庭的**多人分端**用药协作微信小程序：家属与老人各自使用自己的设备，共享同一家庭空间中的长辈档案、用药记录、服药提醒与禁忌信息。

- 产品与技术架构：[`docs/architecture-multiuser.md`](docs/architecture-multiuser.md)
- 自建后端（VPS）：[`server/README.md`](server/README.md)

> 当前仓库处于迁移期：默认启用远程模式，已接通微信登录、家庭空间、成员邀请和长辈建档；用药、提醒与禁忌仍在迁移。需要本地演示时可在 `utils/config.js` 临时启用 `USE_LOCAL_API`。

## 目标能力

- 微信登录与家庭空间（创建 / 邀请码加入）
- 角色：创建人、可录入家属、只读家属、老人
- 长辈档案、用药录入、提醒（含老人端确认已服）
- 药物主数据与禁忌看板
- 适老化大字、高对比、振动提醒
- 自有 VPS 部署 API + HTTPS 反代

## 小程序

1. 打开微信开发者工具，导入本仓库根目录。
2. `project.config.json` 使用项目 AppID；协作成员需开发者或体验成员权限。
3. 微信后台将 `https://api.0721online.net` 配为 request 合法域名。
4. 编译运行后自动执行微信登录，可创建家庭或用邀请码加入。

当前远程模式入口：

- 家属：家庭空间、成员邀请、长辈建档
- 老人：绑定本人档案后进入独立适老页面
- 用药/提醒/禁忌：下一期接入远程 API

本地演示模式仍保留，但仅用于离线开发，不与云端数据同步。

## 后端 API（VPS）

```bash
cd server
cp .env.example .env   # 配置 JWT、微信密钥等
npm install
npm run dev            # 默认 http://127.0.0.1:8787
```

生产 API 已部署到 `https://api.0721online.net`。微信后台仍需将该 HTTPS 地址加入 request 合法域名，并满足 ICP 备案要求；细节见 `server/README.md`。

## 协作开发

分支、提交、评审约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 目录结构

```text
.
├── app.js / app.json / app.wxss   # 小程序入口与全局配置
├── pages/                         # 小程序页面
├── utils/                         # 小程序工具（迁移期含本地 db）
├── server/                        # 自建 API（Node + SQLite）
├── docs/                          # 架构与设计文档
└── project.config.json
```
