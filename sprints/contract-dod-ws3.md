---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Executor 写入 initiative_run_events

**范围**: harness executor 相关文件新增 `writeInitiativeRunEvent` 调用，在各节点入口（status=running）/出口（status=done/failed）写入 initiative_run_events 事件行（无 label 字段）
**大小**: S
**依赖**: Workstream 1 + Workstream 2

## ARTIFACT 条目

- [ ] [ARTIFACT] executor 文件含 writeInitiativeRunEvent 调用
  Test: node -e "const fs=require('fs');const candidates=['packages/brain/src/executor.js'];const found=candidates.some(f=>{try{const c=fs.readFileSync(f,'utf8');return c.includes('writeInitiativeRunEvent')}catch{return false}});if(!found)process.exit(1)"

- [ ] [ARTIFACT] executor 文件 import/require initiativeRunEvents
  Test: node -e "const fs=require('fs');const candidates=['packages/brain/src/executor.js'];const found=candidates.some(f=>{try{const c=fs.readFileSync(f,'utf8');return c.includes('initiativeRunEvents')}catch{return false}});if(!found)process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] writeInitiativeRunEvent 可直接调用（node/status/attempt/initiativeId），写入成功
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="dddddddd-eeee-ffff-aaaa-bb0000000001"; node -e "const m=require('"'"'./packages/brain/src/events/initiativeRunEvents.js'"'"');m.writeInitiativeRunEvent({initiativeId:'"'"'$IAID'"'"',node:'"'"'proposer'"'"',status:'"'"'running'"'"',attempt:1}).then(()=>{console.log('"'"'WRITE_OK'"'"');process.exit(0);}).catch(e=>{console.error(e.message);process.exit(1);})" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 写入后 DB 有对应行，ts 字段为 BIGINT（≥ 1000000000）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="dddddddd-eeee-ffff-aaaa-bb0000000002"; node -e "const m=require('"'"'./packages/brain/src/events/initiativeRunEvents.js'"'"');m.writeInitiativeRunEvent({initiativeId:'"'"'$IAID'"'"',node:'"'"'reviewer'"'"',status:'"'"'running'"'"',attempt:1}).then(()=>process.exit(0)).catch(()=>process.exit(1))"; TS=$(psql "$DB" -t -c "SELECT ts FROM initiative_run_events WHERE initiative_id='"'"'$IAID'"'"' ORDER BY id DESC LIMIT 1" | tr -d '"'"' '"'"'); [ "$TS" -ge 1000000000 ] && echo OK'
  期望: OK

- [ ] [BEHAVIOR] DB 表不含 label 列（label 是 PRD 禁用字段）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; COL=$(psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='"'"'initiative_run_events'"'"' AND column_name='"'"'label'"'"'" | tr -d '"'"' '"'"'); [ -z "$COL" ] && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 写入 status=done 行后 SSE 端点推出对应 node_update（status=done）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="dddddddd-eeee-ffff-aaaa-bb0000000003"; node -e "const m=require('"'"'./packages/brain/src/events/initiativeRunEvents.js'"'"');m.writeInitiativeRunEvent({initiativeId:'"'"'$IAID'"'"',node:'"'"'generator'"'"',status:'"'"'done'"'"',attempt:1}).then(()=>process.exit(0)).catch(()=>process.exit(1))"; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed "s/^data: //"); echo "$DATA" | jq -e ".status==\"done\"" && echo OK'
  期望: OK
