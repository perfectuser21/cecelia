---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 部署校验 + acceptance v4 派发 + 14 节点事件流验证 helper + R5 infra health monitor

**范围**: 实现 `scripts/acceptance/w8-v4/lib.mjs` 四函数：`assertBrainImageInSync` / `registerAndDispatchAcceptance` / `waitFor14GraphNodeEvents` / **`monitorAcceptanceTaskHealth`** (R5)
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/acceptance/w8-v4/lib.mjs` 文件存在
  Test: node -e "const fs=require('fs');if(!fs.existsSync('scripts/acceptance/w8-v4/lib.mjs'))process.exit(1)"

- [ ] [ARTIFACT] lib.mjs 导出四个具名函数（原 3 + R5 新增 1）：assertBrainImageInSync / registerAndDispatchAcceptance / waitFor14GraphNodeEvents / monitorAcceptanceTaskHealth
  Test: node -e "import('./scripts/acceptance/w8-v4/lib.mjs').then(m => { for (const fn of ['assertBrainImageInSync','registerAndDispatchAcceptance','waitFor14GraphNodeEvents','monitorAcceptanceTaskHealth']) { if (typeof m[fn] !== 'function') process.exit(1); } })"

- [ ] [ARTIFACT] lib.mjs 内含 14 节点期望列表常量（防止下游 hardcode 漂移）
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/lib.mjs','utf8'); const expected=['prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert','pick_sub_task','run_sub_task','evaluate','advance','retry','terminal_fail','final_evaluate','report']; for(const n of expected){ if(!c.includes('\"'+n+'\"') && !c.includes(\"'\"+n+\"'\")) process.exit(1); }"

- [ ] [ARTIFACT] lib.mjs 内含严格 propose_branch 正则：cp-harness-propose-r[1-9]\d*-[a-f0-9]{8}
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/lib.mjs','utf8'); if(!c.match(/cp-harness-propose-r\[1-9\]\\\\d\*-\[a-f0-9\]\{8\}/)) process.exit(1);"

- [ ] [ARTIFACT] (R5) lib.mjs 内含 'infrastructure_fail' 字面量（registerAndDispatchAcceptance dispatched=false 抛错 + monitorAcceptanceTaskHealth 区分 missing 状态）
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/lib.mjs','utf8'); if(!c.includes('infrastructure_fail')) process.exit(1);"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/acceptance-helper.test.ts`，覆盖：
- `assertBrainImageInSync` 在 brain HEAD ≠ origin/main 时抛错（错误信息含 "stale" / "mismatch" / 真实 commit hash）
- `registerAndDispatchAcceptance` 注册 + dispatch 双调用成功路径返回 task_id；任一 HTTP fail 时抛错
- `waitFor14GraphNodeEvents` 在 14 节点齐全时返回 distinct 列表；缺节点时抛错并指出哪个缺
- `waitFor14GraphNodeEvents` inferTaskPlan branch 不匹配 PR #2837 修后正则时抛错
- **(R5)** `registerAndDispatchAcceptance` 在 dispatched=false 时抛错信息含 `infrastructure_fail` 字面量
- **(R5)** `monitorAcceptanceTaskHealth` 0 rows → status='missing' / 1 row → status='healthy' 且 taskRow 含真实 status 字段
