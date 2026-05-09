---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: Pipeline-trace 验证脚本（H7/H8/H9/H10 痕迹检查）

**范围**: 在 `sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh` 实现 Step 1-5 的痕迹查询脚本，断言 H7/H8/H9/H10 四项修复在真实派发场景下叠加生效。
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 验证脚本文件存在且可执行
  Test: node -e "const fs=require('fs');const s=fs.statSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh');if(!(s.mode & 0o111))process.exit(1)"

- [ ] [ARTIFACT] 脚本声明 set -euo pipefail（防止静默错误）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.includes('set -euo pipefail'))process.exit(1)"

- [ ] [ARTIFACT] 脚本要求 TASK_ID 环境变量（防止裸跑误判）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.match(/\\\${TASK_ID:\\?/))process.exit(1)"

- [ ] [ARTIFACT] 脚本对 generator stdout 做 ≥ 200 bytes 长度断言（H7 痕迹）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.match(/STDOUT_LEN.*200|-ge\\s+200/))process.exit(1)"

- [ ] [ARTIFACT] 脚本对 planner stdout 做 push 噪音 token 反向断言（H9 痕迹）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.match(/Cloning into.*remote.*Writing objects|Cloning into|Writing objects/))process.exit(1)"

- [ ] [ARTIFACT] 脚本对 evaluator cwd 做 worktree 路径片段断言（H8 痕迹）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.match(/\\.worktrees\\/|worktree-/))process.exit(1)"

- [ ] [ARTIFACT] 脚本对 absorption_policy 状态做枚举断言 ∈ {applied, not_applied, absent}（H10 痕迹）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!(c.includes('applied')&&c.includes('not_applied')))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/pipeline-trace.test.ts`，覆盖：
- 脚本对 mock Brain API 全痕迹齐全场景返回 exit 0
- generator stdout < 200 bytes 时返回非 0
- planner stdout 含 "Cloning into" 时返回非 0
- evaluator cwd 不含 worktree 标志时返回非 0
- absorption_policy 状态非法时返回非 0
- 缺失 TASK_ID 环境变量时直接 exit 非 0
