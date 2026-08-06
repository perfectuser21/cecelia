# Contract Draft — Notion 通道活性哨兵

**Task ID**: d64b5720-95bb-4f13-8de8-47d84f72ce43
**Sprint Dir**: sprints/08062214-relay-d64b5720
**Date**: 2026-08-06
**Proposer Round**: 首轮

---

## 功能范围摘要

本合同覆盖 `notion-channel-sentinel` Job 的完整行为合约，包括：

1. `packages/brain/src/notion-channel-sentinel.js` — 新建哨兵模块
2. `packages/brain/src/scheduler-jobs.js` — 追加 import + JOBS 条目
3. `packages/brain/src/__tests__/notion-channel-sentinel.test.js` — 单元测试（T1~T10）

---

## 判定点（Invariants）

| ID | 约束 |
|----|------|
| INV-01 | 不修改 `notion-capture-ingest.js` 现有函数体，只 import 复用 `notionRequest`、`getNotionInboxConfig` |
| INV-02 | 不修改 `notifier.js`，仅 import `sendBark` |
| INV-03 | `_notionAlertDedup` 为模块级内存 Map，重启清零，不入 DB |
| INV-04 | KV 写入失败必须 warn 日志后静默（不抛出，不影响告警主流程） |
| INV-05 | Job 名称必须是 `notion-channel-sentinel`（JOBS 数组注册名） |
| INV-06 | 告警去重 key 基于错误分类（`not_configured` / `token_invalid` / `network_error`），不含时间戳 |

---

## 错误分类映射

| 触发条件 | 分类 | 告警标题 | 告警正文 |
|----------|------|----------|----------|
| token 为空/未设置 | `not_configured` | Notion 通道告警 | [notion-sentinel] not_configured: Notion token 未配置... |
| HTTP 401 (`unauthorized`) | `token_invalid` | Notion 通道告警 | [notion-sentinel] token_invalid: ... |
| HTTP 403 (`restricted_resource`) | `token_invalid` | Notion 通道告警 | [notion-sentinel] token_invalid: ... |
| HTTP 404 / `object_not_found` | `token_invalid` | Notion 通道告警 | [notion-sentinel] token_invalid: ... |
| 网络超时/fetch 异常 | `network_error` | Notion 通道告警 | [notion-sentinel] network_error: ... |

---

## KV 状态结构

```json
{
  "key": "notion_channel_sentinel_state",
  "value_json": {
    "status": "ok|token_invalid|network_error|not_configured",
    "last_check": "<ISO 8601>",
    "last_ok": "<ISO 8601 or null>",
    "last_error": "<string or null>",
    "consecutive_errors": 0
  }
}
```

写入时机：每次探测完成后（无论成功/失败）。pool 不可用时跳过写入，warn 日志。

---

## 5min 自 gate

模块级变量 `lastSentinelRunAt`（初始 0）。若 `Date.now() - lastSentinelRunAt < 5 * 60 * 1000`，直接返回 `{ skipped: true, reason: 'too_soon' }`，不调 Notion API，不发告警。

---

## 告警去重（24h）

- Map `_notionAlertDedup`，key = 错误分类字符串
- 去重窗口：`ALERT_DEDUP_MS = 24 * 60 * 60 * 1000`
- 同一错误分类 24h 内只发一次 Bark
- 导出 `_resetNotionAlertDedup()` 供测试清零

---

## E2E 验收

### Smoke-1：token 未配置 → 触发告警，日志含分类标记

**前置条件**：`NOTION_INBOX_TOKEN` 未设置（unset）

**执行命令**：
```bash
unset NOTION_INBOX_TOKEN
node --input-type=module <<'EOF'
import { runNotionChannelSentinel, _resetNotionAlertDedup } from './packages/brain/src/notion-channel-sentinel.js';
_resetNotionAlertDedup();
const r = await runNotionChannelSentinel(null);
console.log(JSON.stringify(r));
EOF
```

**断言**：
- 进程正常退出（exit 0）
- stdout JSON 中 `status === "not_configured"`
- stderr/stdout 含字符串 `[notion-sentinel]`

---

### Smoke-2：Brain 运行时 KV 写入验证

**前置条件**：Brain 进程运行中（localhost:5221），已完成至少 1 次 tick

**执行命令**：
```bash
psql $DATABASE_URL -tAc \
  "SELECT value_json->>'status' FROM working_memory WHERE key='notion_channel_sentinel_state' LIMIT 1;"
```

**断言**：
- 返回值 IN `('ok', 'not_configured', 'token_invalid', 'network_error')`（非空）

---

### Smoke-3：scheduler-jobs.js 注册验证

**执行命令**：
```bash
node --input-type=module <<'EOF'
import { JOBS } from './packages/brain/src/scheduler-jobs.js';
const j = JOBS.find(j => j.name === 'notion-channel-sentinel');
if (!j) { console.error('FAIL: job not registered'); process.exit(1); }
console.log('OK name=' + j.name + ' needsPool=' + j.needsPool);
EOF
```

**断言**：
- 输出含 `OK name=notion-channel-sentinel needsPool=true`
- 进程 exit 0

---

### Smoke-4：单元测试套件通过

**执行命令**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/notion-channel-sentinel.test.js --reporter=verbose 2>&1
```

**断言**：
- 10 个测试用例全部 PASS（T1~T10）
- 0 个失败

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `packages/brain/src/notion-channel-sentinel.js` |
| 新建 | `packages/brain/src/__tests__/notion-channel-sentinel.test.js` |
| 修改 | `packages/brain/src/scheduler-jobs.js`（追加 import + JOBS 条目） |
| 新增 smoke | `packages/brain/src/cron/__tests__/notion-sentinel-smoke.sh` |
