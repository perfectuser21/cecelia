---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 2: lib-checks 函数库 + judge-result 脚本

**范围**:
- (a) `sprints/w8-langgraph-v13/scripts/lib-checks.sh` — 导出 `check_step_2..check_step_8` 函数；E2E 脚本与 judge-result.sh 同源消费；所有 SQL 三联硬过滤（parent_task_id + 60min + tags）。
- (b) `sprints/w8-langgraph-v13/scripts/judge-result.sh` — 顶部 `source ./lib-checks.sh`，按三态裁决树（INCONCLUSIVE / PASS / FAIL）写 `result.md`，FAIL 时同时写 `h12-draft.md` 含全部红 step 列表与首红 step 标注。

**大小**: M
**依赖**: Workstream 1

## ARTIFACT 条目

### lib-checks.sh

- [ ] [ARTIFACT] `sprints/w8-langgraph-v13/scripts/lib-checks.sh` 存在且首行是 `#!/usr/bin/env bash` 或 `#!/bin/bash`
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');if(!/^#!.*(bash|sh)/.test(c.split('\n')[0]))process.exit(1)"

- [ ] [ARTIFACT] lib-checks.sh 含 `set -u`（不要 `-e` 以免函数失败直接退出 source 它的脚本，破坏 R1 cascade 防护）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');if(!c.includes('set -u'))process.exit(1)"

- [ ] [ARTIFACT] lib-checks.sh 导出全部 7 个 check_step 函数（check_step_2..check_step_8）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');const need=['check_step_2','check_step_3','check_step_4','check_step_5','check_step_6','check_step_7','check_step_8'];if(need.some(n=>!new RegExp(n+'\\\\s*\\\\(\\\\)').test(c)))process.exit(1)"

- [ ] [ARTIFACT] lib-checks.sh 引用 Field Contract 关键字段路径（断言含字符串 `result->>'verdict'` 与 `result->>'applied'` 与 `payload->>'logical_task_id'` 与 `evaluator_worktree_path`）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');const need=[\"result->>'verdict'\",\"result->>'applied'\",\"payload->>'logical_task_id'\",'evaluator_worktree_path'];if(need.some(s=>!c.includes(s)))process.exit(1)"

- [ ] [ARTIFACT] lib-checks.sh 所有 SQL 含 60 分钟时间窗口（防造假 + 时间隔离）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');if(!c.includes(\"interval '60 minutes'\"))process.exit(1)"

- [ ] [ARTIFACT] lib-checks.sh 所有 SQL 含 R4 标签硬过滤（字面量 `payload->'tags' ?| array['w8-v13']`）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');if(!c.includes(\"payload->'tags' ?| array['w8-v13']\"))process.exit(1)"

- [ ] [ARTIFACT] lib-checks.sh check_step_8 实现含 R3/R5 三态判决关键字（字面量 `INCONCLUSIVE` 与 `inconclusive.flag` 与 `brain_boot_time_pre` 同时出现）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/lib-checks.sh','utf8');const need=['INCONCLUSIVE','inconclusive.flag','brain_boot_time_pre'];if(need.some(s=>!c.includes(s)))process.exit(1)"

### judge-result.sh

- [ ] [ARTIFACT] `sprints/w8-langgraph-v13/scripts/judge-result.sh` 存在且首行是 bash shebang
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!/^#!.*(bash|sh)/.test(c.split('\n')[0]))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 文件具备可执行权限
  Test: node -e "const s=require('fs').statSync('sprints/w8-langgraph-v13/scripts/judge-result.sh');if(!(s.mode & 0o111))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 含 `set -uo pipefail`（不要 -e — judge 的 FAIL 路径需要继续跑下去把所有红 step 列出来才 exit 1）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!c.includes('set -uo pipefail'))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 顶部 source lib-checks.sh（同源约束）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');if(!/source\\s+.*lib-checks\\.sh/.test(c))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 含三态裁决字面量（PASS / FAIL / INCONCLUSIVE 三个均出现）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');const need=['PASS','FAIL','INCONCLUSIVE'];if(need.some(s=>!c.includes(s)))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 含 h12-draft.md 与 First Red Step 字面量（FAIL 路径产出物 + 修复入口标注）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');const need=['h12-draft.md','First Red Step','Failed Steps'];if(need.some(s=>!c.includes(s)))process.exit(1)"

- [ ] [ARTIFACT] judge-result.sh 含 R3/R5 evidence 文件契约字面量（`inconclusive.flag` 与 `brain_boot_time_pre` 与 `brain_boot_time_post`）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/judge-result.sh','utf8');const need=['inconclusive.flag','brain_boot_time_pre','brain_boot_time_post'];if(need.some(s=>!c.includes(s)))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `sprints/w8-langgraph-v13/tests/ws2/judge-result.test.ts`，覆盖：
- `script file exists and is executable`
- `exits non-zero with usage when called with no args`
- `writes result.md starting with PASS when given pass-fixture evidence`（fixture: `tests/ws2/fixtures/pass/`）
- `writes result.md starting with FAIL with all-red-steps list and h12-draft.md marks first-red-step (R1)`（fixture: `tests/ws2/fixtures/fail/`）
- `writes result.md starting with INCONCLUSIVE when inconclusive.flag exists (R5)`（fixture: `tests/ws2/fixtures/inconclusive/`）
- `writes result.md starting with INCONCLUSIVE when trace.txt boot_time crosses (R3)`（fixture: `tests/ws2/fixtures/boot-cross/`）
