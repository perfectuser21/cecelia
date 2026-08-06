# Sprint PRD — Notion 通道活性哨兵
**Task ID**: d64b5720-95bb-4f13-8de8-47d84f72ce43
**Sprint Dir**: sprints/08062214-relay-d64b5720
**GP Anchor**: factory/f6_inbox_homing
**Journey ID**: 824ee0f5-aeb9-4972-909d-37dd17b75617
**Target Environment**: local_api
**Base Repo**: perfectuser21/cecelia
**Date**: 2026-08-06

---

## 背景与动机

F6 收件箱归位（factory/f6_inbox_homing）Journey 中，Notion 通道承载三路核心数据流：

| Job | 文件 | 功能 |
|-----|------|------|
| notion-capture-ingest | `notion-capture-ingest.js` | 每5min轮询 Notion Inbox，拉新条目写入 captures |
| notion-product-push | `notion-inbox-push.js` | 把排序官产物推送到 Notion Inbox |
| notion-verdict-ingest | `notion-verdict-ingest.js` | 从 Notion Inbox 消费主理人裁决 |

**现状问题**：凭据（NOTION_INBOX_TOKEN + NOTION_INBOX_DB_ID）未配置时静默跳过（`return { skipped: true, reason: 'not_configured' }`），bot token 失效/封仓时同样静默失败，无任何告警。

**同款教训**：account1 Claude OAuth 无感失效（决策 7702b938）——Notion Integration token 本质上是永久的，但 workspace 撤销授权（"封仓"）可能随时发生。

---

## 目标

实现 `notion-channel-sentinel` 独立 Job，提供：

1. **Bot 存活探测**：每次 tick 向 Notion API 发一次轻量探测（`GET /users/me`），检测 token 有效性
2. **Bark 告警**：通道异常时发送封仓预警，24h 内同类告警去重（仿 `credentials-health-scheduler.js` 的 `_alertDedup` 模式）
3. **状态可查**：通过 working_memory KV 记录 `last_ok / last_check / status`，Brain API 可读
4. **集成注册**：在 `scheduler-jobs.js` 中注册为独立 job，名称 `notion-channel-sentinel`

---

## 功能需求（FR）

### FR-1：探测逻辑

探测端点：`GET /users/me`（轻量，不操作业务数据库）

错误分类：

| HTTP状态/错误类型 | notionCode | 分类 | 告警消息 |
|------------------|------------|------|----------|
| 401 Unauthorized | `unauthorized` | token_invalid | Notion bot token 无效/已撤销，F6通道断路 |
| 403 Forbidden | `restricted_resource` | token_invalid | Notion Integration 授权被撤销（封仓） |
| 404 / `object_not_found` | - | token_invalid | Notion资源不可访问 |
| 网络超时/fetch异常 | - | network_error | Notion API 网络不可达 |
| token 为空字符串 | - | not_configured | NOTION_INBOX_TOKEN 未配置 |

### FR-2：告警去重

- 内存 Map `_notionAlertDedup`，key = 错误分类（`token_invalid` / `network_error` / `not_configured`）
- 去重窗口：24h（`ALERT_DEDUP_MS = 24 * 60 * 60 * 1000`）
- 导出 `_resetNotionAlertDedup()` 供测试重置

### FR-3：告警内容

```
Title: Notion 通道告警
Body: [notion-sentinel] {错误分类}: {具体错误信息}。F6收件箱/裁决通道已断路，请检查 Notion Integration 权限。
```

### FR-4：状态 KV 存储

每次探测后，写入 working_memory（`ON CONFLICT DO UPDATE`）：

```json
{
  "key": "notion_channel_sentinel_state",
  "value_json": {
    "status": "ok|token_invalid|network_error|not_configured",
    "last_check": "2026-08-06T12:00:00.000Z",
    "last_ok": "2026-08-06T11:55:00.000Z",  // 仅 ok 时更新
    "last_error": "error message or null",
    "consecutive_errors": 0
  }
}
```

pool 不可用时，跳过 KV 写入（不抛出，warn 日志）。

### FR-5：Job 注册

在 `scheduler-jobs.js` 的 JOBS 数组末尾追加：

```js
{ 
  name: 'notion-channel-sentinel',
  needsPool: true,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  handler: (pool) => runNotionChannelSentinel(pool),
  description: 'Notion通道活性哨兵：GET /users/me探测bot存活，token无效/封仓/未配置→Bark告警，24h去重，状态写working_memory（F6加厚，d64b5720）'
}
```

### FR-6：凭据未配置也告警

NOTION_INBOX_TOKEN 为空/未设置时：
- **不**静默跳过
- 发送 Bark 告警（消息："Notion token 未配置，F6通道无法工作"）
- 状态记为 `not_configured`
- 仍受24h去重保护（不会每分钟都叫）

---

## 非功能需求（NFR）

- **不改现有文件逻辑**：`notion-capture-ingest.js` 现有函数只能新增 export，不修改现有逻辑；`notifier.js` 只 import 使用
- **不加超时**：notionRequest 已有 30s AbortSignal.timeout，哨兵复用相同机制
- **needsPool: true**：KV 状态需要 pool，但 pool 失败不影响告警主流程
- **5min 自 gate**：探测间隔不短于 5min（内存变量 `lastSentinelRunAt`，初始0）
- **不改现有 F6 smoke 测试**：`factory-f6-inbox-smoke.sh` 不动，新 smoke 条目单独追加

---

## 实现方案

### 新增文件

`packages/brain/src/notion-channel-sentinel.js`

