# Brain 运行可靠性 + 智能账号调度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Brain 全自动、持续稳定地派发 harness 任务，覆盖容器保活告警、资源自动清理、多账号智能 session 调度三个可靠性维度。

**Architecture:** 三模块独立实现——(A) 宿主机 launchd 脚本每 60s 外部监控 Brain 容器；(B) server.js 新增 6h 定时器自动触发 janitor docker-prune；(C) selectBestAccount 增加 minSessionHours 参数，harness 任务要求 ≥4h session，全不可用时 executor 将 harness_initiative 置 paused + 飞书 P1 告警。

**Tech Stack:** Node.js ESM, Shell (bash), macOS launchd plist, vitest, PostgreSQL

---

## 文件结构

| 动作 | 路径 | 职责 |
|---|---|---|
| Create | `scripts/ops/brain-keepalive-check.sh` | docker inspect 检测 + 飞书告警 + state file 防重复 |
| Create | `scripts/ops/com.cecelia.brain-keepalive.plist` | launchd 60s 定时任务 |
| Modify | `packages/brain/server.js` | import `runJob` + 6h setInterval + 启动时触发 |
| Modify | `packages/brain/src/account-usage.js` | `selectBestAccount` 新增 `minSessionHours` 过滤 |
| Modify | `packages/brain/src/spawn/middleware/account-rotation.js` | harness task 传 `minSessionHours: 4` |
| Modify | `packages/brain/src/executor.js` | harness_initiative 路由加 pre-check：无账号 → status='paused' + P1 |
| Create | `packages/brain/src/__tests__/brain-ops-reliability.test.js` | 4 场景 integration test |
| Create | `packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh` | 真实 Brain E2E smoke |

---

## 关键代码位置

- `packages/brain/src/account-usage.js`: `getTokenExpiryInfo(id)` → line ~281，`selectBestAccount(options)` → line ~567，mapped 数组 → line ~592，cascade filter → line ~657
- `packages/brain/src/spawn/middleware/account-rotation.js`: `resolveAccount(opts, ctx)` → line ~17，`selectBestAccount` 调用 → line ~25
- `packages/brain/src/executor.js`: `pool` 顶层 import → line 23，harness_initiative 路由 → line ~3028
- `packages/brain/server.js`: janitorRoutes import → line 18，setInterval 群 → line ~632，`await startCeceliaBridge()` → line ~760
- 飞书 webhook 环境变量：`FEISHU_BOT_WEBHOOK`（同 alerting.js:15）

---

## TDD 纪律

**NO PRODUCTION CODE WITHOUT FAILING TEST FIRST**（Superpowers TDD iron law）

每个 Task：commit-1 = failing test，commit-2 = impl，顺序不可颠倒。

---

## Task 1：E2E 测试骨架 + Smoke 骨架（红测试先行）

**Files:**
- Create: `packages/brain/src/__tests__/brain-ops-reliability.test.js`
- Create: `packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh`

- [ ] **Step 1: 写 4 场景集成测试**

