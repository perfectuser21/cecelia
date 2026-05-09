---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 1: collect-evidence 脚本

**范围**: 实现 `sprints/w8-langgraph-v13/scripts/collect-evidence.sh`，负责触发后等待 + 抽取 trace/db-snapshot/pr-link 三件证据，并落 R3 (brain_boot_time) / R5 (inconclusive.flag) 两类 evidence 文件契约。
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v13/scripts/collect-evidence.sh` 存在且首行是 `#!/usr/bin/env bash` 或 `#!/bin/bash`
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh','utf8');if(!/^#!.*(bash|sh)/.test(c.split('\n')[0]))process.exit(1)"

- [ ] [ARTIFACT] 脚本文件具备可执行权限
  Test: node -e "const s=require('fs').statSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh');if(!(s.mode & 0o111))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 `set -uo pipefail` 严格模式（不带 -e — collect-evidence 命中 R5 关键字时仍要 exit 0 让 judge-result 接管裁决）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh','utf8');if(!c.includes('set -uo pipefail'))process.exit(1)"

- [ ] [ARTIFACT] 脚本声明 7 节点签名常量（plan/propose/review/spawn/generator/evaluator/absorption）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh','utf8');const need=['plan','propose','review','spawn','generator','evaluator','absorption'];if(need.some(n=>!c.includes(n)))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 R3 boot_time 抓取逻辑（含字面量 `brain_boot_time_pre` 与 `brain_boot_time_post`）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh','utf8');if(!c.includes('brain_boot_time_pre')||!c.includes('brain_boot_time_post'))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 R5 breaker OPEN / credentials 关键字检测（含字面量 `inconclusive.flag` 与 `breaker` 与 `credentials`）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh','utf8');const need=['inconclusive.flag','breaker','credentials'];if(need.some(n=>!c.includes(n)))process.exit(1)"

- [ ] [ARTIFACT] 脚本 db-snapshot 抓取含 R4 标签硬过滤（字面量 `'w8-v13'` 出现）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh','utf8');if(!c.includes(\"'w8-v13'\"))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/w8-langgraph-v13/tests/ws1/collect-evidence.test.ts`，覆盖：
- 缺参时 exit 1 且 stderr 含 usage
- DRY_RUN=1 且带参数时 exit 0 且 stdout 含计划三件产出物名
- DRY_RUN=1 计划 stdout 含 R3 关键字 `brain_boot_time` 与 R5 关键字 `breaker OPEN`（断言新 mitigation 在 dry-run 下也可见）
