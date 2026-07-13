# 设计：PR 池只进不出 —— 派发前语义查重 + orphan 收尸

## 背景
见 `sprints/07131528-pr-pool-idempotent-reap/prep-prd.md`（根因调查、Regression Test 计划）。
本文档只记录实现设计。

## 架构

新增共享模块 `packages/brain/src/dispatch-dedup.js`，从
`harness-relay-watchdog.js` 的 `_discoverPrFromGithub` 抽出通用查重函数，供两处调用方复用：

```
dispatch-dedup.js
  ├── checkExistingPr(repo, matchKey, execFn) → PR|null（OPEN/MERGED 才算命中，CLOSED 不算）
  └── hasKeepLabel(pr) → boolean
```

### 调用方 1：dispatcher.js（刀1，防重复派发）
位置：`3c. Initiative-level lock` 之后、`3c'. Atomic claim` 之前。
- 仅 `task_type === 'dev' || task_type.startsWith('harness_')` 触发。
- `execFn` 抛错 → catch，warn 日志，**fail-open**放行（不能因 gh 挂掉停摆全体派发）。
- 命中已有 OPEN/MERGED PR → `recordDispatchResult(false, 'duplicate_pr_exists')`，跳过本候选，
  tick 继续下一候选（不 claim，不占位）。

### 调用方 2：orphan-pr-worker.js（刀2，红孤儿收尸 + superseded）
- CI failure 分支：`pr.ageHours > staleCloseHours`（新增 env `ORPHAN_PR_STALE_CLOSE_DAYS`，
  默认 7）且无 `keep` label → 新增 `closePr()`（仿现有 `mergePr`/`labelPr` 的 execSync 风格）+
  评论留痕，不删分支。
- 新增 superseded 检测：候选处理前先查同 branch short-id 是否已有 MERGED 状态 PR（复用
  `checkExistingPr`）→ 命中直接 close，评论 `superseded by #<N>`，不看 CI 状态、不受
  age 阈值限制。
- 两条路径都先查 `keep` label 豁免（人工点名要救的 PR 永不自动关）。

## 错误处理
- gh CLI 失败：刀1 fail-open（放行派发）；刀2 沿用现有 `scanOrphanPrs` 单 PR try/catch 隔离
  （一个 PR 处理失败不影响其他 PR）。
- DB 查询失败：沿用现有 `hasActiveBrainTask` 保守策略（查不动当作 active，不误杀）。

## 测试策略
全部逻辑接缝（mock execFn + mock pool），CI vitest 即可，不需要环境类自检：
1. 派发查重：两个不同 task_id、相同语义指纹 → 第二个被跳过。
2. 红孤儿超期关：`ageHours` 超阈值 + 无 keep label → 断言调用 close。
3. superseded 关闭：同 short-id 已有 MERGED PR → 断言当前 PR 被 close + 评论含 "superseded by"。
4. keep label 豁免：两条路径命中 keep label → 断言不调用 close。

## 范围边界
不改：claim 逻辑（已验证是原子的，非本次问题）、mergePr/labelPr 现有绿色/CI-failure 短路径行为。