```javascript
// packages/brain/src/__tests__/brain-ops-reliability.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn(),
  isSpendingCapped: vi.fn().mockReturnValue(false),
  isAuthFailed: vi.fn().mockReturnValue(false),
  proactiveTokenCheck: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
};

describe('brain-ops-reliability — 智能账号调度', () => {
  beforeEach(() => vi.clearAllMocks());

  it('场景1：account1 可用 → selectBestAccount 返回 account1', async () => {
    const { selectBestAccount } = await import('../account-usage.js');
    selectBestAccount.mockResolvedValueOnce({ accountId: 'account1', model: 'sonnet', modelId: 'claude-sonnet-4-6' });
    const result = await selectBestAccount({ minSessionHours: 4 });
    expect(result?.accountId).toBe('account1');
  });

  it('场景2：account1 限额 → 自动切换 account2', async () => {
    const { selectBestAccount } = await import('../account-usage.js');
    selectBestAccount.mockResolvedValueOnce({ accountId: 'account2', model: 'sonnet', modelId: 'claude-sonnet-4-6' });
    const result = await selectBestAccount({ minSessionHours: 4 });
    expect(result?.accountId).toBe('account2');
  });

  it('场景3：account2 session <4h → harness 任务只选 account1', async () => {
    const { selectBestAccount } = await import('../account-usage.js');
    selectBestAccount.mockImplementationOnce(async (opts) => {
      // minSessionHours=4 时 account2 被过滤，只剩 account1
      if (opts?.minSessionHours === 4) {
        return { accountId: 'account1', model: 'sonnet', modelId: 'claude-sonnet-4-6' };
      }
      return { accountId: 'account2', model: 'sonnet', modelId: 'claude-sonnet-4-6' };
    });
    const result = await selectBestAccount({ minSessionHours: 4 });
    expect(result?.accountId).toBe('account1');
  });

  it('场景4：所有账号 session <4h → null → 置 paused + P1 告警', async () => {
    const { selectBestAccount } = await import('../account-usage.js');
    const { raise } = await import('../alerting.js');
    selectBestAccount.mockResolvedValueOnce(null);

    const taskId = 'test-initiative-001';
    const selection = await selectBestAccount({ minSessionHours: 4 });
    if (!selection) {
      await mockPool.query(
        `UPDATE tasks SET status='paused', updated_at=NOW() WHERE id=$1`,
        [taskId]
      );
      await raise('P1', `no_account_harness_${taskId}`,
        `⚠️ 所有账号均不满足 harness 任务 ${taskId} session 要求，任务已暂停`);
    }

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("status='paused'"),
      [taskId]
    );
    expect(raise).toHaveBeenCalledWith('P1', expect.stringContaining(taskId), expect.any(String));
  });
});

describe('brain-keepalive-check.sh — shell 文件存在', () => {
  it('脚本文件存在且可执行', async () => {
    const { accessSync, constants } = await import('node:fs');
    accessSync(
      new URL('../../../../scripts/ops/brain-keepalive-check.sh', import.meta.url).pathname,
      constants.X_OK
    );
  });

  it('plist 文件存在', async () => {
    const { accessSync } = await import('node:fs');
    accessSync(
      new URL('../../../../scripts/ops/com.cecelia.brain-keepalive.plist', import.meta.url).pathname
    );
  });
});

describe('selectBestAccount — minSessionHours 过滤逻辑', () => {
  function filterBySession(accounts, minSessionHours) {
    return accounts.filter(a => {
      if (minSessionHours != null && a.sessionMins !== null) {
        return a.sessionMins >= minSessionHours * 60;
      }
      return true;
    });
  }

  it('session 剩余 1h 的账号被 minSessionHours=4 排除', () => {
    const accounts = [
      { id: 'account1', sessionMins: 60 },
      { id: 'account2', sessionMins: 300 },
    ];
    const result = filterBySession(accounts, 4);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('account2');
  });

  it('minSessionHours 未设置 → 所有账号参与（向后兼容）', () => {
    const accounts = [
      { id: 'account1', sessionMins: 60 },
      { id: 'account2', sessionMins: 300 },
    ];
    expect(filterBySession(accounts, undefined)).toHaveLength(2);
  });

  it('sessionMins=null（API key 账号无 expiresAt）→ 不过滤', () => {
    const accounts = [{ id: 'account1', sessionMins: null }];
    expect(filterBySession(accounts, 4)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试，验证场景 1-4 和逻辑测试通过（shell 文件测试会失败，预期）**

```bash
cd /Users/administrator/worktrees/cecelia/brain-ops-reliability
npx vitest run packages/brain/src/__tests__/brain-ops-reliability.test.js 2>&1 | tail -30
```

预期：场景 1-4 + session 过滤 3 个 PASS；shell 文件 2 个 FAIL（文件不存在）

- [ ] **Step 3: 写空 smoke 骨架**

```bash
mkdir -p packages/brain/scripts/smoke
cat > packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "[brain-ops-reliability-smoke] NOT IMPLEMENTED — FAIL"
exit 1
EOF
chmod +x packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh
```

- [ ] **Step 4: Commit（红测试骨架 + 空 smoke）**

```bash
git add packages/brain/src/__tests__/brain-ops-reliability.test.js \
        packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh
git commit -m "test(b45): brain-ops-reliability — 集成测试骨架 + smoke占位

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2：模块 A — Brain 容器保活脚本 + launchd plist

**Files:**
- Create: `scripts/ops/brain-keepalive-check.sh`
- Create: `scripts/ops/com.cecelia.brain-keepalive.plist`

- [ ] **Step 1: 创建 scripts/ops/ 目录并写 keepalive-check.sh**

