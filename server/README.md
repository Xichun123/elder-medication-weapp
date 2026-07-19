# 药灵通 API（VPS）

Node.js 22.5+ + Hono + SQLite（内置 `node:sqlite`）。对应架构说明见 [`../docs/architecture-multiuser.md`](../docs/architecture-multiuser.md)。

## 本地开发

```bash
cd server
cp .env.example .env
# 编辑 .env：JWT_SECRET、ALLOW_DEV_LOGIN=1（本地联调）
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
6. 微信公众平台将 `https://api.0721online.net` 配为 request 合法域名（不要显式写 `:443`）；域名需按官方要求完成 ICP 备案。

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
  reverse_proxy 127.0.0.1:8787
}
```

## 一期已实现

- `GET /health`
- `POST /auth/wx-login`（微信 code / 开发 devOpenid）
- `GET /me`
- `GET/POST /homes`
- `POST /homes/join`
- `GET /homes/:homeId`
- `GET /homes/:homeId/members`
- `POST /homes/:homeId/invites`（仅 owner）
- `GET/POST /homes/:homeId/elders`

小程序登录门闸、家庭选择、成员邀请和长辈建档已接入远程 API；用药、提醒与禁忌仍为后续迭代。

## 验证

```bash
npm test
npm audit --omit=dev
curl https://api.0721online.net/health
```

`/health` 中 `authConfigured: true` 才表示微信 AppID 与 AppSecret 均已配置；健康检查通过不等于微信登录已经可用。
