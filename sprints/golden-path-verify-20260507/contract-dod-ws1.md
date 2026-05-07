---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 端到端 status 终态化观测器 + anti-revert (Round 2)

**范围**：脚本 + 测试，端到端运行 / 观察 `harness_initiative` 任务后 DB 行的终态化与时间单调性，并通过 git ancestor + git blame 锁定 PR #2816 fix commit (`c9300a89b`) 未被覆盖。
**大小**：M
**依赖**：无

## ARTIFACT 条目

- [ ] [ARTIFACT] 验证脚本存在并可执行
  Test: bash -c 'test -x sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh || exit 1'

- [ ] [ARTIFACT] 验证脚本含 Step 0 系统级 pre-flight (`pg_isready` + Brain `/health`，失败 exit 2)
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh','utf8');if(!c.includes('pg_isready')||!c.includes('/api/brain/health')||!/exit\s+2/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 验证脚本含 LAST_STEP trap（异常退出时打印当前阶段）
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh','utf8');if(!c.includes('LAST_STEP')||!/trap[\s\S]{0,200}LAST_STEP/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 验证脚本含 Step 1 入口断言（`task_type='harness_initiative'` + `started_at IS NOT NULL`）
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh','utf8');if(!c.includes(\"task_type='harness_initiative'\")||!c.includes('started_at'))process.exit(1)"

- [ ] [ARTIFACT] 验证脚本含 Step 2 子图执行痕迹断言（`task_events` + `graph_node_update` + 时间窗对齐 `started_at`）
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh','utf8');if(!c.includes('task_events')||!c.includes('graph_node_update')||!/started_at\s*-\s*interval\s*'1\s*minute'/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 验证脚本含 Step 3 终态 + 时间单调断言（`status IN (completed,failed)` 且 `updated_at >= started_at`）
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh','utf8');if(!c.includes('completed')||!c.includes('failed')||!c.includes('updated_at')||!c.includes('started_at'))process.exit(1)"

- [ ] [ARTIFACT] 验证脚本含 30 min 静默看门狗（`pipeline_stuck`，避免 2h 静默）
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh','utf8');if(!c.includes('pipeline_stuck')||!c.includes('1800'))process.exit(1)"

- [ ] [ARTIFACT] 验证脚本含 anti-revert 断言：`git merge-base --is-ancestor c9300a89b HEAD` + `git blame` 锚定 c9300a89b
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh','utf8');if(!c.includes('c9300a89b')||!c.includes('merge-base')||!c.includes('git blame'))process.exit(1)"

- [ ] [ARTIFACT] vitest 测试文件存在且包含目标 task_id `84075973-99a4-4a0d-9a29-4f0cd8b642f5` 与 PR #2816 fix commit `c9300a89b`
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws1/status-writeback.test.ts','utf8');if(!c.includes('84075973-99a4-4a0d-9a29-4f0cd8b642f5')||!c.includes('c9300a89b'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/status-writeback.test.ts`，覆盖：
- 成功路径：`packages/brain/src/executor.js` 的 `if (task.task_type === 'harness_initiative')` 块 try 内含 `updateTaskStatus(task.id, 'completed')`
- FAIL 路径：同一块 try 内含 `updateTaskStatus(task.id, 'failed', ...)`（携 error_message）
- 异常路径：同一块 catch 内含 `updateTaskStatus(task.id, 'failed')`，函数不向上抛
- 防回路：所有 return 路径写 `success: true`（不再 `success: result.ok` / `!final.error`），dispatcher 不会回退 queued
- PRD 目标 task_id 锚定：测试文件内字面包含 `84075973-99a4-4a0d-9a29-4f0cd8b642f5`，防 PRD 漂移
- **Round 2 新增 anti-revert**：`git merge-base --is-ancestor c9300a89b HEAD` 通过；`git blame` 在外层 caller 块中至少 1 行 `updateTaskStatus(task.id, completed|failed)` blame commit 前缀 = `c9300a89b`
- 端到端层（合同 Step 0–3 / 5b/5c 的 bash + psql + git）由 `scripts/verify-status-terminal.sh` 担责，evaluator 在 main（含 PR #2816）上跑
