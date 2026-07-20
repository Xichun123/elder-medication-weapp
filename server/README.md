# 药灵通 API（VPS）

Node.js 22.5+ + Hono + SQLite（内置 `node:sqlite`）。对应架构说明见 [`../docs/architecture-multiuser.md`](../docs/architecture-multiuser.md)。

## 本地开发

```bash
cd server
cp .env.example .env
# 编辑 .env：JWT_SECRET、ALLOW_DEV_LOGIN=1（本地联调）
# 如需拍药盒识别，再配置 GITHUB_MODELS_TOKEN（仅需 models:read）
npm install
npm run dev
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

开发登录（无需微信）：

```bash
curl -s http://127.0.0.1:8787/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"devOpenid":"dev-owner-1","nickname":"测试家属"}'
```

## VPS 部署要点

1. 安装 Node 22.5+，部署目录为 `/opt/yao-ling-tong/server`。
2. 配置 `.env`：`JWT_SECRET`、`WX_APP_ID`、`WX_APP_SECRET`，**生产关闭** `ALLOW_DEV_LOGIN`。
3. 保留服务器上的 `.env` 与 `data/`；升级时只替换 `src/`、`package*.json` 等程序文件，禁止直接删除整个部署目录。
4. `npm ci --omit=dev && systemctl restart yao-ling-tong-api`。
5. Caddy 反代到 `127.0.0.1:8787`，开启 HTTPS。
6. 微信公众平台将 `https://api.0721online.net` 配为 request 与 uploadFile 合法域名（不要显式写 `:443`）；域名需按官方要求完成 ICP 备案。

### systemd 示例

```ini
[Unit]
Description=YaoLingTong API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/yao-ling-tong/server
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
```

### Caddy 示例

```caddy
api.0721online.net {
  encode zstd gzip
  request_body {
    max_size 6MB
  }
  reverse_proxy 127.0.0.1:8787
}
```

## 已实现 API

- `GET /health`
- `POST /auth/wx-login`（微信 code / 开发 devOpenid）
- `GET /me`
- `GET/POST /homes`、`POST /homes/join`、`GET /homes/:homeId`
- `GET /homes/:homeId/members`；owner：`PATCH/DELETE .../members/:memberId`
- `POST /homes/:homeId/invites`；owner：`GET/DELETE .../invites`
- `GET/POST /homes/:homeId/elders`；`PATCH/DELETE .../elders/:elderId`
- `GET /homes/:homeId/overview`
- `POST /homes/:homeId/recognitions/medication`（`multipart/form-data`，字段名 `image`，最大 5MB）
- 药物 / 用药记录 / 提醒 / 禁忌 / 长辈 dashboard（均带 `home_id` 范围与角色校验）

权限摘要：`owner` 全量 + 成员管理；`caregiver_edit` 可写业务；`caregiver_view` 只读；`elder` 仅本人档案，可确认已服。
创建用药记录时自动生成提醒；仅修改频次会重建提醒，只改剂量不重置状态。提醒状态按 `Asia/Shanghai` 自然日计算，跨天自动恢复待服；今日列表只包含处于 `start_date/end_date` 有效期内的用药。

### AI 拍药盒识别

识别默认调用 GitHub Models 的 `openai/gpt-4.1-mini`，适合比赛原型和低频试用。令牌只放在服务端 `.env`，不可提交仓库或下发到小程序。服务端不落盘用户上传的图片；模型结果只作为录入草稿，前端要求家属结合药盒与医生处方核对后再保存。应用层按“用户 + 家庭”限制为 10 秒一次、每小时 10 次；该限流保存在进程内，正式多实例部署应迁移到 Redis。GitHub Models 免费额度和限流可能调整，正式运营应换成有 SLA 的模型服务并补充隐私告知。

## 验证

```bash
npm test
npm audit --omit=dev
curl https://api.0721online.net/health
```

`/health` 中 `authConfigured: true` 才表示微信 AppID 与 AppSecret 均已配置，`recognitionConfigured: true` 表示识别令牌已配置；健康检查通过不等于对应上游服务一定可用。
