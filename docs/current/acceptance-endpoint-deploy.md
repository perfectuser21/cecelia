# Acceptance 公网端点部署（刀 1 配套）

## Token 生成与存放

1. `openssl rand -base64 32` 生成 token
2. 1Password CS Vault 建条目 `Acceptance API`（credential 字段）
3. 双写 `~/.credentials/acceptance.env`（chmod 600）：`ACCEPTANCE_API_TOKEN=<token>`
4. Brain 生产容器 env 注入 `ACCEPTANCE_API_TOKEN`（cecelia-deploy compose env）——未注入则 5223 不启动（fail-closed）

## cloudflared 暴露

listener 默认只绑 127.0.0.1，必须经本机 cloudflared 进入。现有 tunnel 的 ingress 追加：

```yaml
- hostname: brain-acceptance.zenjoymedia.media
  service: http://localhost:5223
```

Cloudflare DNS 加对应 CNAME 后 `cloudflared tunnel ingress validate` + 重启 tunnel。

⚠️ `ACCEPTANCE_PUBLIC_HOST` 逃生阀仅限仍有反代兜底的场景使用；设为 0.0.0.0 会使直连客户端可伪造 X-Forwarded-For 分桶绕限流。

## Worker 侧

```bash
cd <worker 项目> && echo "BRAIN_ACCEPTANCE_TOKEN=<token>" >> .env && ntn workers env push --yes
```

## 验证

```bash
curl -s https://brain-acceptance.zenjoymedia.media/acceptance/pending -H "Authorization: Bearer $ACCEPTANCE_API_TOKEN"
# 无 token 应 401；带 token 应返回 {"runs":[...]}
```
