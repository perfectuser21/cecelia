# Learning: 闭环漏点④ — daily 巡检发现 bug 自动立案修复 task

## 背景
每日 code_review 巡检（daily-review-scheduler.js）为活跃 repo 建 `code_review` 任务，
code-review skill 完成后回调 `/api/brain/execution-callback` 附带 `{decision, l1_count, l2_count}`。
但 Brain 侧只对 `scope='initiative'` 的 code_review 做 decision 路由，daily 巡检（`scope='daily'`）
的回调命中 `else if` 后只打 "not initiative-level, skip" 日志——发现的 bug 被直接丢弃（开环漏点④）。

## 根本原因
1. **回调路由按 scope 分叉，daily 分支缺失**：execution.js 的 5c8 块（code_review 路由）
   只实现了 initiative-scope 的 PASS→verify / NEEDS_FIX→修复 / CRITICAL_BLOCK→告警三条路径，
   daily-scope 没有任何后续动作，回调里的 `{decision, l1_count, l2_count}` 被读都没读就丢了。
2. **立案逻辑在 execution.js 而非 callback-processor.js**：skill 直接 POST `/execution-callback`
   （execution.js 行 35 内联处理），callback-processor.js 只被 callback-worker 队列消费用——
   排查时若只看 callback-processor.js 会误判"无任何消费者"，实际消费者在 execution.js。

## 修复
execution.js code_review 路由新增 `scope==='daily'` 分支：
- 严重度优先映射：`CRITICAL_BLOCK || l1_count>0` → P0；`NEEDS_FIX || l2_count>0` → P1；PASS 且无问题 → 不立案。
  （decision 与计数不一致时以严重度为准，防止 skill 误标 PASS 却有 L1 时漏修。）
- daily 任务无 goal_id/project_id，修复 task 走 `trigger_source='auto_fix'` 通过 createTask 的
  goal_id 必填校验（auto_fix 在 isSystemTask 白名单内）。
- 用 `payload.repo_path` 定位修复目标；同 repo 已有未完成 `fix_type='daily_review_issues'`
  修复 task 时幂等去重，避免每日重复立案。

## 下次预防
- 排查"回调没人消费"类问题，先确认调用方实际 POST 的端点 → 该端点的 route handler 是不是
  inline 处理（execution.js）还是委托给 worker（callback-processor.js），别只看其中一个文件。
- 按 scope/type 分叉的路由，新增一个 scope 时检查是否所有分支都有终态动作，别留 skip 黑洞。

### checklist
- [x] daily-scope code_review 回调按 decision/L1-L2 建修复 dev task
- [x] 严重度优先级映射（P0/P1）+ PASS 无问题不立案
- [x] 无 goal_id 经 auto_fix 通过 createTask 校验
- [x] 同 repo 幂等去重
- [x] regression test（5 用例）+ smoke 真命令校验，已 commit 进 repo
- [x] 未改 initiative-scope 路由（14 个既有测试不回归）
