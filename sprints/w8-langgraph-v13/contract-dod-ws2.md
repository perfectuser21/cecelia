---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 2: lib-checks 函数库 + judge-result 脚本

**范围**:
- (a) `sprints/w8-langgraph-v13/scripts/lib-checks.sh` — 导出 `check_step_2..check_step_8` 函数；E2E 脚本与 judge-result.sh 同源消费。
- (b) `sprints/w8-langgraph-v13/scripts/judge-result.sh` — 顶部 `source ./lib-checks.sh`，按 Step 2~7 顺序调函数，写 `result.md` 与（FAIL 时）`h12-draft.md`。

**大小**: M
**依赖**: Workstream 1

## ARTIFACT 条目

### lib-checks.sh

- [ ] [ARTIFACT] `sprints/w8-langgraph-v13/scripts/lib-checks.sh` 存在且首行是 `#!/usr/bin/env bash` 或 `#!/bin/bash`
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');if(!/^#!.*(bash|sh)/.test(c.split('\n')[0]))process.exit(1)"

- [ ] [ARTIFACT] lib-checks.sh 含 `set -u`（不要 `-e` 以免函数失败直接退出 source 它的脚本）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');if(!c.includes('set -u'))process.exit(1)"

- [ ] [ARTIFACT] lib-checks.sh 导出全部 7 个 check_step 函数（check_step_2..check_step_8）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');const need=['check_step_2','check_step_3','check_step_4','check_step_5','check_step_6','check_step_7','check_step_8'];if(need.some(n=>!new RegExp(n+'\\\\s*\\\\(\\\\)').test(c)))process.exit(1)"

- [ ] [ARTIFACT] lib-checks.sh 引用 Field Contract 关键字段路径（断言含字符串 `result->>'verdict'` 与 `result->>'applied'` 与 `payload->>'logical_task_id'` 与 `evaluator_worktree_path`）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');const need=[\"result->>'verdict'\",\"result->>'applied'\",\"payload->>'logical_task_id'\",'evaluator_worktree_path'];if(need.some(s=>!c.includes(s)))process.exit(1)"

- [ ] [ARTIFACT] lib-checks.sh 所有 SQL 含 60 分钟时间窗口（防造假）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');if(!c.includes(\"interval '60 minutes'\"))process.exit(1)"

### judge-result.sh

- [ ] [ARTIFACT] `sprints/w8-langgraph-v13/scripts/judge-result.sh` 存在且首行是 bash shebang
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!/^#!.*(bash|sh)/.test(c.split('\n')[0]))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 文件具备可执行权限
  Test: node -e "const s=require('fs').statSync('sprints/w8-langgraph-v13/scripts/judge-result.sh');if(!(s.mode & 0o111))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 含 `set -euo pipefail`
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!c.includes('set -euo pipefail'))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 顶部 source lib-checks.sh（同源约束）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!/source\\s+.*lib-checks\\.sh/.test(c))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 含 PASS / FAIL 字面量分支
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!c.includes('PASS')||!c.includes('FAIL'))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 含 h12-draft.md 字面量（FAIL 路径产出物名）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!c.includes('h12-draft.md'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `sprints/w8-langgraph-v13/tests/ws2/judge-result.test.ts`，覆盖：
- `script file exists and is executable`
- `exits non-zero with usage when called with no args`
- `writes result.md starting with PASS when given pass-fixture evidence`（fixture: `tests/ws2/fixtures/pass/{trace.txt, db-snapshot.json, pr-link.txt}`）
- `writes result.md starting with FAIL and generates h12-draft.md when given fail-fixture evidence`（fixture: `tests/ws2/fixtures/fail/...`）
