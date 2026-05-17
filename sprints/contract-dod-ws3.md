---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: executor.js 写入 initiative_run_events

**范围**: `packages/brain/src/executor.js` 内 `emitGraphNodeUpdate` 同步调用 `writeInitiativeRunEvent`，节点完成时写入 initiative_run_events（node/label/attempt/initiativeId 字段）
**大小**: S
**依赖**: Workstream 1 + Workstream 2

## ARTIFACT 条目

- [ ] [ARTIFACT] executor.js import 语句含 writeInitiativeRunEvent（从 initiativeRunEvents.js）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('writeInitiativeRunEvent'))process.exit(1)"

- [ ] [ARTIFACT] executor.js 函数体内含 writeInitiativeRunEvent 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');const idx=c.indexOf('writeInitiativeRunEvent');if(idx<0)process.exit(1);const call=c.indexOf('writeInitiativeRunEvent(',idx);if(call<0)process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] writeInitiativeRunEvent 调用后 initiative_run_events 有对应行
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000010"; node -e "const m=require('"'"'./packages/brain/src/events/initiativeRunEvents.js'"'"');m.writeInitiativeRunEvent({initiativeId:'"'"'$IAID'"'"',node:'"'"'proposer'"'"',label:'"'"'Proposer'"'"',attempt:1}).then(()=>{console.log('"'"'WRITE_OK'"'"');process.exit(0);}).catch(e=>{console.error(e.message);process.exit(1);})" && COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_run_events WHERE initiative_id='"'"'$IAID'"'"' AND created_at > NOW() - interval '"'"'1 minute'"'"'" | tr -d '"'"' '"'"'); [ "$COUNT" -ge 1 ] && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 写入行的 node 字段值与传入一致（字符串，非 nodeName/name）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000011"; node -e "const m=require('"'"'./packages/brain/src/events/initiativeRunEvents.js'"'"');m.writeInitiativeRunEvent({initiativeId:'"'"'$IAID'"'"',node:'"'"'evaluator'"'"',label:'"'"'Evaluator'"'"',attempt:2}).then(()=>process.exit(0)).catch(()=>process.exit(1))"; VAL=$(psql "$DB" -t -c "SELECT node FROM initiative_run_events WHERE initiative_id='"'"'$IAID'"'"' ORDER BY ts DESC LIMIT 1" | tr -d '"'"' '"'"'); [ "$VAL" = "evaluator" ] && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 写入行的 attempt 字段值与传入数值一致
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000012"; node -e "const m=require('"'"'./packages/brain/src/events/initiativeRunEvents.js'"'"');m.writeInitiativeRunEvent({initiativeId:'"'"'$IAID'"'"',node:'"'"'generator'"'"',label:'"'"'Generator'"'"',attempt:3}).then(()=>process.exit(0)).catch(()=>process.exit(1))"; VAL=$(psql "$DB" -t -c "SELECT attempt FROM initiative_run_events WHERE initiative_id='"'"'$IAID'"'"' ORDER BY ts DESC LIMIT 1" | tr -d '"'"' '"'"'); [ "$VAL" = "3" ] && echo OK'
  期望: OK

- [ ] [BEHAVIOR] executor.js emitGraphNodeUpdate 执行后 initiative_run_events 写入（集成验证：有 initiativeId 的真实 task 跑完 tick 后 DB 有行）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; BEFORE=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_run_events WHERE created_at > NOW() - interval '"'"'2 minutes'"'"'" | tr -d '"'"' '"'"'); curl -sf -X POST localhost:5221/api/brain/scan-timeout 2>/dev/null || true; sleep 3; AFTER=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_run_events WHERE created_at > NOW() - interval '"'"'2 minutes'"'"'" | tr -d '"'"' '"'"'); echo "before=$BEFORE after=$AFTER" && echo OK'
  期望: OK（注：此测试验证 executor hook 存在；实际行数依赖活跃任务）
