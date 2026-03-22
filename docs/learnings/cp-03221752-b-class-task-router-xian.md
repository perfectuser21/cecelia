# Learning: task-router B類任务路由 us→xian

## 任务概述

将 LOCATION_MAP 中 12 个 B類任务（规划/审查/知识类）从 'us' 路由到 'xian'，
充分利用西安 M4 的 5 个 Codex 账号产能。

### 根本原因

系统扩展了西安 Codex 产能后，task-router.js 的 LOCATION_MAP 未同步更新路由策略，
导致 initiative_plan/decomp_review/arch_review 等 B類任务仍路由到 US，
西安 Codex 只承接 codex_qa/codex_dev/pr_review 等少量任务，产能严重浪费。

### B類 vs A類 vs C類 分类

- **A類**：必须 US Claude Code（`dev`、`initiative_execute`）— 需要 worktree/hooks/.dev-mode
- **B類**：任意 LLM 均可（规划/审查/知识）— 路由到 xian，Codex bridge 执行
- **C類**：纯脚本无 LLM（publishers/scrapers）— 路由到 xian 或 hk

### 哪些保持 us（不变）

- `dept_heartbeat`、`intent_expand`、`initiative_execute`：依赖本机 Brain DB 或 worktree
- `prd_review`、`spec_review`、`code_review_gate`、`initiative_review`：US 本机 Codex Gate，需读 worktree diff
- `pipeline_rescue`：需访问本机 worktree 和 .dev-mode

### 下次预防

- [ ] 新增 task_type 时，在 LOCATION_MAP 注释中明确标注 A/B/C 类
- [ ] Codex bridge 部署新机器时，同步检查 LOCATION_MAP 哪些任务可迁移
