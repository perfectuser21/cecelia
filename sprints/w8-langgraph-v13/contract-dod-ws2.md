---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 2: judge-result 脚本 + result.md 生成器

**范围**: 实现 `sprints/w8-langgraph-v13/scripts/judge-result.sh`，消费 WS1 的 evidence 输出，写最终 `result.md` 与（FAIL 时）`h12-draft.md`。
**大小**: S
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v13/scripts/judge-result.sh` 存在且首行是 bash shebang
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!/^#!.*(bash|sh)/.test(c.split('\n')[0]))process.exit(1)"

- [ ] [ARTIFACT] 脚本文件具备可执行权限
  Test: node -e "const s=require('fs').statSync('sprints/w8-langgraph-v13/scripts/judge-result.sh');if(!(s.mode & 0o111))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 `set -euo pipefail`
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!c.includes('set -euo pipefail'))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 PASS / FAIL 字面量分支
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!c.includes('PASS')||!c.includes('FAIL'))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 h12-draft.md 字面量（FAIL 路径产出物名）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!c.includes('h12-draft.md'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `sprints/w8-langgraph-v13/tests/ws2/judge-result.test.ts`，覆盖：
- 缺参时 exit 1 且 stderr 含 usage
- 给定 fixture-pass evidence 目录时，写 result.md 第一行匹配 `^PASS`
- 给定 fixture-fail evidence 目录时，写 result.md 第一行匹配 `^FAIL` 且生成 h12-draft.md（非空）
