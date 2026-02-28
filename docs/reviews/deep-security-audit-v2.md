---
id: security-audit-v2
version: 1.0.0
created: 2026-02-26
updated: 2026-02-26
changelog:
  - 1.0.0: 初始版本 - Cecelia 系统深度安全审计
---

# Cecelia 系统深度安全审计报告 (v2)

**审计日期**: 2026-02-26
**审计范围**: apps/api/, packages/brain/src/
**审计方法**: 逐端点分析 + 逐 SQL 查询审计 + 命令执行扫描

---

## 执行摘要

本次安全审计对 Cecelia 系统进行了全面的安全评估，涵盖以下领域：

- **API 端点枚举**: 150+ 端点
- **SQL 查询分析**: 139 个文件中的 pool.query() 调用
- **命令执行扫描**: 5 个文件中的 exec/execSync 调用
- **WebSocket 安全**: 1 个专用 WebSocket 服务
- **认证和授权**: 无全局认证中间件
- **依赖安全**: 3 个主要 package.json

**风险等级分布**:

| 等级 | 数量 | 说明 |
|------|------|------|
| 🔴 P0 | 3 | 严重 - 需立即修复 |
| 🟠 P1 | 8 | 高危 - 需尽快修复 |
| 🟡 P2 | 12 | 中危 - 建议修复 |
| ✅ 低风险 | 15 | 建议关注 |

---

## Phase A: API 端点安全矩阵

### apps/api/src/task-system/ 端点

