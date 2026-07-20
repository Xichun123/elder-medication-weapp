# 药灵通 API（VPS）

Node.js 22.5+ + Hono + SQLite（内置 `node:sqlite`）。对应架构说明见 [`../docs/architecture-multiuser.md`](../docs/architecture-multiuser.md)。

## 本地开发

```bash
cd server
cp .env.example .env
# 编辑 .env：JWT_SECRET、ALLOW_DEV_LOGIN=1（本地联调）
# 如需拍药盒识别，再配置 RECOGNITION_API_URL / KEY / MODEL
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
6. 微信公众平台将 `https://api.0721online.net` 分别配置为 request、uploadFile 与 downloadFile 合法域名（不要显式写 `:443`）；包装图签名地址由 `<image>` 下载，遗漏 downloadFile 会导致正式版无法显示。域名需按官方要求完成 ICP 备案。

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
- `GET/POST/DELETE /homes/:homeId/drugs/:drugId/package-image`（主包装图查询、保存/替换、删除）
- `GET /package-images/:imageId?...`（15 分钟有效的签名图片地址）
- 药物 / 用药记录 / 提醒 / 禁忌 / 长辈 dashboard（均带 `home_id` 范围与角色校验）

权限摘要：`owner` 全量 + 成员管理；`caregiver_edit` 可写业务；`caregiver_view` 只读；`elder` 仅本人档案，可确认已服。
创建用药记录时自动生成提醒；仅修改频次会重建提醒，只改剂量不重置状态。提醒状态按 `Asia/Shanghai` 自然日计算，跨天自动恢复待服；今日列表只包含处于 `start_date/end_date` 有效期内的用药。

### AI 拍药盒识别

服务端使用标准 OpenAI Chat Completions 多模态请求，可通过以下通用变量切换兼容供应商：

| 变量 | 说明 | 当前 GitHub Models 示例 |
|------|------|--------------------------|
| `RECOGNITION_API_URL` | 完整的 Chat Completions URL | `https://models.github.ai/inference/chat/completions` |
| `RECOGNITION_API_KEY` | 服务端 API 密钥 | 仅含 `models:read` 权限的 GitHub PAT |
| `RECOGNITION_MODEL` | 多模态模型名称 | `openai/gpt-4.1-mini` |
| `RECOGNITION_TIMEOUT_MS` | 上游请求超时 | `30000` |

旧的 `GITHUB_MODELS_TOKEN`、`GITHUB_MODELS_MODEL` 和 `GITHUB_MODELS_ENDPOINT` 不再读取，部署升级时需同步迁移 `.env`。API 密钥只能放在服务端，不可提交仓库或下发到小程序。

当前供应商继续使用 GitHub Models，适合比赛原型和低频试用。AI 识别默认不持久化图片，但图片仍会由第三方模型服务处理，其留存和使用规则以供应商条款为准。模型结果只作为录入草稿，前端要求家属结合药盒与医生处方明确确认后才能保存。

家属还可以主动将当前照片保存为所选药品在当前家庭中的主包装图。服务端使用 `sharp` 重新编码为 JPEG、移除 EXIF 并限制最长边 1600 像素，再存入 SQLite 的 `drug_package_images` 表；同一家庭、同一药品仅保留一张主图。现有数据库在服务启动时自动建表，无需手工执行迁移。家庭或家庭药品删除时通过外键级联清理图片。老人端只能通过本人提醒取得短时签名图片地址，没有图片时仍正常使用提醒功能。

识别接口按“用户 + 家庭”限制为 10 秒一次、每小时 10 次；该限流保存在进程内，正式多实例部署应迁移到 Redis。

小程序上线前的隐私声明、用户告知和真机检查见 [`../docs/privacy-release.md`](../docs/privacy-release.md)。开发工具中可临时关闭域名校验用于联调，但发布前必须恢复校验，并在真机分别验证识别图片上传和签名包装图下载。

## 验证

```bash
npm test
npm audit --omit=dev
curl https://api.0721online.net/health
```

`/health` 中 `authConfigured: true` 才表示微信 AppID 与 AppSecret 均已配置；只有识别 URL、API Key 和模型均已配置时 `recognitionConfigured` 才为 `true`。健康检查通过不等于对应上游服务一定可用。
