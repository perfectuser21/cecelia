# Brain P0 三联修 — 启动+状态机+watcher

## 背景

Brain 实例反复重启不稳定，4 个 team agent 综合诊断指向 3 个核心 bug：

1. `startup-recovery.js::cleanupStaleClaims` UUID 类型断言错（`int[]` → `uuid[]`）
2. `harness-task-dispatch.js` INSERT `harness_ci_watch` 缺 `status='queued'`（已确认现版本已修，仅补测试锁定）
3. `shepherd.js` ci_passed 状态机断链 + `quarantine.js::hasActivePr` 漏 `'ci_passed'` 白名单

不修则启动循环 + CI 监控链废 + Generator 类任务永远停在 ci_passed。

## 修改清单

### 修 1：startup-recovery.js — UUID 类型修正

**位置**：`packages/brain/src/startup-recovery.js:276`

**变更**：

```diff
-       WHERE id = ANY($1::int[])
+       WHERE id = ANY($1::uuid[])
```

**原因**：`tasks.id` 是 UUID 列，`int[]` 强转抛 `operator does not exist: uuid = integer`。
**影响**：cleanupStaleClaims 现在能正确释放 stale claim。

### 修 2：harness-task-dispatch.js — INSERT status='queued'（已修，补测试）

**位置**：`packages/brain/src/harness-task-dispatch.js:99-112`

**当前实现已含 `status='queued'`**（VALUES 第 5 位 = status 列）。本 PR 加测试锁定，防止回退。

测试：mock `pool.query`，验证 INSERT 调用的 SQL 字符串包含 `'queued'` 且参数顺序正确。

### 修 3A：shepherd.js — ci_passed 后等并 reload PR state

**位置**：`packages/brain/src/shepherd.js:166-186`

**变更**：`executeMerge(prUrl)` 后立即 `checkPrStatus` 重读 PR 最新 state；若 `state==='MERGED'` 则同时 UPDATE `status='completed' + completed_at=NOW() + pr_status='merged'`，否则保持 pr_status='ci_passed'。

**原因**：squash merge 后 PR 立即变 MERGED；不读最新 state 永远停在 ci_passed → status 字段永远 in_progress → KR 进度链断。

### 修 3B：shepherd.js 主 SELECT 加 'ci_passed'

**位置**：`packages/brain/src/shepherd.js:127`

**变更**：

```diff
-        AND pr_status IN ('open', 'ci_pending')
+        AND pr_status IN ('open', 'ci_pending', 'ci_passed')
```

**原因**：3A 写入 'ci_passed' 后，3B 没纳入轮询白名单 → shepherd 永远不再读这条任务 → 修 3A 内 reload PR state 永远不触发，状态机僵死。

### 修 3C：quarantine.js::hasActivePr 加 'ci_passed'

**位置**：`packages/brain/src/quarantine.js:1078`

**变更**：

```diff
-    return r.pr_url != null && ['open', 'ci_pending', 'merged'].includes(r.pr_status);
+    return r.pr_url != null && ['open', 'ci_pending', 'ci_passed', 'merged'].includes(r.pr_status);
```

**原因**：handleTaskFailure 第 3 道活跃信号守卫漏 'ci_passed'，导致 ci_passed 状态下 failure_count 累积可被误判 quarantine → quarantined→queued 死循环。

## 测试清单

| 文件 | 覆盖 |
|------|------|
| `packages/brain/src/__tests__/startup-recovery-uuid.test.js` | mock pool.query，断言 cleanupStaleClaims 第二个 query 用 `uuid[]` |
| `packages/brain/src/__tests__/shepherd-ci-passed.test.js` | (a) 主 SELECT WHERE 含 'ci_passed' (b) ci_passed + MERGEABLE 分支 executeMerge 后再读 PR，state=MERGED 时 UPDATE status='completed' |
| `packages/brain/src/__tests__/quarantine-ci-passed.test.js` | mock pr_status='ci_passed'，hasActivePr 返回 true |

测试均用 `vi.mock` 注入 pool/execSync，不依赖真实 DB / GitHub API。

## 成功标准

- [ARTIFACT] startup-recovery.js 用 `uuid[]` 而非 `int[]`
- [ARTIFACT] harness-task-dispatch.js INSERT 含 status='queued'
- [ARTIFACT] shepherd.js WHERE 含 'ci_passed'
- [ARTIFACT] shepherd.js executeMerge 后逻辑读取最新 PR state 决定 status='completed'
- [ARTIFACT] quarantine.js hasActivePr 含 'ci_passed'
- [BEHAVIOR] cd packages/brain && npm test -- --run startup-recovery-uuid 全绿
- [BEHAVIOR] cd packages/brain && npm test -- --run shepherd-ci-passed 全绿
- [BEHAVIOR] cd packages/brain && npm test -- --run quarantine-ci-passed 全绿

## 影响范围

- Brain 启动恢复链（cleanupStaleClaims）
- PR shepherd 状态机（ci_passed → completed）
- harness watcher 队列入口（已修，仅锁定）
- quarantine 第 3 道活跃信号守卫
- 不影响 dashboard / api / engine

## 部署

合并后 docker-compose 自动 rebuild brain；Brain 启动 log 应消失：

- `operator does not exist: uuid = integer`（修 1）
- `quarantined→queued` 振荡（修 3C）
