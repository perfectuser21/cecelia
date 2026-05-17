# Brain 运行可靠性 + 智能账号调度 实现规范

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Brain 能全自动、持续稳定地派发 harness 任务，覆盖容器保活、资源清理、多账号智能调度三个核心可靠性维度。

**Architecture:** 
- 模块 A：宿主机 launchd 脚本外部监控 Brain 容器（Brain 宕机时无法自报）
- 模块 B：server.js 新增 6h 定时器自动触发 janitor docker-prune job
- 模块 C：`selectBestAccount` 新增 `minSessionHours` 参数，harness 任务要求账号 session ≥ 4h；全账号不可用时任务 pause + 飞书告警

**Tech Stack:** Node.js, Shell, launchd plist, vitest, PostgreSQL

---

## 现状确认（已验证）

| 问题 | 代码真相 |
|---|---|
| Brain 容器停止无告警 | 无任何外部监控，Brain 宕机 = 全盲 |
| 容器堆积（60+） | `janitor-jobs/docker-prune.js` 存在但从未自动触发（仅 `POST /api/brain/janitor/docker-prune/run`） |
| Account session 中途失效 | `proactiveTokenCheck` 在 dispatch 时检查，但不过滤"剩余时间 < 4h"的长任务 |
| Brain 启动自检 | ✅ 已实现 `server.js:394-399`，**无需改动** |

---

## 文件结构

**新建：**
- `scripts/ops/brain-keepalive-check.sh` — Brain 容器状态检测 + 飞书告警
- `scripts/ops/com.cecelia.brain-keepalive.plist` — launchd 定时任务（60s）
- `packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh` — E2E smoke 验证

**修改：**
- `packages/brain/server.js` — 新增 janitor 6h 定时器 + `import { runJob }`
- `packages/brain/src/account-usage.js` — `selectBestAccount` 新增 `minSessionHours` 参数
- `packages/brain/src/spawn/middleware/account-rotation.js` — harness 类型任务传 `minSessionHours: 4`
- `packages/brain/src/executor.js` — harness dispatch 路径传 `minSessionHours: 4`

**新建（测试）：**
- `packages/brain/src/__tests__/brain-ops-reliability.test.js` — 4场景 integration test

---

## 测试策略

- **E2E test** (`brain-ops-reliability.test.js`)：跨多模块，覆盖 4 个账号调度场景（见模块 C）
- **Unit test**（内联于各场景）：`selectBestAccount({ minSessionHours: 4 })` 过滤逻辑
- **Smoke**：`brain-ops-reliability-smoke.sh` 在真实 Brain 起来后验证 janitor job 可调用

---

## 模块 A：Brain 容器保活

### A1 原理

launchd 每 60s 运行 `brain-keepalive-check.sh`，检查 `docker inspect cecelia-node-brain` 的 `State.Status`：

```
非 "running" + 无 /tmp/brain-keepalive.alerting
  → curl 飞书 webhook（P0 告警）
  → touch /tmp/brain-keepalive.alerting
非 "running" + 有 /tmp/brain-keepalive.alerting
  → 静默（防重复告警）
"running" + 有 /tmp/brain-keepalive.alerting
  → curl 飞书（✅ Brain 已恢复）+ rm state file
"running" + 无 state file
  → 正常，无操作
```

飞书 webhook URL 从 `~/.credentials/feishu.env` 读取（`FEISHU_WEBHOOK_URL`）。

### A2 plist 格式

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ...>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cecelia.brain-keepalive</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/administrator/perfect21/cecelia/scripts/ops/brain-keepalive-check.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/brain-keepalive.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/brain-keepalive-err.log</string>
</dict>
</plist>
```

### A3 安装命令

```bash
cp scripts/ops/com.cecelia.brain-keepalive.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cecelia.brain-keepalive.plist
```

### A4 测试

Shell test（vitest 调用 bash）：mock `docker inspect` 返回 `exited` → 验证飞书 curl 被调用一次；再次调用（state file 已存在）→ 验证飞书 curl 不被调用第二次。

---

## 模块 B：Janitor 自动调度

### B1 修改 server.js

在现有 `setInterval` 群（~line 400+）新增：

```js
import { runJob } from './src/janitor.js';

