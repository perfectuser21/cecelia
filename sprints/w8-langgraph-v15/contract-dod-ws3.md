---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: 报告生成器（scripts/v15-report.mjs）

**范围**：Node.js 脚本，读取 `.v15/timeline.log` + DB 查询，写出 `sprints/w8-langgraph-v15/run-report.md`，
含 Verdict/Trinity/Timeline/Initiative State/Failure Node（FAIL 时，含 R1/R2 节点映射）/Generated at。

**大小**：M

**依赖**：WS2（消费 timeline.log）

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/v15-report.mjs` 文件存在
  Test: node -e "require('fs').accessSync('scripts/v15-report.mjs')"

- [ ] [ARTIFACT] 脚本写入 `sprints/w8-langgraph-v15/run-report.md`
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-report.mjs','utf8');if(!c.includes('sprints/w8-langgraph-v15/run-report.md')) process.exit(1)"

- [ ] [ARTIFACT] 脚本含 Verdict 字面量段头
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-report.mjs','utf8');if(!c.includes('## Verdict:')) process.exit(1)"

- [ ] [ARTIFACT] 脚本含 Sprint Trinity Check 字面量段头
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-report.mjs','utf8');if(!c.includes('## Sprint Trinity Check')) process.exit(1)"

- [ ] [ARTIFACT] 脚本含 Generated at 字面量段头
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-report.mjs','utf8');if(!c.includes('## Generated at:')) process.exit(1)"

- [ ] [ARTIFACT] 脚本查询 task_events 表（用于 Failure Node 提取）
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-report.mjs','utf8');if(!c.includes('task_events')) process.exit(1)"

- [ ] [ARTIFACT] 脚本导出 computeVerdict + extractFailureNode + renderReport 三个纯函数
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-report.mjs','utf8');for(const n of ['computeVerdict','extractFailureNode','renderReport']){if(!new RegExp('export\\\\s+(function|const)\\\\s+'+n).test(c)){console.error('missing export:',n);process.exit(1)}}"

- [ ] [ARTIFACT] 脚本含 R1/R2 节点映射字面量（dispatcher_pickup / STUCK_QUEUED / STALL）
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-report.mjs','utf8');for(const s of ['dispatcher_pickup','STUCK_QUEUED','STALL']){if(!c.includes(s)){console.error('missing R1/R2 mapping literal:',s);process.exit(1)}}"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/report.test.ts`，覆盖：
- computeVerdict({task_status:'completed', phase:'done', sub_tasks:[{status:'completed'}]}) === 'PASS'
- computeVerdict({task_status:'failed',    phase:'done', sub_tasks:[{status:'completed'}]}) === 'FAIL'
- computeVerdict({task_status:'completed', phase:'failed', sub_tasks:[{status:'completed'}]}) === 'FAIL'
- computeVerdict({task_status:'completed', phase:'done', sub_tasks:[{status:'failed'}]}) === 'FAIL'
- computeVerdict({task_status:'completed', phase:'done', sub_tasks:[]}) === 'PASS'（无 sub-task 也算 PASS，PRD §absorption 边界条件）
- extractFailureNode(events, []) 选 events 最后一条 error 事件的 payload.node
- extractFailureNode([], []) startsWith 'unknown_node'（兜底）
- extractFailureNode([], [{phase:'STUCK_QUEUED'}]) === 'dispatcher_pickup'（R1）
- extractFailureNode([], [{phase:'STALL@A_contract'}]) === 'A_contract'（R2）
- extractFailureNode(events, [{phase:'STUCK_QUEUED'}]) === 'dispatcher_pickup'（timeline 优先于 events）
- 渲染的 markdown 含 `## Verdict: PASS|FAIL` + `## Sprint Trinity Check` + `## Generated at: ...` + `## Timeline` + `## Initiative State`
