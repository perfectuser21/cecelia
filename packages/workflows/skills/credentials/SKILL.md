---
name: credentials
description: |
  凭据管理 Skill。当涉及 API Token、Secret、Key 等敏感信息时自动触发。
  - 存储新凭据：必须先存 1Password CS Vault，再运行 sync-credentials.sh 同步到本地
  - 查找凭据：从 ~/.credentials/ 读取（本地缓存），或用 op read 直接从 1Password 读
  全局适用，所有项目共享。
---

# 凭据管理 (Credentials Management)

## 核心原则：1Password 是唯一真实源（SSOT）

```
1Password CS Vault（唯一真实源）
    ↓ bash ~/bin/sync-credentials.sh
~/.credentials/（本地缓存，可随时从 1P 重建）
    ↓
脚本 / 工具
```

**~/.credentials/ 只有两类文件有存在意义：**
1. `1password.env` — Service Account Token（引导用，必须本地）
2. 其他 — 从 1P 同步的缓存，可删可重建

---

## 触发条件

当用户提到以下关键词时，自动应用此 skill：

- **存储场景**：用户给你 token、API key、secret、凭据、密钥
- **查找场景**：需要调用某个 API、找某个 token、访问某个服务

---

## 存储新凭据（必须先存 1Password）

### Step 1：存入 1Password

```bash
node -e "
const fs = require('fs');
const {execFileSync} = require('child_process');
const env = {};
fs.readFileSync(process.env.HOME + '/.credentials/1password.env', 'utf8')
  .split('\n').forEach(l => { const m = l.match(/^([^=]+)=(.+)/); if (m) env[m[1]]=m[2]; });
const opEnv = {...process.env, ...env};
execFileSync('op', [
  'item', 'create', '--vault', 'CS', '--category', 'API Credential',
  '--title', 'SERVICE_NAME', '--tags', 'TAG1,TAG2', 'FIELD_NAME=VALUE'
], {env: opEnv, stdio: 'inherit'});
"
```

常用 tags：`ai` / `infra` / `trading` / `social` / `dev` / `tool`

### Step 2：同步到本地缓存

```bash
bash ~/bin/sync-credentials.sh
```

---

## 查找凭据

### 从本地缓存读取（推荐）

```bash
source ~/.credentials/{service}.env
echo $SERVICE_API_KEY  # 验证
```

### 直接从 1Password 读取（未同步或需要最新值时）

```bash
node -e "
const fs = require('fs');
const {execFileSync} = require('child_process');
const env = {};
fs.readFileSync(process.env.HOME + '/.credentials/1password.env', 'utf8')
  .split('\n').forEach(l => { const m = l.match(/^([^=]+)=(.+)/); if (m) env[m[1]]=m[2]; });
const val = execFileSync('op', ['read', 'op://CS/ITEM_TITLE/FIELD_NAME'],
  {env: {...process.env, ...env}}).toString().trim();
console.log(val);
"
```

---

## 跨机器部署

所有机器只需两步：
1. 复制 `~/.credentials/1password.env`（只有这一个文件需要手动传）
2. 运行 `bash ~/bin/sync-credentials.sh` — 自动从 1P 拉取所有凭据

---

## 安全规则

1. **权限**：目录 700，文件 600
2. **不入 git**：此目录不在任何项目中，不会被 git 追踪
3. **新凭据流程**：**1P 先写 → sync 到本地**，绝不反向
4. **发现本地有但 1P 没有** → 立即补到 1P，再 sync

---

## 已有凭据（CS Vault）

| Tag | 条目 | 本地文件 |
|-----|------|----------|
| `ai` | Anthropic Claude API, OpenAI-claudecode2026, MiniMax API | anthropic.json, openai.env, minimax.env |
| `infra` | Cloudflare, Tailscale, Tencent Cloud, DigitalOcean, 各服务器 | cloudflare.env, tailscale.env 等 |
| `infra,database` | Cecelia PostgreSQL | database.env |
| `infra,deploy` | Cecelia Deploy Token | cecelia-deploy.env |
| `dev` | GitHub Tokens | github.env |
| `social` | Feishu 飞书, WeChat 微信公众号 | feishu.env, wechat.env |
| `tool` | Notion, N8N, ToAPI, ToAPIs | notion.env, n8n.env 等 |
| `trading` | IBKR, Polygon, Trading PostgreSQL | trading-ibkr.env, polygon.env 等 |

**最后更新**: 2026-03-18
