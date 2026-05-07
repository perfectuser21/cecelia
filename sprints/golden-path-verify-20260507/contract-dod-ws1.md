---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 端到端 status 终态化观测器

**范围**：脚本 + 测试，端到端运行 / 观察 `harness_initiative` 任务后 DB 行的终态化与时间单调性。
**大小**：M
**依赖**：无

## ARTIFACT 条目

- [ ] [ARTIFACT] 验证脚本存在并可执行
  Test: bash -c 'test -x sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh || exit 1'

- [ ] [ARTIFACT] 验证脚本含 Step 1 入口断言（`task_type='harness_initiative'` + `started_at IS NOT NULL`）
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh','utf8');if(!c.includes(\"task_type='harness_initiative'\")||!c.includes('started_at'))process.exit(1)"

- [ ] [ARTIFACT] 验证脚本含 Step 2 子图执行痕迹断言（`task_events` + `graph_node_update` + 24h 时间窗口）
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh','utf8');if(!c.includes('task_events')||!c.includes('graph_node_update')||!c.includes(\"interval '24 hours'\"))process.exit(1)"

- [ ] [ARTIFACT] 验证脚本含 Step 3 终态 + 时间单调断言（`status IN (completed,failed)` 且 `updated_at >= started_at`）
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh','utf8');if(!c.includes('completed')||!c.includes('failed')||!c.includes('updated_at')||!c.includes('started_at'))process.exit(1)"

- [ ] [ARTIFACT] vitest 测试文件存在且包含目标 task_id `84075973-99a4-4a0d-9a29-4f0cd8b642f5`
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws1/status-writeback.test.ts','utf8');if(!c.includes('84075973-99a4-4a0d-9a29-4f0cd8b642f5'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/status-writeback.test.ts`，覆盖（静态断言外层 caller 形状，参考 PR #2816 自带测试模式）：
- 成功路径：`packages/brain/src/executor.js` 的 `if (task.task_type === 'harness_initiative')` 块 try 内含 `updateTaskStatus(task.id, 'completed')`
- FAIL 路径：同一块 try 内含 `updateTaskStatus(task.id, 'failed', ...)`（携 error_message）
- 异常路径：同一块 catch 内含 `updateTaskStatus(task.id, 'failed')`，函数不向上抛
- 防回路：所有 return 路径写 `success: true`（不再 `success: result.ok` / `!final.error`），dispatcher 不会回退 queued
- PRD 目标 task_id 锚定：本测试文件内字面包含 `84075973-99a4-4a0d-9a29-4f0cd8b642f5`，防 PRD 漂移
- 端到端层（合同 Step 1–3 的 bash + psql）由 `scripts/verify-status-terminal.sh` 担责，evaluator 在 main（含 PR #2816）上跑
