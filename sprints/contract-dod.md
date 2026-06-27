---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: mac_web generator/evaluator host 逃逸端到端验证（Slice4 修复确认）

**范围**: 验证 PR #3461（Slice4 透传 gap）已生效：`runSubTaskNode` 透传 `target_environment=mac_web`，generator/evaluator 走 `executeOnHost`（非 Docker），任务在 120s 内到达终态（不卡死）
**大小**: S（仅验证，无代码变更）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/e2e-verify-report.json` 存在且 `status = "PASS"`
  Test: node -e "const r=JSON.parse(require('fs').readFileSync('sprints/e2e-verify-report.json','utf8'));if(r.status!=='PASS'){process.exit(1);}console.log('OK')"

- [ ] [ARTIFACT] `sprints/tests/mac-web-pipeline-verify.test.ts` 存在且包含 Slice4 fix 断言
  Test: node -e "const c=require('fs').readFileSync('sprints/tests/mac-web-pipeline-verify.test.ts','utf8');if(!c.includes('target_environment')||!c.includes('Slice4'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

### 逻辑断言（环境无关，CI/单测验 = 真 done）

- [ ] [BEHAVIOR] Slice4 fix：runSubTaskNode 源码透传 target_environment（代码层验证）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");const fn=s.match(/export async function runSubTaskNode[\s\S]*?\n\}/);if(!fn||!/target_environment:\s*state\.task\??\\.payload\??\\.target_environment/.test(fn[0])){process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] harness-task.graph.js 含 mac_web → executeOnHost 分支（代码层验证）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-task.graph.js\",\"utf8\");if(!s.includes(\"targetEnv === '\''mac_web'\''\"))process.exit(1);if(!s.includes(\"executeOnHost\"))process.exit(2);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 回归单测 harness-task-evaluator-host-routing.test.js 全 PASS（code routing 回归）
  Test: manual:bash -c 'npx vitest run packages/brain/src/workflows/__tests__/harness-task-evaluator-host-routing.test.js packages/brain/src/workflows/__tests__/runSubTaskNode-payload.test.js --reporter=verbose 2>&1 | tail -5; [ ${PIPESTATUS[0]} -eq 0 ] || exit 1; echo OK'
  期望: OK（0 failures）

### 接缝断言（环境相关，需 Brain + psql 在线；未真验标 logic-done-pending）

- [ ] [BEHAVIOR] POST harness_task（target_environment=mac_web）到 Brain 5221 → HTTP 200 + 返回 task_id（接缝）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"title\":\"smoke\",\"task_type\":\"harness_task\",\"payload\":{\"target_environment\":\"mac_web\",\"sprint_dir\":\"sprints/\"}}") || exit 1; echo "$RESP" | jq -e ".id | type == \"string\"" || exit 1; echo OK'
  期望: OK（需 Brain 在线；Brain 不可达 → logic-done-pending）

- [ ] [BEHAVIOR] executeOnHost 被真实调用：/tmp/cecelia-host-prompts/ 有新 .host.prompt 文件（接缝）
  Test: manual:bash -c 'TASK_ID=$1; ls /tmp/cecelia-host-prompts/ 2>/dev/null | grep "${TASK_ID}.*host\.prompt" || { echo "FAIL: host.prompt 未出现"; exit 1; }; echo OK'
  期望: OK（需 Brain tick 派发 + mac_web 路由生效；未真验 → logic-done-pending）

- [ ] [BEHAVIOR] harness_task（target_environment=mac_web）在 120s 内离开 running 状态（接缝）
  Test: manual:bash -c 'TASK_ID=$1; DB=${DB_URL:-cecelia}; for i in $(seq 1 120); do S=$(psql $DB -t -c "SELECT status FROM tasks WHERE id='"'"'${TASK_ID}'"'"'" 2>/dev/null | tr -d " \n"); [ "$S" = "completed" ] || [ "$S" = "failed" ] && { echo "OK: status=$S"; exit 0; }; sleep 1; done; echo "FAIL: 120s 后仍 running"; exit 1'
  期望: OK: status=completed 或 OK: status=failed（需 psql cecelia 可达；未真验 → logic-done-pending）

- [ ] [BEHAVIOR] e2e-verify-report.json status=PASS（全链路 E2E 通过后由脚本写入）
  Test: manual:bash -c 'node -e "const r=JSON.parse(require(\"fs\").readFileSync(\"sprints/e2e-verify-report.json\",\"utf8\"));if(r.status!==\"PASS\"){console.error(\"FAIL:\",r);process.exit(1);}console.log(\"OK: status=PASS task_id=\"+r.task_id)"'
  期望: OK: status=PASS task_id=<uuid>（需完整 E2E 脚本成功执行后）
