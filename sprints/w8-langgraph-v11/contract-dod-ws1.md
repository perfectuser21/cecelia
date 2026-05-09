---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: Pipeline-trace 验证脚本（H7/H8/H9/H10 痕迹检查 + R1/R2/R3/R5 mitigation）

**范围**: 在 `sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh` 实现 Step 1-5 的痕迹查询脚本，断言 H7/H8/H9/H10 四项修复在真实派发场景下叠加生效；Round 3 加 R1-R5 mitigation。
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 验证脚本文件存在且可执行
  Test: node -e "const fs=require('fs');const s=fs.statSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh');if(!(s.mode & 0o111))process.exit(1)"

- [ ] [ARTIFACT] 脚本声明 set -euo pipefail（防止静默错误）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.includes('set -euo pipefail'))process.exit(1)"

- [ ] [ARTIFACT] 脚本要求 TASK_ID 环境变量（防止裸跑误判）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.match(/\\\${TASK_ID:\\?/))process.exit(1)"

- [ ] [ARTIFACT] 脚本所有 curl 调用使用 -fsS --retry 3 --retry-delay 2（R3：抗 5xx 抖动）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');const m=c.match(/curl -fsS --retry 3 --retry-delay 2/g);if(!m||m.length<3)process.exit(1)"

- [ ] [ARTIFACT] 脚本 git fetch 加 --depth=1（R2：防大量 ref 拉取）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.includes('git fetch --depth=1'))process.exit(1)"

- [ ] [ARTIFACT] 脚本 git branch -r grep 后接 head -50（R2：propose_branch 数量爆炸防护）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.match(/git branch -r[^\\n]*head -50/))process.exit(1)"

- [ ] [ARTIFACT] 脚本检测 GIT_UNAVAILABLE 标志并走 SKIP 路径而非 FAIL（R1：fresh-clone fallback）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!(c.includes('GIT_UNAVAILABLE')&&c.match(/SKIP[:：]/)))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 cascade_skip 前置断言（R5：全 sub_task=failed 时跳过 H8 检查并标记 inconclusive）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!(c.includes('cascade_skip')&&c.includes('inconclusive')))process.exit(1)"

- [ ] [ARTIFACT] 脚本对 generator stdout 做 ≥ 200 bytes 长度断言（H7 痕迹）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.match(/STDOUT_LEN.*200|-ge\\s+200/))process.exit(1)"

- [ ] [ARTIFACT] 脚本对 planner stdout 做 push 噪音 token 反向断言（H9 痕迹）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.match(/Cloning into.*remote.*Writing objects|Cloning into|Writing objects/))process.exit(1)"

- [ ] [ARTIFACT] 脚本对 evaluator cwd 做 worktree 路径片段断言（H8 痕迹）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!c.match(/\\.worktrees\\/|worktree-/))process.exit(1)"

- [ ] [ARTIFACT] 脚本对 absorption_policy 状态做枚举断言 ∈ {applied, not_applied, absent}（H10 痕迹）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh','utf8');if(!(c.includes('applied')&&c.includes('not_applied')))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/pipeline-trace.test.ts`，Round 3 共 9 个 `it` 块覆盖：
- 脚本文件存在且可执行
- 脚本对 mock Brain API 全痕迹齐全场景返回 exit 0
- generator stdout < 200 bytes 时返回非 0（H7 失效检测）
- planner stdout 含 "Cloning into" 时返回非 0（H9 失效检测）
- evaluator cwd 不含 worktree 标志时返回非 0（H8 失效检测）
- absorption_policy 状态非法时返回非 0（H10 失效检测）
- 缺失 TASK_ID 环境变量时直接 exit 非 0
- **R1 新增**：GIT_UNAVAILABLE=1 注入时仍 exit 0 且 stdout 含 SKIP（fresh-clone fallback）
- **R5 新增**：全部 generator sub_task status=failed 时 exit 0 且 stdout 含 cascade_skip + inconclusive
