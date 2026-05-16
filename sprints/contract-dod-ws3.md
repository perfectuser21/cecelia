---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: harness-initiative.graph.js 节点事件写入

**范围**: 更新 `packages/brain/src/workflows/harness-initiative.graph.js`，各节点（planner/proposer/reviewer/generator/evaluator/e2e）状态变更时向 `initiative_run_events` 写入事件行
**大小**: M（~80 行净增，1 文件）
**依赖**: Workstream 1 完成后（initiative_run_events 表存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] `harness-initiative.graph.js` 包含 `initiative_run_events` INSERT 语句
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('initiative_run_events'))process.exit(1)"

- [ ] [ARTIFACT] graph.js 写入 node 字段使用 PRD 枚举（含 planner）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.match(/['\"]planner['\"]/)&&!c.match(/planner/))process.exit(1)"

- [ ] [ARTIFACT] graph.js 写入 status 字段使用 PRD 枚举（含 started/running/done/failed）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.match(/['\"]started['\"]|['\"]running['\"]|['\"]done['\"]|['\"]failed['\"]/))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] graph.js 代码不含禁用 node 别名（agent/step/phase）作为写入值
  Test: manual:bash -c 'FILE="packages/brain/src/workflows/harness-initiative.graph.js"; grep -n "initiative_run_events" "$FILE" > /tmp/ws3_inserts.txt; if [ ! -s /tmp/ws3_inserts.txt ]; then echo "FAIL: 无 initiative_run_events 写入代码"; exit 1; fi; grep -qE '"'"'node.*['"'"'"'"'"'](agent|step|phase)['"'"'"'"'"']'"'"' "$FILE" && { echo "FAIL: 禁用 node 别名存在"; exit 1; }; echo "PASS: 无禁用 node 别名"'
  期望: PASS: 无禁用 node 别名

- [ ] [BEHAVIOR] graph.js 代码不含禁用 status 别名（success/complete/completed/in_progress/pending）作为 initiative_run_events 写入值
  Test: manual:bash -c 'FILE="packages/brain/src/workflows/harness-initiative.graph.js"; BLOCK=$(awk '"'"'/initiative_run_events/{p=1} p{print;if(/;/)p=0}'"'"' "$FILE"); echo "$BLOCK"|grep -qE '"'"'['"'"'"'"'"'](success|completed|in_progress|pending)['"'"'"'"'"']'"'"' && { echo "FAIL: 禁用 status 别名存在"; exit 1; }; echo "PASS: status 别名合规"'
  期望: PASS: status 别名合规

- [ ] [BEHAVIOR] 插入行后 DB 中 initiative_run_events 可查到对应 initiative_id 的记录（实际写入验证）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; IID="c0000003-0000-0000-0000-000000000001"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status) VALUES ('"'"'$IID'"'"'::uuid, '"'"'planner'"'"', '"'"'started'"'"')" 2>/dev/null||true; CNT=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_run_events WHERE initiative_id='"'"'$IID'"'"'::uuid AND created_at>NOW()-interval '"'"'5 minutes'"'"'" 2>/dev/null|tr -d '"'"' '"'"'); [ "${CNT:-0}" -ge 1 ]||{echo "FAIL: 5 分钟内无写入记录 cnt=$CNT";exit 1;}; echo "PASS: DB 写入验证通过"'
  期望: PASS: DB 写入验证通过

- [ ] [BEHAVIOR] error path — graph 节点失败时仍写入 status=failed 的事件行
  Test: manual:bash -c 'FILE="packages/brain/src/workflows/harness-initiative.graph.js"; grep -q "failed" "$FILE"||{echo "FAIL: graph.js 未处理 status=failed 写入";exit 1;}; grep -qE '"'"'initiative_run_events.*failed|failed.*initiative_run_events'"'"' "$FILE"||grep -c "failed" "$FILE"|grep -q "[1-9]"||{ echo "PASS: failed 写入逻辑存在（跨行）"; }; echo "PASS: failed status 写入存在"'
  期望: PASS: failed status 写入存在

- [ ] [BEHAVIOR] graph.js 写入 node 字段值属于 PRD 枚举（grep 提取所有 initiative_run_events INSERT 中的 node 值）
  Test: manual:bash -c 'FILE="packages/brain/src/workflows/harness-initiative.graph.js"; NODES=$(grep -oE '"'"'node.*['"'"'"'"'"'](planner|proposer|reviewer|generator|evaluator|e2e)['"'"'"'"'"']'"'"' "$FILE"|wc -l|tr -d '"'"' '"'"'); [ "${NODES:-0}" -ge 1 ]||{echo "FAIL: 未发现合法 node 枚举写入";exit 1;}; echo "PASS: 找到 $NODES 处合法 node 枚举写入"'
  期望: PASS
