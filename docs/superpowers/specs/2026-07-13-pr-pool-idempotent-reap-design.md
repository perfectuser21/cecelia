# 设计：PR 池只进不出 —— 派发前语义查重 + orphan 收尸

## 背景
见 `sprints/07131528-pr-pool-idempotent-reap/prep-prd.md`（根因调查、Regression Test 计划）。
本文档只记录实现设计。

## 架构（writing-plans 阶段核实后修正）

**关键修正**：`harness-relay-watchdog.js` 的 `_discoverPrFromGithub(task, short, execFn)` 是按
task 自己的 short-id 在分支名里找**自己曾经开过的 PR**（同一 task_id 重新发现自己的 PR），
不适用于本次场景——3646/3647 是**两个不同 task_id**、各自分支名里编码各自的 short-id，
互相天然不匹配，复用这个函数堵不住刀1的洞。改用 DB 侧标题相似度判重。

新增共享模块 `packages/brain/src/dispatch-dedup.js`（纯函数，无 IO，两处调用方共用）：

```
dispatch-dedup.js
  ├── titleSimilarity(a, b) → number [0,1]（Jaccard，按空白/标点分词，大小写不敏感）
  └── findDuplicateSibling(title, candidates, {threshold=0.6, keyFn}) → candidate|null
```

### 调用方 1：dispatcher.js（刀1，防重复派发，DB 侧）
位置：pre-flight check 通过分支之后（`preFlightFailedIds.push(...); continue;` 之后），
`3b'. Retired harness task_types` 之前。
- 仅 `task_type === candidate.task_type` 且 `status IN ('queued','in_progress')` 的同类型任务里找，
  时间窗口 `created_at` 前后各 6 小时（`DUPLICATE_TASK_WINDOW_HOURS` 可调）。
- 用 `findDuplicateSibling(candidate.title, siblings, {threshold:0.6})` 判重（纯 DB 查询 + 纯函数，
  不依赖 gh，无 fail-open/fail-closed 问题——DB 查询失败按现有 catch 模式 warn 后放行，不阻塞派发）。
- 命中 → `recordDispatchResult(pool, false, 'duplicate_task_title_match')`，
  `duplicateSkipIds.push(candidate.id)`，`continue` 到下一候选（不 claim，仿 `preFlightFailedIds`/
  `noExecutorSkipIds` 既有 skip-and-retry 模式）。**不改动被跳过任务的状态**（留 queued，YAGNI——
  若 sibling 后续失败，这个任务在下个 tick 自然重新参与判重）。

### 调用方 2：orphan-pr-worker.js（刀2，红孤儿收尸 + superseded，GitHub 侧）
- CI failure 分支：`pr.ageHours > staleCloseHours`（新增 env `ORPHAN_PR_STALE_CLOSE_DAYS`，
  默认 7 天换算小时）且无 `keep` label → 新增 `closePr()`（仿现有 `mergePr`/`labelPr` 的
  execSync 风格）+ `gh pr comment` 留痕，不删分支（可恢复）。
- 新增 superseded 检测：候选处理前，用同一批 `gh pr list --author @me --state all` 结果（复用
  已有 `listOrphanCandidates` 的 raw 数据源，扩展为同时取 state=MERGED 的 PR），对每个候选用
  `findDuplicateSibling(candidate.title, mergedPrs, {threshold:0.6, keyFn:p=>p.title})` 判重
  → 命中直接 `closePr` + 评论 `superseded by #<N>`，不看 CI 状态、不受 age 阈值限制。
- 两条路径都先查 `keep` label 豁免（人工点名要救的 PR 永不自动关）。

## 错误处理
- 刀1：DB 查询失败 → warn 后放行（不阻塞派发，与现有 pre-flight 分支错误处理风格一致）。
- 刀2：沿用现有 `scanOrphanPrs` 单 PR try/catch 隔离（一个 PR 处理失败不影响其他 PR）；
  gh 调用失败沿用现有 `gh()` 封装的抛错行为，被外层 catch 吃掉记 skipped。
- DB 查询失败：沿用现有 `hasActiveBrainTask` 保守策略（查不动当作 active，不误杀）。

## 测试策略
全部逻辑接缝（mock pool/execFn，纯函数单测最简单），CI vitest 即可，不需要环境类自检：
1. `titleSimilarity`/`findDuplicateSibling` 纯函数单测：高重叠标题判重命中，无关标题不命中。
2. 派发查重：mock 同类型 sibling 高相似度 → 断言 `continue` 跳过、不调用 claim UPDATE。
3. 红孤儿超期关：`ageHours` 超阈值 + 无 keep label → 断言调用 close。
4. superseded 关闭：mock 已有高相似度 MERGED PR → 断言当前 PR 被 close + 评论含 "superseded by"。
5. keep label 豁免：两条路径命中 keep label → 断言不调用 close。

## 范围边界
不改：claim 逻辑（已验证是原子的，非本次问题）、mergePr/labelPr 现有绿色/CI-failure 短路径行为。
