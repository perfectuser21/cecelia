---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 1: collect-evidence 脚本

**范围**: 实现 `sprints/w8-langgraph-v13/scripts/collect-evidence.sh`，负责触发后等待 + 抽取 trace/db-snapshot/pr-link 三件证据。
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v13/scripts/collect-evidence.sh` 存在且首行是 `#!/usr/bin/env bash` 或 `#!/bin/bash`
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh','utf8');if(!/^#!.*(bash|sh)/.test(c.split('\n')[0]))process.exit(1)"

- [ ] [ARTIFACT] 脚本文件具备可执行权限
  Test: node -e "const s=require('fs').statSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh');if(!(s.mode & 0o111))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 `set -euo pipefail` 严格模式
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh','utf8');if(!c.includes('set -euo pipefail'))process.exit(1)"

- [ ] [ARTIFACT] 脚本声明 7 节点签名常量（plan/propose/review/spawn/generator/evaluator/absorption）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v13/scripts/collect-evidence.sh','utf8');const need=['plan','propose','review','spawn','generator','evaluator','absorption'];if(need.some(n=>!c.includes(n)))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/w8-langgraph-v13/tests/ws1/collect-evidence.test.ts`，覆盖：
- 缺参时 exit 1 且 stderr 含 usage
- DRY_RUN=1 且带参数时 exit 0 且 stdout 含计划三件产出物名
- 主流程不实际调 brain 时（DRY_RUN=1）不应产生外部副作用
