---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: verify-checklist.sh + acceptance 报告

**范围**:
- 新建 `scripts/acceptance/w8-v2/verify-checklist.sh`：聚合所有 Golden Path 关键断言（14 节点 distinct + initiative_runs 终态 + thin feature PR merged + 3 故障注入终态 + KR +Δ）
- 新建 `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md`：固定模板含 4 个 H2 段落
- 在 sprint 启动前抓 `sprints/w8-langgraph-v2/kr-snapshot-before.json`（脚本兜底逻辑）
**大小**: M（脚本 100–160 LOC + 报告模板 80–150 行 markdown）
**依赖**: Workstream 2（需要 3 个 fault 跑完后才能聚合）

## ARTIFACT 条目

### verify-checklist.sh

- [ ] [ARTIFACT] 脚本文件存在 + shebang + set -euo pipefail
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/verify-checklist.sh','utf8');if(!/^#!\/bin\/bash/.test(c)||!/set -[eu]+o\s+pipefail/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本含 14 distinct nodeName 计数断言
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/verify-checklist.sh','utf8');if(!/count\\(DISTINCT[^)]*nodeName/.test(c)||!c.includes('14'))process.exit(1)"`

- [ ] [ARTIFACT] 脚本含 thin feature PR merged 校验（gh pr list --state merged）
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/verify-checklist.sh','utf8');if(!/gh pr list[^\\n]+--state merged/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本含 3 个故障注入终态聚合（fault A 子任务 completed + fault B phase=failed/abort + fault C watchdog_overdue）
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/verify-checklist.sh','utf8');for(const k of ['docker_oom_killed','interrupt_resumed','watchdog_overdue']){if(!c.includes(k)){console.error('missing:'+k);process.exit(1)}}"`

- [ ] [ARTIFACT] 脚本含 KR 进度增量校验（before snapshot vs after `/api/brain/okr/current`）
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/verify-checklist.sh','utf8');if(!c.includes('kr-snapshot-before.json')||!c.includes('/api/brain/okr/current')||!c.includes('harness-reliability'))process.exit(1)"`

- [ ] [ARTIFACT] 脚本任一断言失败立即 exit 1（可见的 set -e 或显式 exit 1 处理）
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/verify-checklist.sh','utf8');const exits=(c.match(/exit\\s+1/g)||[]).length;if(exits<3)process.exit(1)"`

- [ ] [ARTIFACT] 脚本 bash 语法合法
  Test: `bash -n scripts/acceptance/w8-v2/verify-checklist.sh`

### Acceptance 报告

- [ ] [ARTIFACT] 报告文件存在
  Test: `node -e "require('fs').accessSync('docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md')"`

- [ ] [ARTIFACT] 报告含固定 4 个 H2 章节：结论 / 14 节点事件计数 / 故障注入终态 / KR 进度增量
  Test: `node -e "const c=require('fs').readFileSync('docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md','utf8');for(const h of ['## 结论','## 14 节点事件计数','## 故障注入终态','## KR 进度增量']){if(!c.includes(h)){console.error('missing:'+h);process.exit(1)}}"`

- [ ] [ARTIFACT] 报告含 fixed UUID 字面量
  Test: `node -e "const c=require('fs').readFileSync('docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md','utf8');if(!c.includes('39d535f3-520a-4a92-a2b6-b31645e11664'))process.exit(1)"`

- [ ] [ARTIFACT] 报告含 14 节点全部 nodeName 列表（用于事件计数表的列）
  Test: `node -e "const c=require('fs').readFileSync('docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md','utf8');for(const n of ['prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert','pick_sub_task','run_sub_task','evaluate','advance','retry','terminal_fail','final_evaluate','report']){if(!c.includes(n)){console.error('missing node:'+n);process.exit(1)}}"`

- [ ] [ARTIFACT] 报告含 3 个故障注入子节标题（场景 A / 场景 B / 场景 C）
  Test: `node -e "const c=require('fs').readFileSync('docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md','utf8');for(const k of ['场景 A','场景 B','场景 C']){if(!c.includes(k)){console.error('missing:'+k);process.exit(1)}}"`

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/verify-and-report.test.ts`，覆盖：
- verify-checklist.sh 结构性 smoke + 5 段断言（14节点 / PR merged / 3 fault terminal / KR / 退出码语义）
- 报告模板 4 个 H2 段落 + 14 节点列表 + 3 故障场景章节
- 报告含 fixed UUID 字面量
- KR 快照逻辑兜底：脚本启动时若快照缺失则当场抓