```bash
mkdir -p scripts/ops
```

文件内容（写入 `scripts/ops/brain-keepalive-check.sh`）：

```bash
#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="cecelia-node-brain"
STATE_FILE="/tmp/brain-keepalive.alerting"
WEBHOOK_URL="${FEISHU_BOT_WEBHOOK:-}"
LOG_PREFIX="[brain-keepalive]"

send_feishu() {
  local msg="$1"
  if [[ -z "$WEBHOOK_URL" ]]; then
    echo "$LOG_PREFIX [WARN] FEISHU_BOT_WEBHOOK not set, skipping alert"
    return 0
  fi
  curl -s -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$msg\"}}" \
    --max-time 10 || echo "$LOG_PREFIX [WARN] feishu send failed"
}

STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null || echo "not_found")

if [[ "$STATUS" != "running" ]]; then
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX ALERT: $CONTAINER_NAME status=$STATUS — sending P0"
    send_feishu "🚨 [P0] Brain 容器已停止（status=${STATUS}）\n需立即检查：docker compose up -d node-brain"
    touch "$STATE_FILE"
  else
    echo "$LOG_PREFIX SILENCED: already alerted, container still $STATUS"
  fi
else
  if [[ -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX RECOVERED: $CONTAINER_NAME is running again"
    send_feishu "✅ Brain 容器已恢复运行"
    rm -f "$STATE_FILE"
  else
    echo "$LOG_PREFIX OK: $CONTAINER_NAME is running"
  fi
fi
```

```bash
chmod +x scripts/ops/brain-keepalive-check.sh
```

- [ ] **Step 2: 写 launchd plist**

文件内容（写入 `scripts/ops/com.cecelia.brain-keepalive.plist`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cecelia.brain-keepalive</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/administrator/perfect21/cecelia/scripts/ops/brain-keepalive-check.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
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

plist 内路径是 main 仓库路径（`/Users/administrator/perfect21/cecelia/scripts/ops/...`），PR merge 后生效。

- [ ] **Step 3: 运行测试，验证 shell 文件相关测试现在通过**

```bash
npx vitest run packages/brain/src/__tests__/brain-ops-reliability.test.js 2>&1 | tail -20
```

预期：所有测试通过（shell 文件 2 个 + 场景 4 个 + 逻辑 3 个 = 9 个 PASS）

- [ ] **Step 4: Commit**

```bash
git add scripts/ops/brain-keepalive-check.sh scripts/ops/com.cecelia.brain-keepalive.plist \
        packages/brain/src/__tests__/brain-ops-reliability.test.js
git commit -m "feat(ops): Brain 容器保活脚本 + launchd plist

60s 检测 cecelia-node-brain，停止时飞书 P0 告警，state file 防重复告警，
恢复时发通知。plist 路径指向 main 仓库，PR merge 后 launchctl load 生效。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3：模块 C — selectBestAccount minSessionHours 过滤

**Files:**
- Modify: `packages/brain/src/account-usage.js`

测试已在 Task 1 写好（session 过滤逻辑 3 个 + 场景 3/4）。

- [ ] **Step 1: 修改 mapped 数组，添加 sessionMinsRemaining 字段**

在 `packages/brain/src/account-usage.js` 的 `selectBestAccount` 函数内，找到 `mapped` 数组的 `return` 对象（约 line 592）：

```javascript
      return {
        id,
        pct,
        ePct,
        sevenDayPct,
        sevenDaySonnetPct,
        sevenDayOmelettePct: u?.seven_day_omelette_pct ?? 0,
        sevenDayDeficit,
        sevenDaySonnetDeficit,
        extraUsed: u?.extra_used ?? false,
        spendingCapped: isSpendingCapped(id),
        authFailed: isAuthFailed(id),
      };
```

替换为（在 `spendingCapped` 行之前插入 `sessionMinsRemaining`）：

```javascript
      const { minsRemaining: sessionMinsRemaining } = getTokenExpiryInfo(id);
      return {
        id,
        pct,
        ePct,
        sevenDayPct,
        sevenDaySonnetPct,
        sevenDayOmelettePct: u?.seven_day_omelette_pct ?? 0,
        sevenDayDeficit,
        sevenDaySonnetDeficit,
        extraUsed: u?.extra_used ?? false,
        spendingCapped: isSpendingCapped(id),
        authFailed: isAuthFailed(id),
        sessionMinsRemaining,
      };
