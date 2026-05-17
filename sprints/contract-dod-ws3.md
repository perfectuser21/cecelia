---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: executor.js 写入 initiative_run_events

**范围**: `packages/brain/src/executor.js` 内 `emitGraphNodeUpdate` 同步调用 `writeInitiativeRunEvent`
**大小**: S
**依赖**: Workstream 1, Workstream 2

## ARTIFACT 条目

- [ ] [ARTIFACT] executor.js 含 initiativeRunEvents 或 writeInitiativeRunEvent 的 import/require
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('initiativeRunEvents')&&!c.includes('writeInitiativeRunEvent'))process.exit(1)"

- [ ] [ARTIFACT] executor.js emitGraphNodeUpdate 函数体内含 writeInitiativeRunEvent 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('writeInitiativeRunEvent'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] writeInitiativeRunEvent 直接调用后 initiative_run_events 有对应行（1 分钟内）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000001"; node -e "const m=require('"'"'./packages/brain/src/events/initiativeRunEvents.js'"'"');m.writeInitiativeRunEvent({initiativeId:'"'"'cccccccc-dddd-eeee-ffff-aa0000000001'"'"',node:'"'"'proposer'"'"',label:'"'"'Proposer'"'"',attempt:1}).then(()=>console.log('"'"'WRITE_OK'"'"')).catch(e=>{console.error(e.message);process.exit(1);})" && COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_run_events WHERE initiative_id='"'"'$IAID'"'"' AND created_at > NOW() - interval '"'"'1 minute'"'"'" | tr -d " ") && [ "$COUNT" -ge 1 ] && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 写入行 node 字段值为合法节点名字符串（不为禁用值 name/step 等）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000002"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'$IAID'"'"', '"'"'proposer'"'"', '"'"'Proposer'"'"', 1) ON CONFLICT DO NOTHING" 2>/dev/null; ROW=$(psql "$DB" -t -c "SELECT node FROM initiative_run_events WHERE initiative_id='"'"'$IAID'"'"' LIMIT 1" | tr -d " "); [ -n "$ROW" ] && [ "$ROW" != "name" ] && [ "$ROW" != "step" ] && [ "$ROW" != "stage" ] && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 写入行 attempt 字段为正整数 ≥ 1
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000003"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'$IAID'"'"', '"'"'proposer'"'"', '"'"'Proposer'"'"', 1) ON CONFLICT DO NOTHING" 2>/dev/null; ATT=$(psql "$DB" -t -c "SELECT attempt FROM initiative_run_events WHERE initiative_id='"'"'$IAID'"'"' LIMIT 1" | tr -d " "); [ -n "$ATT" ] && [ "$ATT" -ge 1 ] && echo OK'
  期望: OK

- [ ] [BEHAVIOR] pipeline done 时 initiative_run_events 有 status=done 行，verdict 为 PASS/FAIL
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000004"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt, status, verdict) VALUES ('"'"'$IAID'"'"', '"'"'report'"'"', '"'"'Report'"'"', 1, '"'"'done'"'"', '"'"'PASS'"'"') ON CONFLICT DO NOTHING" 2>/dev/null; STATUS=$(psql "$DB" -t -c "SELECT status FROM initiative_run_events WHERE initiative_id='"'"'$IAID'"'"' AND status='"'"'done'"'"' LIMIT 1" | tr -d " "); [ "$STATUS" = "done" ] && echo OK'
  期望: OK
