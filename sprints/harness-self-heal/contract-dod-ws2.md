---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: harness-container-monitor.js + tick-runner.js 注册

**范围**: 新建 `packages/brain/src/harness-container-monitor.js`（容器健康检查 + dispatch + 幂等 + Bark + cecelia_events）；`tick-runner.js` 注册 30s 节拍（MINIMAL_MODE 守护）
**大小**: M（~170 行净增，2 文件）
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/harness-container-monitor.js` 存在，导出 `checkHarnessContainers` 和 `createInterventionTask`
  Test: node --input-type=module -e "const m=await import('./packages/brain/src/harness-container-monitor.js');if(typeof m.checkHarnessContainers!=='function'||typeof m.createInterventionTask!=='function')process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `checkHarnessContainers` 函数签名接受 `opts: { pool, dockerUnavailable?: boolean }` 参数对象（测试可注入 dockerUnavailable:true 跳过真实 docker 调用）
  Test: node --input-type=module -e "const {checkHarnessContainers}=await import('./packages/brain/src/harness-container-monitor.js');const res=await checkHarnessContainers({pool:{query:()=>Promise.resolve({rows:[]})},dockerUnavailable:true});console.log('OK signature accepted')" || { echo "FAIL: 函数签名不接受 {pool,dockerUnavailable} 对象"; exit 1; }

- [ ] [ARTIFACT] `packages/brain/src/tick-runner.js` 包含 `harness-container-monitor` import 调用
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(!s.includes('harness-container-monitor'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] checkHarnessContainers 函数可调用且不抛异常（docker 不可用时 warn 不 throw）
  Test: manual:bash -c 'node --input-type=module -e "const {checkHarnessContainers}=await import(\"./packages/brain/src/harness-container-monitor.js\");if(typeof checkHarnessContainers!==\"function\"){process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] createInterventionTask 向 DB tasks 表写入 harness_intervention 记录（带时间窗口防造假）
  Test: manual:bash -c 'DB=${DB_URL:-postgresql://localhost/cecelia}; TEST_INIT=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id, phase, started_at, deadline_at) VALUES (gen_random_uuid(), '\''B_task_loop'\'', NOW(), NOW() + interval '\''2 hours'\'') RETURNING initiative_id" | tr -d " \n"); node --input-type=module -e "const {createInterventionTask}=await import(\"./packages/brain/src/harness-container-monitor.js\");const pool=(await import(\"./packages/brain/src/db.js\")).default;await createInterventionTask(pool,{initiativeId:\"${TEST_INIT}\",reason:\"test\",anomalyType:\"exited\"});" && COUNT=$(psql $DB -t -c "SELECT count(*) FROM tasks WHERE task_type='\''harness_intervention'\'' AND payload::text LIKE '\''%${TEST_INIT}%'\'' AND created_at > NOW() - interval '\''5 minutes'\''" | tr -d " \n") && [ "$COUNT" -ge 1 ] && echo "OK count=$COUNT" || { echo "FAIL: DB 无记录"; exit 1; }'
  期望: OK count≥1（exit 0）

- [ ] [BEHAVIOR] 幂等保护：同 initiative 重复调用 createInterventionTask 返回 skipped:true
  Test: manual:bash -c 'DB=${DB_URL:-postgresql://localhost/cecelia}; TEST_INIT=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id, phase, started_at, deadline_at) VALUES (gen_random_uuid(), '\''B_task_loop'\'', NOW(), NOW() + interval '\''2 hours'\'') RETURNING initiative_id" | tr -d " \n"); node --input-type=module -e "const {createInterventionTask}=await import(\"./packages/brain/src/harness-container-monitor.js\");const pool=(await import(\"./packages/brain/src/db.js\")).default;await createInterventionTask(pool,{initiativeId:\"${TEST_INIT}\",reason:\"first\",anomalyType:\"exited\"});const r=await createInterventionTask(pool,{initiativeId:\"${TEST_INIT}\",reason:\"dup\",anomalyType:\"exited\"});if(!r||r.skipped!==true){console.error(\"FAIL skipped=\"+r?.skipped);process.exit(1);}console.log(\"OK idempotent\");"'
  期望: OK idempotent（exit 0）

- [ ] [BEHAVIOR] monitor 在 harness-container-monitor.js 中集成 cecelia_events 写入（intervention_result）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/src/harness-container-monitor.js\",\"utf8\");if(!s.includes(\"cecelia_events\")){console.error(\"FAIL: 缺 cecelia_events 写入\");process.exit(1);}if(!s.includes(\"intervention_result\")){console.error(\"FAIL: 缺 event_type intervention_result\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] tick-runner.js MINIMAL_MODE 守护 + 30s 间隔配置
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/src/tick-runner.js\",\"utf8\");if(!s.includes(\"harness-container-monitor\")){console.error(\"FAIL: 未注册\");process.exit(1);}if(!s.match(/CONTAINER_MONITOR_INTERVAL_MS|lastContainerMonitor/)){console.error(\"FAIL: 缺间隔变量\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] Bark→飞书→cecelia_events 三级降级告警链：monitor 文件含 BARK_TOKEN + FEISHU_WEBHOOK/feishu/lark + cecelia_events 三处实现证据
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/src/harness-container-monitor.js\",\"utf8\");if(!s.match(/BARK_TOKEN|bark|sendBark/i)){console.error(\"FAIL: 缺 Bark 告警集成（第1级）\");process.exit(1);}if(!s.match(/FEISHU_WEBHOOK|feishu|lark/i)){console.error(\"FAIL: 缺飞书中间层集成（第2级，Generator 可合法跳过）\");process.exit(1);}if(!s.includes(\"cecelia_events\")){console.error(\"FAIL: 缺 cecelia_events 降级兜底（第3级）\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] error path — Bark + 飞书均失败/未配置时降级写 cecelia_events（告警链末端不丢告警）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/src/harness-container-monitor.js\",\"utf8\");if(!s.match(/intervention_alert_fallback|alert.*fallback|fallback.*alert/i)&&!s.includes(\"cecelia_events\")){console.error(\"FAIL: 缺 cecelia_events 降级写入，告警链可能断裂\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）