```
职责：
- 导出 runNotionChannelSentinel(pool)
- 导出 _resetNotionAlertDedup() （测试用）
- 导出 _getNotionSentinelState() （测试用，返回内存状态）
- 内部：_notionAlertDedup Map，_sentinelState 对象
```

### 修改文件

1. `packages/brain/src/scheduler-jobs.js` — 追加 import + JOBS 条目
2. 新增测试文件（见测试计划）

### 核心流程（伪代码）

```
runNotionChannelSentinel(pool):
  now = Date.now()
  if now - lastSentinelRunAt < 5 * 60 * 1000: return { skipped: true }
  lastSentinelRunAt = now

  { token } = getNotionInboxConfig()   // 复用 notion-capture-ingest.js 的导出

  if !token:
    await maybeAlertNotion('not_configured', 'NOTION_INBOX_TOKEN 未配置，F6通道无法工作')
    await writeKV(pool, { status: 'not_configured', last_error: 'token_not_set' })
    return { status: 'not_configured' }

  try:
    data = await notionRequest(token, '/users/me')  // 复用导出的 notionRequest
    // 成功
    await writeKV(pool, { status: 'ok', last_ok: new Date().toISOString(), last_error: null, consecutive_errors: 0 })
    console.log('[notion-sentinel] ok user=' + data.name)
    return { status: 'ok' }
  catch err:
    category = classifyError(err)   // token_invalid / network_error
    await maybeAlertNotion(category, err.message)
    await writeKV(pool, { status: category, last_error: err.message, consecutive_errors: prev+1 })
    return { status: category, error: err.message }

maybeAlertNotion(category, msg):
  last = _notionAlertDedup.get(category)
  if last && Date.now() - last < 24h: return  // 去重
  _notionAlertDedup.set(category, Date.now())
  await sendBark('Notion 通道告警', `[notion-sentinel] ${category}: ${msg}。F6收件箱/裁决通道已断路，请检查 Notion Integration 权限。`)
```

---

## 测试计划

### 单元测试

文件：`packages/brain/src/__tests__/notion-channel-sentinel.test.js`

| # | 测试用例 | 断言 |
|---|----------|------|
| T1 | token 未配置 → 返回 not_configured，sendBark 被调用 | status=not_configured |
| T2 | token 未配置，24h 内第二次 → 不重复 sendBark | bark 只调1次 |
| T3 | token 有效，GET /users/me 返回 200 → 返回 ok | status=ok，bark未调 |
| T4 | token 无效（401 unauthorized） → 返回 token_invalid，sendBark | status=token_invalid |
| T5 | 封仓（403 restricted_resource） → 返回 token_invalid，sendBark | status=token_invalid |
| T6 | 网络超时 → 返回 network_error，sendBark | status=network_error |
| T7 | token_invalid 告警，24h 内重复 → 去重，bark 只调1次 | 去重验证 |
| T8 | 5min gate：两次快速调用第二次跳过 | skipped=true |
| T9 | KV 写入成功（mock pool.query） | pool.query 被调用，参数含 notion_channel_sentinel_state |
| T10 | KV 写入失败（pool.query 抛错）→ 不影响返回值 | status 仍正确返回 |

---

## 验收标准（Contract）

### E2E Smoke 检查（追加到 factory-f6-inbox-smoke.sh 之外的独立脚本）

文件：`packages/brain/src/cron/__tests__/notion-sentinel-smoke.sh`（或 `scripts/` 下）

**Smoke-1（token 未配置告警）**：
- 环境：unset NOTION_INBOX_TOKEN
- 触发：直接 `node -e "import('./packages/brain/src/notion-channel-sentinel.js').then(m => m.runNotionChannelSentinel(null))"`
- 断言：日志含 `[notion-sentinel]` + `not_configured`

**Smoke-2（KV 状态写入）**：
- 前置：Brain 进程已运行（localhost:5221）
- 等待1个tick（~60s）或手动触发 job
- 断言：`working_memory` 表中存在 key=`notion_channel_sentinel_state`，value_json.status IN ('ok','not_configured','token_invalid','network_error')

**Smoke-3（API 状态可查）**：
- 调用 `GET localhost:5221/api/brain/working-memory/notion_channel_sentinel_state`（若该端点已存在）或直接查 DB
- 断言：返回 JSON 含 status / last_check 字段

---

## 实现限制（Invariants）

- **INV-01**：不修改 `notion-capture-ingest.js` 现有函数体，只复用其导出（`notionRequest`、`getNotionInboxConfig`）
- **INV-02**：不修改 `notifier.js`
- **INV-03**：`_notionAlertDedup` 必须是模块级内存 Map，Brain 重启清零（不入 DB）
- **INV-04**：KV 写入失败必须 warn 日志后静默（不抛出，不影响告警主流程）
- **INV-05**：Job 名称必须是 `notion-channel-sentinel`（scheduler sentinel key 与此关联）
- **INV-06**：告警去重 key 基于错误分类（`not_configured` / `token_invalid` / `network_error`），不含时间戳（保证幂等）

---

## 累积 FR 加载数

本 PRD 新增 FR：6 条（FR-1 ~ FR-6）
本 PRD 新增测试：10 条（T1 ~ T10）
本 Sprint Invariants：6 条（INV-01 ~ INV-06）

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `packages/brain/src/notion-channel-sentinel.js` |
| 新建 | `packages/brain/src/__tests__/notion-channel-sentinel.test.js` |
| 修改 | `packages/brain/src/scheduler-jobs.js`（追加 import + JOBS 条目） |
| 新增 smoke | `packages/brain/src/cron/__tests__/notion-sentinel-smoke.sh`（可选，不改现有 F6 smoke） |
