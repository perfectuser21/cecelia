---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: register-and-dispatch.sh

**范围**: 在 `scripts/acceptance/w8-v2/` 下新建 `register-and-dispatch.sh`，承担 W8 Acceptance 第一步：清理 fixed-UUID 残留 → 注册 harness_initiative task → dispatch → tail task_events 到 happy path 终态。
**大小**: M（130–180 LOC）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 脚本文件存在
  Test: `node -e "require('fs').accessSync('scripts/acceptance/w8-v2/register-and-dispatch.sh')"`

- [ ] [ARTIFACT] 脚本以 `#!/bin/bash` 开头并启用 `set -euo pipefail`
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/register-and-dispatch.sh','utf8');if(!/^#!\/bin\/bash/.test(c)||!/set -[eu]+o\s+pipefail/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本含 fixed UUID 清理 SQL（DELETE 或 UPDATE … completed_at=NOW() WHERE initiative_id='39d535f3-…'）
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/register-and-dispatch.sh','utf8');if(!c.includes('39d535f3-520a-4a92-a2b6-b31645e11664')||!/DELETE FROM|UPDATE\\s+initiative_runs/i.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本通过 `curl -f -X POST localhost:5221/api/brain/tasks` 注册任务
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/register-and-dispatch.sh','utf8');if(!/curl[^\\n]*-f[^\\n]*-X POST[^\\n]*\\/api\\/brain\\/tasks/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本调用 dispatch endpoint `/api/brain/tasks/.+/dispatch`
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/register-and-dispatch.sh','utf8');if(!/\\/api\\/brain\\/tasks\\/[^\\s]*\\/dispatch/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本注册 payload 含 `sprint_dir=sprints/w8-langgraph-v2` + thin_features + budget_usd + timeout_sec
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/register-and-dispatch.sh','utf8');for(const k of ['sprints/w8-langgraph-v2','budget_usd','timeout_sec','thin_features']){if(!c.includes(k)){console.error('missing:'+k);process.exit(1)}}"`

- [ ] [ARTIFACT] 脚本含 task_events tail 段（轮询 graph_node_update 并落 dispatch.log）
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/register-and-dispatch.sh','utf8');if(!/graph_node_update/.test(c)||!/dispatch\\.log/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本结尾 echo `DISPATCH_COMPLETE: phase=...`
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/register-and-dispatch.sh','utf8');if(!/DISPATCH_COMPLETE:\\s*phase=/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 bash 语法合法
  Test: `bash -n scripts/acceptance/w8-v2/register-and-dispatch.sh`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/register-dispatch.test.ts`，覆盖：
- 脚本结构性 smoke：可读、可执行（chmod +x）
- 关键 curl/psql 命令存在（不真跑活 Brain，仅静态扫描脚本）
- bash -n 语法合法（subprocess 调用）
- 含 fixed UUID 字面量、sprint_dir、thin_features 三关键 token
- 含 dispatch endpoint 且 curl 含 `-f` flag（保证 HTTP 5xx 时 exit 非 0）
