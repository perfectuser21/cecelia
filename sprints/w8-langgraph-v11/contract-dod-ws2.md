---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 终态写回验证脚本

**范围**: 在 `sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh` 实现 Step 6 的终态查询脚本，断言 initiative task 终态字段完整、无孤儿 sub_task、无 callback 404。
**大小**: S
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] 终态验证脚本文件存在且可执行
  Test: node -e "const fs=require('fs');const s=fs.statSync('sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh');if(!(s.mode & 0o111))process.exit(1)"

- [ ] [ARTIFACT] 脚本声明 set -euo pipefail
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh','utf8');if(!c.includes('set -euo pipefail'))process.exit(1)"

- [ ] [ARTIFACT] 脚本要求 TASK_ID 环境变量
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh','utf8');if(!c.match(/\\\${TASK_ID:\\?/))process.exit(1)"

- [ ] [ARTIFACT] 脚本断言 status ∈ {completed, failed} 终态枚举
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh','utf8');if(!(c.includes('completed')&&c.includes('failed')))process.exit(1)"

- [ ] [ARTIFACT] 脚本断言 completed_at 非空
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh','utf8');if(!c.includes('completed_at'))process.exit(1)"

- [ ] [ARTIFACT] 脚本断言 result.branch 与 result.final_verdict 字段存在（或同义字段）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh','utf8');if(!(c.includes('result.branch')||c.includes('final_branch')))process.exit(1)"

- [ ] [ARTIFACT] 脚本断言无孤儿 in_progress sub_task（parent_task_id=TASK_ID & status=in_progress 计数为 0）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh','utf8');if(!(c.includes('parent_task_id')&&c.includes('in_progress')))process.exit(1)"

- [ ] [ARTIFACT] 脚本断言最近 30 min 无 callback 404 错误
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh','utf8');if(!c.match(/callback.*404|404.*callback/i))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/terminal-state.test.ts`，覆盖：
- 脚本对 mock Brain API status='completed' + 字段完整场景返回 exit 0
- status='in_progress'（非终态）时返回非 0
- completed_at 缺失时返回非 0
- result.branch 缺失时返回非 0
- 存在孤儿 in_progress sub_task 时返回非 0
- dev_record 含 callback 404 时返回非 0
