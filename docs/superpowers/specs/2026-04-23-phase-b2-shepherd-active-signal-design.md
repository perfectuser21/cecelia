# Phase B2 — shepherd 活跃信号判定

**Date**: 2026-04-23
**Status**: Approved
**Task**: `c36991e7-822f-4d0e-aedf-d6650fc85d3d`
**Spec refs**: `docs/design/brain-orchestrator-v2.md` §7.2 / `docs/design/brain-v2-roadmap-next.md` §Phase B2

## 1. 目标

给 shepherd quarantine 决策点加"活跃信号"预检。当 task 有活跃 interactive claude 在推进（`.dev-mode.*` 文件 mtime < 90s）时，**跳过本次 quarantine**，避免把人类正在接管的 task 打入 24h 隔离。

## 2. 现场 bug 复现

Task `76530023-19bd-4879-a5f0-77161fe1162e` 在 2026-04-23 12:17 UTC 被 shepherd quarantine：
- docker spawn agent 22.7s failed → `failure_count: 2→3`
- `quarantine.js:464 shouldQuarantineOnFailure()` 看到 `>= 3` → 标 `quarantined`
- 同时 **interactive claude 在独立 worktree 已开工**（人类接管），shepherd 对此一无所知

## 3. 设计约束

- **只读信号，不写状态**：memory `stop-hook-cwd-as-key.md` 明禁给 `.dev-mode/.dev-lock` 加所有权字段（老路复活）。本方案只读 mtime，合规
- **单一数据源**：扫 `.dev-mode.*` mtime
- **单一阈值**：90s（spec §7.2）
- **单次 skip，非永久豁免**：下次 failure 重新判；避免真死 task 被永久保护

### 被排除的替代信号

| 信号 | 排除原因 |
|---|---|
| LangGraph `checkpoints` 表 | 仅 harness task 写；interactive /dev 不写 → **漏本 bug 场景** |
| docker container PS | cidfile 路径不稳定；interactive 不跑 docker container |
| `tasks.last_attempt_at` / `updated_at` | 失败也算 attempt，语义杂，会误判 |
| `.dev-lock` mtime | 只在 worktree 初始化写一次，不刷新 |

### 数据源可用性证据（subagent 摸底确认）

- `packages/engine/hooks/stop-dev.sh:L38,L68` — 每个 assistant stop 触发时调 `devloop_check`
- `packages/engine/lib/devloop-check.sh:L50-76` — 用 sed/echo 写 `.dev-mode`（ci_fix_count / step 状态 / cleanup_done）→ **mtime 刷新**
- `packages/brain/src/pipeline-patrol.js:L138-139` — 已有 mtime precedent
- `packages/brain/src/zombie-cleaner.js:L26-27` — 已有阈值 precedent

**结论**：interactive claude 每轮 tool call 后 Stop Hook 触发 → .dev-mode mtime 必刷新。90s 窗口对正常 interactive session 足够，对"claude 深度 think > 90s 无 tool call" 的罕见边界会误判 skip，但下次 failure 还会再判，语义安全。

## 4. 架构

### 4.1 新模块 `packages/brain/src/quarantine-active-signal.js`

```javascript
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ACTIVE_WINDOW_MS = 90_000;
const WORKTREE_ROOT = '/Users/administrator/worktrees/cecelia';
const MAIN_REPO = '/Users/administrator/perfect21/cecelia';

/**
 * 检查 task 是否有活跃 interactive session 在推进。
 * 扫 .dev-mode.* 文件 mtime，文件名含 taskId 前 8 位且 mtime < 90s → active。
 *
 * @param {string} taskId UUID 全量
 * @returns {Promise<{active: boolean, reason: string, source: string|null, ageMs: number|null}>}
 */
export async function hasActiveSignal(taskId) {
  if (!taskId || typeof taskId !== 'string') {
    return { active: false, reason: 'invalid_task_id', source: null, ageMs: null };
  }
  const prefix = taskId.slice(0, 8);
  const candidates = collectDevModeFiles();
  const now = Date.now();

  for (const filePath of candidates) {
    const basename = path.basename(filePath);
    if (!basename.includes(prefix)) continue;
    let mtime;
    try { mtime = statSync(filePath).mtimeMs; } catch { continue; }
    const ageMs = now - mtime;
    if (ageMs < ACTIVE_WINDOW_MS) {
      console.log(`[quarantine-active-signal] bypass: ${basename} age=${ageMs}ms`);
      return { active: true, reason: 'dev_mode_mtime_fresh', source: filePath, ageMs };
    }
  }
  return { active: false, reason: 'no_fresh_dev_mode', source: null, ageMs: null };
}

function collectDevModeFiles() {
  const files = [];
  try {
    for (const f of readdirSync(MAIN_REPO)) {
      if (f.startsWith('.dev-mode.')) files.push(path.join(MAIN_REPO, f));
    }
  } catch {}
  try {
    for (const wt of readdirSync(WORKTREE_ROOT)) {
      const dir = path.join(WORKTREE_ROOT, wt);
      try {
        for (const f of readdirSync(dir)) {
          if (f.startsWith('.dev-mode.')) files.push(path.join(dir, f));
        }
      } catch {}
    }
  } catch {}
  return files;
}
```