// 每 6 小时自动清理 docker 容器/镜像
const JANITOR_DOCKER_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
setInterval(() => {
  runJob(pool, 'docker-prune').catch(e =>
    console.warn('[janitor-auto] docker-prune failed:', e.message)
  );
}, JANITOR_DOCKER_PRUNE_INTERVAL_MS);
// 启动时立即跑一次（清理上次重启遗留容器）
runJob(pool, 'docker-prune').catch(e =>
  console.warn('[janitor-auto] initial docker-prune failed:', e.message)
);
```

### B2 测试

Unit test（mock pool）：验证 `runJob` 被正确调用，`janitor_runs` 有 `docker-prune` 插入记录。

---

## 模块 C：智能账号调度

### C1 selectBestAccount 新增 minSessionHours

`account-usage.js` `selectBestAccount(options)` 在候选账号过滤阶段增加：

```js
// 在 mapped 阶段，计算 sessionMinsRemaining
const { minsRemaining: sessionMins } = getTokenExpiryInfo(id);

// 在过滤阶段（isAccountEligibleForTier 之后）
if (options.minSessionHours != null && sessionMins !== null) {
  const required = options.minSessionHours * 60;
  if (sessionMins < required) {
    console.log(`[account-usage] ${id}: session 剩余 ${Math.floor(sessionMins)}min < 要求 ${required}min，跳过`);
    return false; // 从候选中排除
  }
}
```

当 `sessionMins === null`（credentials 文件不含 expiresAt，如 API key 账号）→ 不过滤，保持兼容。

### C2 harness dispatch 路径传参

`executor.js` 的 harness 类型任务 `selectBestAccount` 调用处（及 `account-rotation.js` middleware 的调用处），新增：

```js
// harness 任务 session 要求（防止 session 中途过期）
const minSessionHours = isHarnessTask(taskType) ? 4 : undefined;
const selection = await selectBestAccount({ cascade: opts.cascade, minSessionHours });
```

`isHarnessTask` 函数：`taskType` 包含 `harness_generate`、`harness_fix`、`harness_contract_propose`、`harness_contract_review`、`harness_report`、`harness_initiative` 时返回 true。

### C3 全账号不可用时 pause 任务

在 `executor.js` / `dispatcher.js` 的 harness dispatch 路径，当 `selectBestAccount` 返回 null 时：

```js
if (!selection) {
  // 所有账号不可用（session 不足 / 全部限额）
  await pool.query(
    `UPDATE tasks SET status='paused', pause_reason='no_account_available',
     updated_at=NOW() WHERE id=$1`,
    [taskId]
  );
  await raise('P1', `no_account_harness_${taskId}`,
    `⚠️ 所有账号均不满足 harness 任务 ${taskId} 要求（session < 4h 或全部限额），任务已暂停`);
  return { dispatched: false, reason: 'no_account_available' };
}
```

Paused 任务由 Brain tick 的 `paused-requeuer` 插件 30min 后重新放入 queued。

### C4 E2E 集成测试场景

`packages/brain/src/__tests__/brain-ops-reliability.test.js`

```
场景 1：正常 — account1 有额度 + session 充足 → 选中 account1
场景 2：account1 限额 → 自动切换 account2（session 充足）→ dispatch 成功
场景 3：account2 session 剩余 1h（< 4h）→ harness 任务排除 account2 → 选 account1
场景 4：所有账号 session < 4h → selectBestAccount 返回 null → 任务 status='paused' + P1 告警
```

每个场景 mock：`getTokenExpiryInfo`、`isSpendingCapped`、`isAuthFailed`、`pool.query`。

### C5 账号数量兼容性

`ACCOUNTS` 数组（account-usage.js）是唯一账号注册点。3 账号时只需往数组加 `'account3'` + 对应的 `~/.claude-account3/.credentials.json`，智能调度逻辑无需改动。

---

## Smoke 脚本

`packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
# 1. janitor API 可调用（Brain 已起）
curl -sf http://localhost:5221/api/brain/janitor/jobs | grep -q 'docker-prune'
# 2. brain-keepalive-check.sh 存在且可执行
test -x scripts/ops/brain-keepalive-check.sh
# 3. selectBestAccount 返回 accountId（至少一个账号可用）
node -e "
  const { selectBestAccount } = await import('./packages/brain/src/account-usage.js');
  const r = await selectBestAccount();
  if (!r?.accountId) { process.stderr.write('no account available\n'); process.exit(1); }
  console.log('account selected:', r.accountId);
" 2>&1
echo "smoke: PASS"
```

---

## 成功标准

- [ ] Brain 容器停止 → 60s 内飞书收到 P0 告警
- [ ] Brain 恢复 → 飞书收到恢复通知，不重复告警
- [ ] Brain 重启后 `janitor_runs` 出现 `docker-prune` 记录（6h 内或启动时）
- [ ] harness 任务分配时，session < 4h 的账号被跳过
- [ ] 全账号不可用时，harness 任务变 `status='paused'`，P1 飞书告警发出
- [ ] 新增账号只需 `ACCOUNTS.push('account3')` 无需改调度逻辑
- [ ] 所有 4 场景 integration test 通过
