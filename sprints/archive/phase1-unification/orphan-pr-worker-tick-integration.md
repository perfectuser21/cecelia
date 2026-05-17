# tick.js 集成 Orphan PR Worker

> 落位时文件改名为 `orphan-pr-worker.js`，放到 `packages/brain/src/orphan-pr-worker.js`（与 `cleanup-worker.js` / `pipeline-watchdog.js` 同级）。

## 背景

PR #2406 #2408 两次因 Stop Hook 过早 exit 留下孤儿 PR（分支 push 了，但无人继续照看）。
根因：`/dev` 的 `harness_mode` 快速通道在 Stop Hook 之前 exit，后续没有任何兜底机制把这批"无主"的 PR 处置完。

本 worker 在 Brain tick 里加一条"每 30 分钟扫一次孤儿 PR"，作为最后一道防线。

---

## 1. 在 `packages/brain/src/tick.js` 顶部加 import

现有 Brain tick.js 的 worker 引用方式是两种：

- 静态 `import`（pipeline-watchdog 用）
- 懒加载 `import()`（cleanup-worker 用）

本 worker 选择 **静态 import**，和 pipeline-watchdog 同档：

```diff
 import { checkStuckPipelines } from './pipeline-watchdog.js';
+import { scanOrphanPrs } from './orphan-pr-worker.js';
```

---

## 2. 新增 interval 常量和状态变量

紧接 `_lastCleanupWorkerTime` 附近（tick.js 约 190 行）加：

```diff
 let _lastPipelineWatchdogTime = 0;
 let _lastCleanupWorkerTime = 0;
+let _lastOrphanPrWorkerTime = 0; // orphan PR 兜底扫描
```

紧接 `CLEANUP_WORKER_INTERVAL_MS` 附近（tick.js 约 200 行）加：

```diff
 const PIPELINE_WATCHDOG_INTERVAL_MS = parseInt(
   process.env.CECELIA_PIPELINE_WATCHDOG_INTERVAL_MS || String(30 * 60 * 1000), 10
 );
 const CLEANUP_WORKER_INTERVAL_MS = parseInt(
   process.env.CECELIA_CLEANUP_WORKER_INTERVAL_MS || String(10 * 60 * 1000), 10
 );
+const ORPHAN_PR_WORKER_INTERVAL_MS = parseInt(
+  process.env.CECELIA_ORPHAN_PR_WORKER_INTERVAL_MS || String(30 * 60 * 1000), 10
+); // 30 minutes
```

---

## 3. 在 tick 循环里新增一个 block

紧跟 `[R4] Orphan worktree 清理` block 之后（tick.js 约 1766 行）追加：

```javascript
// [R7] Orphan PR 兜底：每 30 分钟扫一次本机自己 push 的 cp-* PR
// 若一个 PR 超过 2h 且 Brain 里无 in_progress task 盯它：
//   CI 绿 → merge --squash；CI 红 → 打 needs-attention；CI 在跑 → skip
const orphanPrWorkerElapsed = Date.now() - _lastOrphanPrWorkerTime;
if (!MINIMAL_MODE && orphanPrWorkerElapsed >= ORPHAN_PR_WORKER_INTERVAL_MS) {
  _lastOrphanPrWorkerTime = Date.now();
  Promise.resolve()
    .then(() => scanOrphanPrs(pool))
    .then(r => {
      if (r.merged > 0 || r.labeled > 0) {
        tickLog(
          `[tick] orphan-pr-worker: scanned=${r.scanned} merged=${r.merged} labeled=${r.labeled} skipped=${r.skipped}`
        );
      }
    })
    .catch(err => {
      console.warn('[tick] orphan-pr-worker failed (non-fatal):', err.message);
    });
}
```

> 设计保持与 pipeline-watchdog 一致：`!MINIMAL_MODE` 守卫 + `Promise.resolve().then(...).catch(...)` 非阻塞。

---

## 4. 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `CECELIA_ORPHAN_PR_WORKER_INTERVAL_MS` | `1800000`（30 min） | tick 间隔 |
| `ORPHAN_PR_AGE_THRESHOLD_HOURS` | `2` | PR 创建超过多少小时才算候选孤儿 |
| `ORPHAN_PR_LABEL` | `needs-attention` | CI 失败的孤儿 PR 贴什么 label |

---

## 5. MINIMAL_MODE 行为

默认 **不在 minimal 模式跑**（`!MINIMAL_MODE` 守卫）。和 cleanup-worker / pipeline-watchdog 一致。

---

## 6. 外部依赖

- `gh` CLI（`gh pr list`、`gh pr checks`、`gh pr merge`、`gh pr edit`）——已经是本机 brain/agent 的标配
- `pg.Pool` —— 通过 `tasks.result->>'pr_url'` 判断是否有 task 在管

---

## 7. 观测

- 有动作（merged / labeled）时会写 `[tick] orphan-pr-worker: ...` 一行
- 单 PR 处理失败是 `console.warn` 而非抛错，便于 tick 继续
- 如需更详细审计，可把 `r.details` 数组写到 `cecelia_events`（后续迭代，不在 Phase 1 范围）

---

## 8. 手动 Dry-run 验证（部署前）

```bash
cd /Users/administrator/perfect21/cecelia
node packages/brain/src/orphan-pr-worker.js --dry-run
# 或指定阈值
node packages/brain/src/orphan-pr-worker.js --dry-run --threshold-hours=1
```

`dry-run` 只打印动作，不实际 merge / label。