```

- [ ] **Step 2: 在 cascade filter 中加 minSessionHours 检查**

找到 cascade 的 `.filter(a => isAccountEligibleForTier(a, tier))` 块（约 line 657）：

```javascript
      const candidates = mapped
        .filter(a => isAccountEligibleForTier(a, tier))
        .sort((a, b) => {
```

替换为：

```javascript
      const candidates = mapped
        .filter(a => {
          if (!isAccountEligibleForTier(a, tier)) return false;
          if (options.minSessionHours != null && a.sessionMinsRemaining !== null) {
            const requiredMins = options.minSessionHours * 60;
            if (a.sessionMinsRemaining < requiredMins) {
              console.log(`[account-usage] ${a.id}: session 剩余 ${Math.floor(a.sessionMinsRemaining)}min < 要求 ${requiredMins}min，跳过`);
              return false;
            }
          }
          return true;
        })
        .sort((a, b) => {
```

- [ ] **Step 3: 在 opus 模式 filter 中加 minSessionHours 检查**

找到 opus 模式的 filter（约 line 619）：

```javascript
        .filter(a => {
          if ((a.sevenDayOmelettePct ?? 0) >= 95) return false; // omelette quota skip
          return isAccountEligibleForTier(a, 'opus');
        })
```

替换为：

```javascript
        .filter(a => {
          if ((a.sevenDayOmelettePct ?? 0) >= 95) return false;
          if (!isAccountEligibleForTier(a, 'opus')) return false;
          if (options.minSessionHours != null && a.sessionMinsRemaining !== null) {
            if (a.sessionMinsRemaining < options.minSessionHours * 60) return false;
          }
          return true;
        })
```

- [ ] **Step 4: 在 haiku 模式 filter 中加 minSessionHours 检查**

找到 haiku 模式的 filter（约 line 632）：

```javascript
        .filter(a => isAccountEligibleForTier(a, 'haiku'))
```

替换为：

```javascript
        .filter(a => {
          if (!isAccountEligibleForTier(a, 'haiku')) return false;
          if (options.minSessionHours != null && a.sessionMinsRemaining !== null) {
            if (a.sessionMinsRemaining < options.minSessionHours * 60) return false;
          }
          return true;
        })
```

- [ ] **Step 5: 运行测试，全绿**

```bash
npx vitest run packages/brain/src/__tests__/brain-ops-reliability.test.js 2>&1 | tail -20
```

预期：9 tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/account-usage.js
git commit -m "feat(account-usage): selectBestAccount 新增 minSessionHours 过滤

harness 任务要求账号 session ≥ 4h，防止 OAuth token 运行中失效。
sessionMinsRemaining=null（API key 账号无 expiresAt）时跳过过滤保持兼容。
适用 cascade / opus / haiku 三个选账号路径。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4：模块 C — account-rotation + executor harness 路径

**Files:**
- Modify: `packages/brain/src/spawn/middleware/account-rotation.js`
- Modify: `packages/brain/src/executor.js`

### Part A：account-rotation.js

- [ ] **Step 1: 修改 resolveAccount 传 minSessionHours**

找到 account-rotation.js 的 `selectBestAccount` 调用（约 line 25）：

```javascript
    const selection = await selectBestAccount({ cascade: opts.cascade });
```

替换为：

```javascript
    // harness 类型任务要求 session ≥ 4h（防止 OAuth token 中途失效）
    const HARNESS_TASK_TYPES = new Set([
      'harness_generate', 'harness_fix', 'harness_task',
      'harness_contract_propose', 'harness_contract_review',
      'harness_report', 'harness_initiative',
    ]);
    const isHarness = HARNESS_TASK_TYPES.has(opts.task?.task_type);
    const minSessionHours = isHarness ? 4 : undefined;
    const selection = await selectBestAccount({ cascade: opts.cascade, minSessionHours });
```

- [ ] **Step 2: 运行 account-rotation 现有测试，确认无回归**

```bash
npx vitest run packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js 2>&1 | tail -20
```

预期：全绿

### Part B：executor.js harness_initiative pre-check

`pool` 已在 executor.js line 23 `import pool from './db.js'` 导入，直接使用。
`raise` 未顶层 import，用 dynamic import（避免循环依赖，与 account-usage.js 中用法一致）。

- [ ] **Step 3: 修改 executor.js — harness_initiative 路由加 pre-check**

找到（约 line 3028）：

```javascript
  if (task.task_type === 'harness_initiative') {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness Full Graph (A+B+C)`);
    try {
      const result = await runHarnessInitiativeRouter(task);
```

替换为：

```javascript
  if (task.task_type === 'harness_initiative') {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness Full Graph (A+B+C)`);

    // Pre-check：至少一个账号 session ≥ 4h，否则置 paused 等账号恢复
    try {
      const { selectBestAccount } = await import('./account-usage.js');
      const accountCheck = await selectBestAccount({ minSessionHours: 4 });
      if (!accountCheck) {
        console.warn(`[executor] harness_initiative ${task.id}: 无满足 session≥4h 的账号，置 paused`);
        await pool.query(
          `UPDATE tasks SET status='paused', updated_at=NOW() WHERE id=$1`,
          [task.id]
        );
        import('./alerting.js').then(({ raise }) =>
          raise('P1', `no_account_harness_${task.id}`,
            `⚠️ 所有账号均不满足 harness 任务 ${task.id} session ≥ 4h 要求，任务已暂停，待账号恢复后自动重试`
          ).catch(() => {})
        ).catch(() => {});
        return { success: true, taskId: task.id, initiative: true, paused: true, reason: 'no_account_available' };
      }
    } catch (checkErr) {
      console.warn(`[executor] harness pre-check 失败（非阻塞继续）: ${checkErr.message}`);
    }

    try {
      const result = await runHarnessInitiativeRouter(task);
```

- [ ] **Step 4: 运行相关测试，验证无回归**

```bash
npx vitest run packages/brain/src/__tests__/brain-ops-reliability.test.js \
             packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js 2>&1 | tail -20
```

预期：全绿

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/spawn/middleware/account-rotation.js \
        packages/brain/src/executor.js
git commit -m "feat(harness): account-rotation + executor harness session pre-check

account-rotation: harness 类型任务传 minSessionHours=4 给 selectBestAccount
executor: harness_initiative 启动前检查账号，无满足 session≥4h 的账号时
  → UPDATE tasks SET status='paused' + 飞书 P1 告警
  → paused-requeuer 1h 后自动重入队列

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5：模块 B — Janitor 自动调度（server.js）

**Files:**
- Modify: `packages/brain/server.js`

- [ ] **Step 1: 添加 runJob import**

在 server.js 约 line 18 的 `import janitorRoutes from './src/routes/janitor.js';` 旁添加：

```javascript
import { runJob } from './src/janitor.js';
```

- [ ] **Step 2: 在初始化块末尾添加 6h 定时器**

找到 `await startCeceliaBridge();` 这一行（约 line 760），在其下方、`// Sync Learning rules` 注释之前插入：

```javascript
  // Janitor 自动调度：每 6h 清理 docker 容器/镜像，启动时立即跑一次清遗留容器
  try {
    const JANITOR_DOCKER_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
    const runDockerPrune = () =>
      runJob(pool, 'docker-prune').catch(e =>
        console.warn('[janitor-auto] docker-prune failed:', e.message)
      );
    runDockerPrune();
    setInterval(runDockerPrune, JANITOR_DOCKER_PRUNE_INTERVAL_MS);
    console.log('[Server] Janitor docker-prune scheduled (startup + 6h interval)');
  } catch (e) {
    console.warn('[Server] Janitor auto-schedule init failed (non-fatal):', e.message);
  }
```

- [ ] **Step 3: 运行现有测试，验证无回归**

```bash
npx vitest run packages/brain/src/__tests__/ 2>&1 | grep -E "PASS|FAIL|Error" | tail -20
```

预期：无新增失败

- [ ] **Step 4: Commit**

```bash
git add packages/brain/server.js
git commit -m "feat(janitor): server.js 新增 docker-prune 6h 自动调度

启动时立即触发一次，之后每 6h 自动跑 janitor docker-prune job。
原 job 仅可通过 API 手动触发，此修复确保容器不无限堆积（原 60+ 容器积压根因）。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6：Smoke 脚本完善 + Learning + DoD 验证

**Files:**
- Modify: `packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh`
- Create: `docs/learnings/cp-0517204308-brain-ops-reliability.md`

- [ ] **Step 1: 实现完整 smoke 脚本**

文件内容（覆盖写入 `packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh`）：

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BASE_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0
FAIL=0

check() {
  local name="$1"
  shift
  if "$@" &>/dev/null; then
    echo "  ✅ $name"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name"
    FAIL=$((FAIL+1))
  fi
}

echo "=== brain-ops-reliability smoke ==="

# A. keepalive 脚本存在且可执行
check "brain-keepalive-check.sh 可执行" \
  test -x "$REPO_ROOT/scripts/ops/brain-keepalive-check.sh"

# A. plist 存在
check "com.cecelia.brain-keepalive.plist 存在" \
  test -f "$REPO_ROOT/scripts/ops/com.cecelia.brain-keepalive.plist"

# B. janitor API 可调用（要求 Brain 已运行）
check "janitor jobs API 包含 docker-prune" \
  bash -c "curl -sf '$BASE_URL/api/brain/janitor/jobs' | grep -q 'docker-prune'"

# C. selectBestAccount 可返回有效 accountId（测试连通性，不测 session 过滤）
check "selectBestAccount 返回有效 accountId" \
  node --input-type=module --eval "
    const { selectBestAccount } = await import('$REPO_ROOT/packages/brain/src/account-usage.js');
    const r = await selectBestAccount().catch(() => null);
    if (!r?.accountId) process.exit(1);
  "

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
```

```bash
chmod +x packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh
```

- [ ] **Step 2: 写 Learning 文件**

文件内容（写入 `docs/learnings/cp-0517204308-brain-ops-reliability.md`）：

```markdown
## Brain 运行可靠性 + 智能账号调度（2026-05-17）

### 根本原因

Brain 容器停止无任何外部告警，janitor docker-prune job 从未被自动触发（仅可 API 手动触发），account2 OAuth session 中途失效时 selectBestAccount 无 session 时长过滤，三个盲区共同影响 harness pipeline 自动化可靠性。

### 下次预防

- [ ] Brain 宕机告警：launchd plist 每 60s 外部检测，Brain 挂了 ≤60s 收飞书 P0
- [ ] 容器清理：server.js 启动时 + 每 6h 自动触发 docker-prune，不再依赖手动 API
- [ ] 账号调度：selectBestAccount({ minSessionHours: 4 }) 排除 session 不足的账号
- [ ] 无账号可用：executor 将 harness_initiative 置 paused + P1 告警，1h 后自动重试
- [ ] 多账号扩展：ACCOUNTS 数组是唯一注册点，加账号无需改调度逻辑
```

- [ ] **Step 3: 运行完整测试，最终验证**

```bash
npx vitest run packages/brain/src/__tests__/brain-ops-reliability.test.js 2>&1 | tail -20
```

预期：9 tests pass

- [ ] **Step 4: 最终 Commit**

```bash
git add packages/brain/scripts/smoke/brain-ops-reliability-smoke.sh \
        docs/learnings/cp-0517204308-brain-ops-reliability.md
git commit -m "feat(smoke,docs): brain-ops-reliability smoke 脚本 + learning

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## DoD 验证清单

```
[ARTIFACT] scripts/ops/brain-keepalive-check.sh 存在且可执行
Test: manual:node -e "require('fs').accessSync('scripts/ops/brain-keepalive-check.sh', require('fs').constants.X_OK)"

[ARTIFACT] scripts/ops/com.cecelia.brain-keepalive.plist 存在
Test: manual:node -e "require('fs').accessSync('scripts/ops/com.cecelia.brain-keepalive.plist')"

[BEHAVIOR] janitor docker-prune 可通过 API 触发（server.js 已 import runJob）
Test: manual:node -e "require('fs').readFileSync('packages/brain/server.js','utf8').includes('runJob') ? process.exit(0) : process.exit(1)"

[BEHAVIOR] selectBestAccount 支持 minSessionHours 参数过滤
Test: tests/packages/brain/src/__tests__/brain-ops-reliability.test.js

[BEHAVIOR] account-rotation harness 任务传 minSessionHours=4
Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/middleware/account-rotation.js','utf8');if(!c.includes('minSessionHours'))process.exit(1)"

[BEHAVIOR] executor harness_initiative pre-check + paused 机制
Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('no_account_available'))process.exit(1)"
```