### 4.2 改 `packages/brain/src/quarantine.js`

在 `shouldQuarantineOnFailure(task)` 入口加活跃预检。

```javascript
// 原 L464 附近
import { hasActiveSignal } from './quarantine-active-signal.js';

export async function shouldQuarantineOnFailure(task) {
  // 预检：有活跃 interactive session → skip quarantine
  const signal = await hasActiveSignal(task.id);
  if (signal.active) {
    return {
      shouldQuarantine: false,
      reason: 'active_signal_bypass',
      details: {
        signal_source: signal.source,
        signal_reason: signal.reason,
        age_ms: signal.ageMs,
      },
    };
  }

  // 原逻辑不变
  const failureCount = (task.payload?.failure_count || 0) + 1;
  if (failureCount >= FAILURE_THRESHOLD) {
    return {
      shouldQuarantine: true,
      reason: QUARANTINE_REASONS.REPEATED_FAILURE,
      details: { failure_count: failureCount, threshold: 3 /* ... */ },
    };
  }
  return { shouldQuarantine: false };
}
```

**注意**：`shouldQuarantineOnFailure` 由同步改异步。所有 caller 需加 `await`。预期 caller：
- `quarantine.js` 内部 `quarantineTask()` 入口调用（若有）
- `tick.js` L995-1012 cortex 失败分支
- `shepherd.js` 相关 quarantine 分支

调用链改动需同时 grep 全仓 `shouldQuarantineOnFailure(` 确保无漏。

### 4.3 测试 `packages/brain/src/__tests__/quarantine-active-signal.test.js`

**Mock 策略**：`vi.mock('node:fs')` + 静态 mtime fixture，不依赖 DB/真文件系统。

4 个 cases：

| # | 场景 | 配置 | 断言 |
|---|---|---|---|
| 1 | 有匹配 .dev-mode 且 mtime < 90s | mock 一个含 `76530023` 前缀的文件，mtime=now-30s | `active:true, source 含该文件名, ageMs~30000` |
| 2 | 有匹配文件但 mtime > 90s | mtime=now-120s | `active:false, reason:'no_fresh_dev_mode'` |
| 3 | 无匹配（无前缀） | 文件名不含 task_id 前缀 | `active:false, reason:'no_fresh_dev_mode'` |
| 4 | taskId invalid | 传 null | `active:false, reason:'invalid_task_id'` |

### 4.4 现有 quarantine.js 测试回归

`quarantine.test.js` / `quarantine-release.test.js` 等现有 8 个测试不退化。若它们直接调 `shouldQuarantineOnFailure()` 需加 `await`。

## 5. 成功标准

1. `hasActiveSignal` 在 `shouldQuarantineOnFailure` 入口调用（grep 确认）
2. 新测试 4 cases 全 pass
3. `shouldQuarantineOnFailure` 改 async，所有 caller 加 `await`，现有 quarantine 测试全 pass
4. Phase A 的 Task 76530023 case 回放：若新 shepherd tick 跑它，会跳过 quarantine（手动回归 not blocking CI）
5. 新模块独立，无新增 DB 查询 / docker 调用

## 6. 不做

- checkpoints / docker PS / last_attempt_at 作为信号（§3 排除理由）
- quarantine TTL / release 机制改动
- shepherd.js PR CI 分支改动（另 PR）
- Phase E Observer 分离（shepherd 搬家）
- 环境变量控制 ACTIVE_WINDOW_MS（YAGNI，若需调整改常量）

## 7. 风险

| 风险 | 缓解 |
|---|---|
| interactive 深度 think > 90s 无 tool call → 被 quarantine | 下次 failure 会再判，不是永久豁免；可接受 |
| 真死 task 的 .dev-mode 文件残留 mtime 新（rare，cleanup 失败时）| zombie-cleaner 独立处理 .dev-mode 孤儿，本方案只读 |
| `shouldQuarantineOnFailure` 改 async 遗漏 caller → 得到 Promise 当 bool 判断永远 truthy | 全仓 grep + CI 测试保护 |
| console.log debug 污染日志 | 单行 info 级，可接受；如嫌噪音后续改 debug-level |

## 8. 回滚

- 删新文件 + 还原 `quarantine.js` `shouldQuarantineOnFailure` 成 sync
- 老行为恢复
