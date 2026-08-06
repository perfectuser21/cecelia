# Contract DoD — Notion 通道活性哨兵

**Task ID**: d64b5720-95bb-4f13-8de8-47d84f72ce43
**Sprint Dir**: sprints/08062214-relay-d64b5720
**Date**: 2026-08-06

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] token 未配置时返回 not_configured 并触发 Bark

**触发**：`NOTION_INBOX_TOKEN` 为空/未设置，调用 `runNotionChannelSentinel(pool)`

**预期行为**：
- 返回对象中 `status === "not_configured"`
- `sendBark` 被调用一次，标题为 `"Notion 通道告警"`
- 正文含 `"[notion-sentinel]"` 和 `"not_configured"`

**manual:bash 验收命令**：
```bash
unset NOTION_INBOX_TOKEN && \
node --input-type=module <<'EOF'
import { runNotionChannelSentinel, _resetNotionAlertDedup } from './packages/brain/src/notion-channel-sentinel.js';
_resetNotionAlertDedup();
const r = await runNotionChannelSentinel(null);
if (r.status !== 'not_configured') { console.error('FAIL status=' + r.status); process.exit(1); }
console.log('PASS status=not_configured');
EOF
```

---

### [BEHAVIOR-2] token 有效时返回 ok，不发告警

**触发**：`NOTION_INBOX_TOKEN` 已设置，`GET /users/me` 返回 HTTP 200

**预期行为**：
- 返回对象中 `status === "ok"`
- `sendBark` 不被调用
- KV 写入 `status: "ok"` 且 `last_ok` 为当前 ISO 时间

**manual:bash 验收命令**：
```bash
# 需要有效 token（沙箱或实际凭据）
node --input-type=module <<'EOF'
import { JOBS } from './packages/brain/src/scheduler-jobs.js';
const j = JOBS.find(j => j.name === 'notion-channel-sentinel');
if (!j) { console.error('FAIL: not registered'); process.exit(1); }
if (!j.needsPool) { console.error('FAIL: needsPool must be true'); process.exit(1); }
console.log('PASS job registered with needsPool=true');
EOF
```

---

### [BEHAVIOR-3] token 无效（401）→ token_invalid，触发 Bark，24h 内去重

**触发**：`notionRequest` 抛出 HTTP 401 错误（`err.status=401, err.notionCode='unauthorized'`）

**预期行为**：
- 返回 `status === "token_invalid"`
- 第一次调用：`sendBark` 被调用一次
- 24h 内第二次调用：`sendBark` 不被调用（去重生效）

**manual:bash 验收命令**：
```bash
npx vitest run packages/brain/src/__tests__/notion-channel-sentinel.test.js \
  --reporter=verbose 2>&1 | grep -E "T4|T7|token_invalid|PASS|FAIL"
```

---

### [BEHAVIOR-4] 5min 自 gate：两次快速连续调用，第二次跳过

**触发**：在距上次运行不足 5min 内再次调用 `runNotionChannelSentinel`

**预期行为**：
- 第二次调用返回 `{ skipped: true }` 或含 `skipped` 字段
- Notion API（`/users/me`）不被请求
- `sendBark` 不被调用

**manual:bash 验收命令**：
```bash
npx vitest run packages/brain/src/__tests__/notion-channel-sentinel.test.js \
  --reporter=verbose 2>&1 | grep -E "T8|5min gate|skipped|PASS|FAIL"
```

---

### [BEHAVIOR-5] KV 写入失败不影响主流程返回值

**触发**：`pool.query` 抛出错误（DB 不可用）

**预期行为**：
- 函数仍正常返回 `status` 字段
- 不向上抛出异常
- 控制台输出 `warn` 级别日志

**manual:bash 验收命令**：
```bash
npx vitest run packages/brain/src/__tests__/notion-channel-sentinel.test.js \
  --reporter=verbose 2>&1 | grep -E "T10|KV.*失败|pool.*fail|PASS|FAIL"
```

---

### [BEHAVIOR-6] scheduler-jobs.js 正确注册 notion-channel-sentinel

**触发**：import `JOBS` from `scheduler-jobs.js`

**预期行为**：
- JOBS 数组中存在 `name === 'notion-channel-sentinel'` 的条目
- 该条目 `needsPool === true`
- 该条目 `timeoutMs === DEFAULT_TIMEOUT_MS`（300000ms）
- handler 为接受 pool 参数的函数

**manual:bash 验收命令**：
```bash
node --input-type=module <<'EOF'
import { JOBS } from './packages/brain/src/scheduler-jobs.js';
const j = JOBS.find(j => j.name === 'notion-channel-sentinel');
if (!j) { console.error('FAIL: job not found'); process.exit(1); }
if (!j.needsPool) { console.error('FAIL: needsPool must be true'); process.exit(1); }
if (typeof j.handler !== 'function') { console.error('FAIL: handler not a function'); process.exit(1); }
console.log('PASS: notion-channel-sentinel registered correctly');
EOF
```

---

## 不变量核查（Invariants Check）

| INV | 验证方式 |
|-----|----------|
| INV-01 | 代码审查：`notion-channel-sentinel.js` 不修改 `notion-capture-ingest.js` 任何现有函数体 |
| INV-02 | 代码审查：不修改 `notifier.js`，仅 import |
| INV-03 | T3 + T7（重置后去重 Map 为空，重启后状态清零） |
| INV-04 | T10（pool 抛错，函数正常返回 status） |
| INV-05 | [BEHAVIOR-6] + Smoke-3 |
| INV-06 | T2 + T7（去重 key 为分类字符串，不含时间戳） |

---

## 测试套件覆盖映射

| 测试 ID | 对应 [BEHAVIOR] | 对应 FR |
|---------|-----------------|---------|
| T1 | BEHAVIOR-1 | FR-1, FR-6 |
| T2 | BEHAVIOR-1（去重） | FR-2 |
| T3 | BEHAVIOR-2 | FR-1 |
| T4 | BEHAVIOR-3 | FR-1, FR-3 |
| T5 | BEHAVIOR-3 | FR-1, FR-3 |
| T6 | BEHAVIOR-3（network） | FR-1, FR-3 |
| T7 | BEHAVIOR-3（去重） | FR-2 |
| T8 | BEHAVIOR-4 | NFR（5min gate） |
| T9 | BEHAVIOR-5（KV 成功路径） | FR-4 |
| T10 | BEHAVIOR-5（KV 失败路径） | FR-4, INV-04 |

---

## 完成标准

- [ ] 所有 [BEHAVIOR] 条目通过 manual:bash 验收命令
- [ ] 10 条单元测试（T1~T10）全部 PASS
- [ ] scheduler-jobs.js 注册验证通过（Smoke-3）
- [ ] 6 条 INV 全部经代码审查或自动测试核实
- [ ] CI（brain-ci.yml）绿