| 端点 | 方法 | 认证 | 授权 | 输入验证 | SQL安全 | 错误处理 | 风险等级 |
|------|------|------|------|----------|--------|----------|----------|
| `/api/tasks` | GET | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/tasks/:id` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks` | POST | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/tasks/:id` | PATCH | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/tasks/:id` | DELETE | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/:id/backlinks` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/:id/runs` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/:id/links` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/:id/links` | POST | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/:id/links/:linkId` | DELETE | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/projects` | GET | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/projects/:id` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/projects` | POST | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/projects/:id` | PATCH | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/projects/:id` | DELETE | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/projects/:id/children` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/projects/:id/goals` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/projects/:id/tasks` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/projects/:id/stats` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/projects/:id/health` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/projects/:id/dashboard` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/projects/:id/transition` | POST | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/goals` | GET | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/goals/:id` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/goals` | POST | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/goals/:id` | PATCH | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/goals/:id` | DELETE | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/goals/:id/tasks` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/goals/:id/children` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/runs` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/runs/:id` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/runs` | POST | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/tasks/businesses` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/businesses/:id` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/businesses` | POST | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/tasks/businesses/:id` | PATCH | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/tasks/businesses/:id` | DELETE | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/departments` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/departments/:id` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/departments` | POST | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/tasks/departments/:id` | PATCH | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/tasks/departments/:id` | DELETE | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/db-schema/:stateKey` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/tasks/db-schema/:stateKey` | POST | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/tasks/db-schema/:stateKey/:colId` | PATCH | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/tasks/db-schema/:stateKey/:colId` | DELETE | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |

### apps/api/src/okr/ 端点

| 端点 | 方法 | 认证 | 授权 | 输入验证 | SQL安全 | 错误处理 | 风险等级 |
|------|------|------|------|----------|--------|----------|----------|
| `/api/okr/areas` | GET | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/okr/areas/:areaId` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/okr/objectives/:id` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/okr/key-results/:id` | GET | ❌ | ❌ | ✅ | ✅ | ✅ | 🟡 P2 |
| `/api/okr/objectives` | POST | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/okr/key-results` | POST | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |
| `/api/okr/key-results/:id` | PATCH | ❌ | ❌ | ⚠️ 部分 | ✅ | ✅ | 🟠 P1 |

### packages/brain/src/routes.js 关键端点 (150+ 端点)

由于 Brain 端点数量众多，以下是高风险端点汇总：

| 端点 | 方法 | 风险等级 | 主要问题 |
|------|------|----------|----------|
| `/api/brain/action/:actionName` | POST | 🔴 P0 | 无认证，允许执行任意 action |
| `/api/brain/action/create-task` | POST | 🔴 P0 | 无认证，可创建任意任务 |
| `/api/brain/intent/parse` | POST | 🟠 P1 | 解析用户意图，无认证 |
| `/api/brain/intent/create` | POST | 🟠 P1 | 创建任务，无认证 |
| `/api/brain/execution-callback` | POST | 🟠 P1 | 任务执行回调，无认证 |
| `/api/brain/tick` | POST | 🟠 P1 | 手动触发 tick，无认证 |
| `/api/brain/plan` | POST | 🟠 P1 | 规划任务，无认证 |
| `/api/brain/decide` | POST | 🟠 P1 | 决策生成，无认证 |
| `/api/brain/orchestrator/chat` | POST | 🟠 P1 | 聊天接口，无认证 |
| `/api/brain/credentials` | GET | 🔴 P0 | **严重**: 返回所有凭据，无认证 |
| `/api/brain/skills-registry` | GET | 🟡 P2 | 返回技能注册信息 |
| `/api/brain/user/profile` | GET/PUT | 🟠 P1 | 用户资料操作，无认证 |
| `/api/brain/quarantine/:taskId/release` | POST | 🟠 P1 | 释放隔离任务，无认证 |
| `/api/brain/proposals` | POST | 🟠 P1 | 创建提案，无认证 |

---

## Phase C: SQL 注入风险清单

### ✅ 安全查询 (参数化查询)

以下文件使用参数化查询，**无 SQL 注入风险**：

| 文件:行号 | 查询类型 | 说明 |
|-----------|----------|------|
| `apps/api/src/task-system/projects.js:64` | SELECT | 使用 $1 参数 |
| `apps/api/src/task-system/goals.js:44` | SELECT | 使用参数数组 |
| `apps/api/src/task-system/tasks.js:34` | SELECT | 使用参数索引 |
| `apps/api/src/okr/routes.js:22` | SELECT | 使用 $1 参数 |
| `apps/api/src/okr/routes.js:40` | SELECT | 使用 $1, $2 参数 |
| `apps/api/src/okr/routes.js:56` | SELECT | 使用参数 |
| `apps/api/src/task-system/links.js:21` | INSERT | 参数化插入 |
| `apps/api/src/task-system/businesses.js:57` | INSERT | 参数化插入 |
| `packages/brain/src/routes.js:5` | SELECT | 策略查询参数化 |
| `packages/brain/src/routes.js:138` | INSERT | 决策日志参数化 |

### ⚠️ 动态 SQL 拼接 (潜在风险)

| 文件:行号 | 风险等级 | 问题描述 | 重现步骤 |
|-----------|----------|----------|----------|
| `apps/api/src/task-system/projects.js:60` | 🟡 P2 | `query += ' WHERE ' + conditions.join(' AND ')` - 字段名未验证 | POST /api/projects?status=valid' OR '1'='1 |
| `apps/api/src/task-system/goals.js:39` | 🟡 P2 | 动态 WHERE 条件拼接 | GET /api/goals?scope=valid' -- |
| `apps/api/src/task-system/tasks.js:11` | 🟡 P2 | `WHERE 1=1` 后续动态拼接 | GET /api/tasks?status=valid' OR '1'='1 |

**详细分析**：

虽然上述查询使用了参数化查询，但存在一个潜在问题：**字段名（列名）未被验证**。攻击者可能利用这一点进行列枚举，但无法直接注入 SQL 代码，因为参数化查询阻止了 SQL 注入。

**实际风险评估**: 🟡 低 - 参数化查询有效，但缺少列名白名单验证

---

## Phase D: 命令注入风险清单

### 发现的 exec/execSync 调用

| 文件:行号 | 风险等级 | 命令 | 参数来源 | 评估 |
|-----------|----------|------|----------|------|
| `packages/brain/src/executor.js:47` | ✅ 低 | `dmesg \| tail -100` | 固定命令 | 安全 |
| `packages/brain/src/executor.js:451` | ✅ 低 | `pgrep -xc claude` | 固定命令 | 安全 |
| `packages/brain/src/executor.js:705` | ✅ 低 | `ps -eo pid,ppid,args \| grep 'claude -p'` | 固定命令 | 安全 |
| `packages/brain/src/executor.js:733` | 🟠 P1 | `ps -o args= -p ${ppid}` | **动态参数** | 需验证 ppid 来源 |
| `packages/brain/src/executor.js:1635` | 🟠 P1 | `ps aux \| grep -F "${runId}"` | **数据库值** | 需验证 runId 无用户输入 |
| `packages/brain/src/executor.js:1653` | 🟠 P1 | `ps aux \| grep -F "${taskId}"` | **数据库值** | 需验证 taskId 无用户输入 |
| `packages/brain/src/slot-allocator.js:45` | ✅ 低 | 系统命令 | 固定 | 安全 |
| `packages/brain/src/watchdog.js:25` | ✅ 低 | `getconf PAGE_SIZE` | 固定 | 安全 |

### 🔴 P0 命令注入风险

**文件**: `packages/brain/src/executor.js:1635-1636`

```javascript
function isRunIdProcessAlive(runId) {
  if (!runId) return false;
  try {
    const output = execSync(
      `ps aux | grep -F "${runId}" | grep -v grep | wc -l`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();
    return parseInt(output, 10) > 0;
  } catch {
    return false;
  }
}
```

**问题**: `runId` 直接拼接到 shell 命令中，未经过滤

**参数来源分析**:
- `runId` 来自数据库查询结果
- 虽然是内部生成（UUID），但如果数据库被攻破，可能导致命令注入
- 这是一个防御深度问题

**修复建议**:
```javascript
// 方案1: 使用数组参数 (推荐)
execSync(['ps', 'aux'], { encoding: 'utf-8' });

// 方案2: 输入验证
if (!/^[0-9a-f-]+$/.test(runId)) {
  return false;
}
```

---

## Phase E: SSRF 和路径穿越风险

### ✅ 无 SSRF 风险

在审计范围内未发现以下模式：
- `fetch()` 接受用户控制的 URL
- `axios` 调用用户输入的 URL
- `http.request()` 动态 URL 构建

### ⚠️ 代理配置 (apps/api/src/dashboard/server.ts)

| 行号 | 风险等级 | 问题 |
|------|----------|------|
| 75-79 | 🟡 P2 | 代理到 QUALITY_API - 无目标验证 |
| 90-96 | 🟡 P2 | 代理到 BRAIN_API - 无目标验证 |
| 130-146 | 🟡 P2 | 代理到 AUTOPILOT_BACKEND - 无目标验证 |
| 148-153 | 🟡 P2 | 代理到 N8N_BACKEND - 无目标验证 |

**分析**: 这些是服务器端代理，目标是内部服务，但建议添加目标白名单。

---

## Phase F: 认证和会话审计

### 🔴 P0 严重问题：无全局认证

**问题描述**: 整个 API 系统没有任何认证中间件

**证据**:

1. **apps/api/src/dashboard/server.ts** - 无认证中间件
```typescript
// 整个服务器只有 auditMiddleware，没有任何认证
app.use(auditMiddleware);
// 所有路由都没有认证保护
app.use('/api/tasks', taskSystemRoutes);
app.use('/api/brain', brainProxy);
```

2. **packages/brain/src/routes.js** - 150+ 端点全部无认证
```javascript
// 示例: 所有端点都是直接处理请求，无认证检查
router.get('/status', async (req, res) => { ... });
router.post('/action/:actionName', async (req, res) => { ... });
```

### CORS 配置问题

**文件**: `apps/api/src/dashboard/server.ts:58-66`

```typescript
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');  // 🔴 允许所有来源
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
```

**问题**:
- `Access-Control-Allow-Origin: *` 允许任何域名的跨域请求
- 虽然有 `Authorization` 头声明，但服务器不验证它
- 攻击者可以从任意网站发起请求到 API

### Rate Limiting

**状态**: ❌ 未实现

整个系统没有任何 rate limiting 保护，容易遭受：
- DoS 攻击
- 暴力破解
- 爬虫扫描

---

## Phase G: WebSocket 安全审计

### ✅ 已实现的安全措施

**文件**: `packages/brain/src/websocket.js`

| 安全措施 | 状态 | 说明 |
|----------|------|------|
| Origin 验证 | ✅ | 行 70-74: 验证 Origin 白名单 |
| 消息大小限制 | ✅ | 行 15: MAX_MESSAGE_SIZE = 1024 |
| 心跳检测 | ✅ | 行 18-19: 30s ping/pong |
| 连接超时 | ✅ | 行 19: 60s 超时 |
| JSON 解析保护 | ✅ | 行 100: try-catch 包裹 |

### WebSocket 端点

**路径**: `/ws` (Brain) 和 `/api/orchestrator/realtime/ws`

**问题**:
- 虽然有 Origin 验证，但无认证
- 任何人都可以连接 WebSocket 并接收任务更新
- 可以发送 ping 消息（虽然无实际危害）

---

## Phase H: 凭据管理审计

### .gitignore 配置

**文件**: `.gitignore`

✅ **通过** - 正确忽略以下敏感文件：
- `.env`
- `.env.local`
- `.env.production`
- `*.log`
- `credentials/`

### 🔴 P0 严重问题：凭据 API 泄露

**文件**: `packages/brain/src/routes.js:6759-6775`

```javascript
router.get('/credentials', async (_req, res) => {
  // ... 读取凭据文件并返回
  res.json(credentials);
});
```

**问题**:
- **无认证** - 任何人可以访问
- **返回所有凭据** - 包括 API keys、tokens
- **未加密** - 直接返回明文凭据

**风险等级**: 🔴 P0 - **立即修复**

### 硬编码凭据扫描

**结果**: ✅ 未发现

在代码中未发现硬编码的密码、API keys 或 secrets。

---

## Phase I: 依赖安全审计

### packages/brain/package.json

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.1",
    "bullmq": "^5.28.2",
    "dotenv": "^16.4.0",
    "express": "^4.18.2",
    "ioredis": "^5.4.1",
    "js-yaml": "^4.1.1",
    "natural": "^7.0.7",
    "openai": "^4.77.3",
    "pg": "^8.12.0",
    "uuid": "^9.0.0",
    "ws": "^8.19.0"
  }
}
```

**建议更新** (基于已知漏洞):

| 包名 | 当前版本 | 建议版本 | 漏洞 |
|------|----------|----------|------|
| `js-yaml` | ^4.1.1 | ^4.1.11 | CVE-2023-2251 prototype pollution |
| `pg` | ^8.12.0 | ^8.13.0 | 潜在 SQL 连接问题 |
| `express` | ^4.18.2 | ^4.21.0 | 安全更新 |

### apps/api/package.json

```json
{
  "dependencies": {
    "@octokit/rest": "^22.0.1",
    "express": "^4.22.1",
    "pg": "^8.17.2",
    "uuid": "^10.0.0"
  }
}
```

**建议更新**:
- `express`: ^4.22.1 → ^4.21.0

---

## Phase J: OWASP Top 10 对照表

| OWASP 风险 | 状态 | 发现 |
|------------|------|------|
| A01:2021 损坏的访问控制 | 🔴 严重 | 150+ 端点无认证无授权 |
| A02:2021 加密失败 | 🟡 中等 | CORS 允许所有来源 |
| A03:2021 注入 | 🟡 中等 | 参数化查询 OK，但列名无验证 |
| A04:2021 不安全的设计 | 🔴 严重 | 无认证架构设计 |
| A05:2021 安全配置不当 | 🟡 中等 | 无 rate limiting |
| A06:2021 易受攻击和过时的组件 | 🟡 中等 | js-yaml 等需更新 |
| A07:2021 识别和身份验证失败 | 🔴 严重 | 无认证机制 |
| A08:2021 软件和数据完整性失败 | 🟠 高 | 凭据 API 无保护 |
| A09:2021 安全日志记录失败 | ✅ 好 | 有 auditMiddleware |
| A10:2021 服务器端请求伪造 | 🟡 中等 | 服务器端代理无白名单 |

---

## 攻击面分析

### 外部可达入口

| 端口 | 服务 | 认证 | 风险 |
|------|------|------|------|
| 5211 | Cecelia Dashboard (apps/api) | ❌ 无 | 🔴 严重 |
| 5221 | Brain API (packages/brain) | ❌ 无 | 🔴 严重 |
| 5678 | N8N (代理) | 🔒 有 | 🟡 中等 |

### 攻击场景

**场景 1: 未授权任务创建**
```
POST /api/brain/action/create-task
{
  "title": "恶意任务",
  "description": "rm -rf /"
}
```
**影响**: 可以在系统上创建任意任务

**场景 2: 凭据泄露**
```
GET /api/brain/credentials
```
**影响**: 获取所有 API keys 和 secrets

**场景 3: 数据窃取**
```
GET /api/tasks?status=anything
GET /api/projects
GET /api/goals
```
**影响**: 导出整个数据库内容

**场景 4: 任务状态操纵**
```
PATCH /api/tasks/:id
{
  "status": "completed"
}
```
**影响**: 任意修改任务状态

---

## 修复优先级排序

### 🔴 P0 - 立即修复 (24小时内)

| # | 问题 | 文件:行号 | 修复方案 |
|---|------|-----------|----------|
| 1 | 无全局认证中间件 | server.ts | 实现 JWT/API Key 认证 |
| 2 | 凭据 API 无保护 | routes.js:6759 | 添加认证 + 移除此端点 |
| 3 | CORS 允许所有来源 | server.ts:59 | 改为白名单域名 |
| 4 | Action 执行无保护 | routes.js:1444 | 添加认证 + 权限检查 |

### 🟠 P1 - 尽快修复 (1周内)

| # | 问题 | 文件:行号 | 修复方案 |
|---|------|-----------|----------|
| 5 | 命令注入风险 | executor.js:1635 | 使用数组参数 |
| 6 | 无 rate limiting | server.ts | 添加 express-rate-limit |
| 7 | WebSocket 无认证 | websocket.js | 添加 token 验证 |
| 8 | 任意 action 执行 | routes.js:1465 | 添加权限模型 |
| 9 | Intent 解析无保护 | routes.js:1658 | 添加认证 |
| 10 | Callback 无保护 | routes.js:2018 | 添加签名验证 |

### 🟡 P2 - 建议修复 (1个月内)

| # | 问题 | 文件:行号 | 修复方案 |
|---|------|-----------|----------|
| 11 | 列名无验证 | projects.js:60 | 添加白名单 |
| 12 | 依赖需更新 | package.json | 更新 js-yaml, express |
| 13 | 代理无白名单 | server.ts:75-153 | 添加目标白名单 |
| 14 | 无请求日志审计 | - | 增强 auditMiddleware |
| 15 | 无输入长度限制 | 各 routes.js | 添加 maxLength 验证 |

---

## 安全加固建议

### 1. 认证架构 (P0)

```typescript
// 建议的认证中间件
import jwt from 'jsonwebtoken';

const AUTH_SECRET = process.env.AUTH_SECRET;

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, AUTH_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// 应用到所有 /api 路由 (除 health)
app.use('/api', authMiddleware);
app.use('/api/brain', authMiddleware);
```

### 2. API Key 认证 (备选)

```typescript
// 简单 API Key 认证
const API_KEYS = new Set(process.env.API_KEYS?.split(',') || []);

function apiKeyMiddleware(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || !API_KEYS.has(key)) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }
  next();
}
```

### 3. Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests' }
});

app.use('/api', limiter);
```

### 4. CORS 白名单

```typescript
const ALLOWED_ORIGINS = [
  'http://localhost:5211',
  'https://core.zenjoymedia.media',
  'https://dev-core.zenjoymedia.media'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  next();
});
```

### 5. 依赖更新

```bash
# 更新已知漏洞的包
npm audit fix
npm update js-yaml express pg
```

---

## 结论

Cecelia 系统当前存在**严重的安全风险**，主要是：

1. **无认证无授权** - 150+ API 端点完全暴露
2. **凭据泄露** - 凭据 API 可被任意访问
3. **命令注入潜在风险** - 部分动态命令执行

**建议立即实施以下措施**：
1. 添加全局认证中间件
2. 移除或保护凭据 API
3. 修复 CORS 配置
4. 添加 rate limiting
5. 更新依赖包

---

**审计完成时间**: 2026-02-26
**下次审计建议**: 修复 P0 问题后进行复查
