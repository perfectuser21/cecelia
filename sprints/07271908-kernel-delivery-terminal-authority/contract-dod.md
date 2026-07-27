---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel Delivery Terminal Authority

**范围**: Merge 后 S10-S12 delivery 状态机、staging result gate、production promote/attestation、final report completion gate。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增 delivery terminal authority 模块，导出 S10-S12 单一状态机函数。
  Test: node -e "const fs=require('fs');const p='packages/brain/src/delivery-terminal-authority.js';const c=fs.readFileSync(p,'utf8');for(const s of ['createDeliveryFromMerge','applyStagingResult','applyProductionResult','applyCustomerConfirmation','applyCustomerAttestation','persistFinalReportAndComplete','replayDeliveryEvent','auditLegacyCompletionFixture']){if(!c.includes(s))process.exit(1)}"

- [ ] [ARTIFACT] DB migration 新增 harness_deliveries / harness_delivery_events，并扩展 initiative_runs.phase CHECK 支持 delivery 非终态。
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations').filter(f=>/delivery|terminal|staging|initiative/i.test(f));const body=files.map(f=>fs.readFileSync('packages/brain/migrations/'+f,'utf8')).join('\n');for(const s of ['harness_deliveries','harness_delivery_events','idempotency_key','delivery_id','delivery/staging_pending','staging_blocked','report_failed']){if(!body.includes(s))process.exit(1)}"

- [ ] [ARTIFACT] Existing promote route uses approver authentication before DB mutation.
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/authenticateApprover/.test(c)||!/x-approver-token|HARNESS_REVIEW_APPROVER_TOKEN/.test(c))process.exit(1)"

- [ ] [ARTIFACT] Contract red tests exist and include production fixtures PR4327/PR4317 plus all DoD behavior coverage names.
  Test: node -e "const fs=require('fs');const p='sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts';const c=fs.readFileSync(p,'utf8');for(const s of ['PR4327','PR4317','delivery/staging_pending','external_ack_pending','delivery status endpoint schema keys 完整且禁用字段不存在','delivery status invalid id error path 返回 400 + error 字段','staging PASS 且 tested_sha 等于 merged_sha 后才可 promote','Promote API 必须认证 approver']){if(!c.includes(s))process.exit(1)}"

- [ ] [ARTIFACT] Contract red tests 不 mock 本单禁 mock 边。
  Test: node -e "const fs=require('fs');const p='sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts';const c=fs.readFileSync(p,'utf8');if(/\\bvi\\.mock\\b|\\bjest\\.mock\\b|sinon\\.stub|\\bstub\\(/.test(c))process.exit(1);for(const s of ['psql','harness_deliveries','harness_delivery_events','initiative_runs']){if(!c.includes(s))process.exit(1)}"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] [L2] INV-14 INV-23 INV-43 Merge 后 parent 进入 delivery/staging_pending 且 staging child 绑定 merge manifest
  动作: 以 merged PR 的 delivery_id 查询真实 Brain delivery status。
  预期观察: parent run phase 为 delivery/staging_pending，parent task 未 completed，merged/head SHA、contract_manifest_digest、target_environment 均存在，staging child payload 与 delivery 行逐字段一致。
  验证命令: Test: manual:bash -c 'RESP=$(curl -sf "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/delivery/${DELIVERY_ID:?set DELIVERY_ID}/status"); echo "$RESP" | jq -e ".parent.run_phase==\"delivery/staging_pending\" and .parent.task_status!=\"completed\" and (.merged_sha|test(\"^[0-9a-f]{40}$\")) and (.head_sha|test(\"^[0-9a-f]{40}$\")) and (.contract_manifest_digest|startswith(\"sha256:\")) and .target_environment==\"local_api\"" >/dev/null; COUNT=$(psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM tasks WHERE task_type='\''staging_e2e'\'' AND payload->>'\''delivery_id'\''='\''${DELIVERY_ID}'\'' AND payload->>'\''contract_manifest_digest'\''=(SELECT contract_manifest_digest FROM harness_deliveries WHERE id='\''${DELIVERY_ID}'\'') AND payload->>'\''target_environment'\''='\''local_api'\'' AND created_at > NOW() - interval '\''5 minutes'\'';" | tr -d " "); [ "$COUNT" -eq 1 ]'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] delivery status endpoint schema keys 完整且禁用字段不存在
  动作: 查询真实 Brain delivery status endpoint。
  预期观察: 顶层 keys 精确匹配合同 Response Schema；禁用字段 ok_only、promoted_by_only、executor_success、child_completed_success 不存在。
  验证命令: Test: manual:bash -c 'RESP=$(curl -sf "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/delivery/${DELIVERY_ID:?set DELIVERY_ID}/status"); echo "$RESP" | jq -e "keys == [\"contract_manifest_digest\",\"delivery_id\",\"external_attestation\",\"head_sha\",\"merged_sha\",\"parent\",\"pr_url\",\"promote_status\",\"report\",\"run_id\",\"staging_child_payload\",\"status\",\"target_environment\",\"task_id\",\"tested_sha\"]" >/dev/null; echo "$RESP" | jq -e "has(\"ok_only\")|not and has(\"promoted_by_only\")|not and has(\"executor_success\")|not and has(\"child_completed_success\")|not" >/dev/null'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] delivery status invalid id error path 返回 400 + error 字段
  动作: 用非法 delivery id 调用真实 Brain status endpoint。
  预期观察: HTTP 400，响应体含 error 字符串，404 不可接受。
  验证命令: Test: manual:bash -c 'BODY=/tmp/delivery-status-error.json; CODE=$(curl -s -o "$BODY" -w "%{http_code}" "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/delivery/not-a-uuid/status"); [ "$CODE" = "400" ]; jq -e ".error | type == \"string\"" "$BODY" >/dev/null'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] staging PASS 且 tested_sha 等于 merged_sha 后才可 promote
  动作: 在真 Postgres 查询本轮 delivery 与 staging_e2e_results 的绑定行。
  预期观察: 出现 exactly one promote_pending 行，verdict=PASS，tested_sha=merged_sha，created_at 在 5 分钟内。
  验证命令: Test: manual:bash -c 'psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM harness_deliveries d JOIN staging_e2e_results s ON s.id=d.staging_result_id WHERE d.id='\''${DELIVERY_ID:?set DELIVERY_ID}'\'' AND d.status='\''promote_pending'\'' AND s.verdict='\''PASS'\'' AND s.tested_sha=d.merged_sha AND s.created_at > NOW() - interval '\''5 minutes'\'';" | tr -d " " | grep -qx "1"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] staging SKIP(no_contract) 不得 success 且 parent 保持 blocked
  动作: 回放 SKIP(no_contract) staging result fixture。
  预期观察: delivery 进入 staging_blocked/staging_failed，parent task 不为 completed。
  验证命令: Test: manual:bash -c 'psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM harness_deliveries d JOIN tasks t ON t.id=d.task_id WHERE d.id='\''${SKIP_DELIVERY_ID:?set SKIP_DELIVERY_ID}'\'' AND d.status IN ('\''staging_blocked'\'','\''staging_failed'\'','\''failed'\'') AND t.status <> '\''completed'\'' AND d.updated_at > NOW() - interval '\''5 minutes'\'';" | tr -d " " | grep -qx "1"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] tested_sha 缺失或不等于 merged_sha 必须 fail-closed
  动作: 回放 tested_sha missing/mismatch 两个 staging result fixture。
  预期观察: 两个 fixture 均进入 failed/staging_failed，promote_status 不为 promoted/auto_promoted。
  验证命令: Test: manual:bash -c 'psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM harness_deliveries WHERE id IN ('\''${MISSING_SHA_DELIVERY_ID:?set MISSING_SHA_DELIVERY_ID}'\'','\''${MISMATCH_SHA_DELIVERY_ID:?set MISMATCH_SHA_DELIVERY_ID}'\'') AND status IN ('\''staging_failed'\'','\''failed'\'') AND promote_status IS DISTINCT FROM '\''promoted'\'' AND promote_status IS DISTINCT FROM '\''auto_promoted'\'' AND updated_at > NOW() - interval '\''5 minutes'\'';" | tr -d " " | grep -qx "2"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] staging child completed+executor success 不得替代 PASS
  动作: 回放 verdict=FAIL 但 child task completed 且 executor_success=true 的 staging result fixture。
  预期观察: delivery 仍为 staging_failed/failed，parent task 不 completed，promote_status 不为 promoted/auto_promoted。
  验证命令: Test: manual:bash -c 'psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM harness_deliveries d JOIN tasks t ON t.id=d.task_id WHERE d.id='\''${EXECUTOR_SUCCESS_FAIL_DELIVERY_ID:?set EXECUTOR_SUCCESS_FAIL_DELIVERY_ID}'\'' AND d.status IN ('\''staging_failed'\'','\''failed'\'') AND t.status <> '\''completed'\'' AND d.promote_status IS DISTINCT FROM '\''promoted'\'' AND d.promote_status IS DISTINCT FROM '\''auto_promoted'\'' AND d.updated_at > NOW() - interval '\''5 minutes'\'';" | tr -d " " | grep -qx "1"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] Internal production health/fingerprint/E2E 失败进入 rollback_required 且带 rollback anchor
  动作: 对 internal delivery 回放 production health/fingerprint/E2E 任一失败。
  预期观察: delivery 不 promoted，状态为 rollback_required/failed，delivery_events 写 production_verify_failed 且 detail.rollback_anchor 非空。
  验证命令: Test: manual:bash -c 'psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM harness_deliveries d JOIN harness_delivery_events e ON e.delivery_id=d.id WHERE d.id='\''${ROLLBACK_DELIVERY_ID:?set ROLLBACK_DELIVERY_ID}'\'' AND d.status IN ('\''rollback_required'\'','\''failed'\'') AND d.promote_status IS DISTINCT FROM '\''promoted'\'' AND d.promote_status IS DISTINCT FROM '\''auto_promoted'\'' AND e.event_type='\''production_verify_failed'\'' AND e.detail ? '\''rollback_anchor'\'' AND e.created_at > NOW() - interval '\''5 minutes'\'';" | tr -d " " | grep -qx "1"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-06 INV-55 INV-57 Promote API 必须认证 approver，body.promoted_by 不可冒充
  动作: 不带 x-approver-token 调用 Promote API，只在 body 传 promoted_by。
  预期观察: API 返回 401 或 503，且不会更新 promoted_at。
  验证命令: Test: manual:bash -c 'BEFORE=$(psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM staging_e2e_results WHERE id='\''${PROMOTE_RESULT_ID:?set PROMOTE_RESULT_ID}'\'' AND promoted_at IS NOT NULL;" | tr -d " "); CODE=$(curl -s -o /tmp/promote-auth-body -w "%{http_code}" -X POST "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/promote/${PROMOTE_RESULT_ID}" -H "Content-Type: application/json" -d "{\"base_repo\":\"perfectuser21/cecelia\",\"promoted_by\":\"body-only\"}"); [ "$CODE" = "401" ] || [ "$CODE" = "503" ]; AFTER=$(psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM staging_e2e_results WHERE id='\''${PROMOTE_RESULT_ID}'\'' AND promoted_at IS NOT NULL;" | tr -d " "); [ "$BEFORE" = "$AFTER" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] customer confirm 无签名 attestation 不得 promoted
  动作: 对 customer delivery 只执行 Cecelia confirm，不提交客户 repo 签名 attestation。
  预期观察: delivery.status=external_ack_pending 或 pending_external_attestation，promote_status 不为 promoted。
  验证命令: Test: manual:bash -c 'curl -sf "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/delivery/${CUSTOMER_DELIVERY_ID:?set CUSTOMER_DELIVERY_ID}/status" | jq -e '\''(.status=="external_ack_pending" or .promote_status=="pending_external_attestation") and .promote_status!="promoted"'\'' >/dev/null'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] customer repo 签名 deployment attestation verified 后才 promoted
  动作: 带 x-approver-token 调用真实 external-attestation API，提交客户 repo 签名 deployment/verification attestation。
  预期观察: HTTP 202，响应 attestation_status=verified/promote_status=promoted；status endpoint 显示 external_attestation.verified_sha 等于 merged_sha；delivery_events 在 5 分钟内出现 external_attestation_verified。
  验证命令: Test: manual:bash -c 'BODY=/tmp/customer-attestation-response.json; CODE=$(curl -s -o "$BODY" -w "%{http_code}" -X POST "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/delivery/${CUSTOMER_ATTESTED_DELIVERY_ID:?set CUSTOMER_ATTESTED_DELIVERY_ID}/external-attestation" -H "Content-Type: application/json" -H "x-approver-token: ${HARNESS_REVIEW_APPROVER_TOKEN:?set HARNESS_REVIEW_APPROVER_TOKEN}" -d "{\"repo\":\"${CUSTOMER_REPO:-perfectuser21/zenithjoy-workspace}\",\"deployment_id\":\"deploy-${CUSTOMER_ATTESTED_DELIVERY_ID}\",\"deployed_sha\":\"${MERGED_SHA:?set MERGED_SHA}\",\"verified_sha\":\"${MERGED_SHA}\",\"verification_url\":\"${CUSTOMER_VERIFICATION_URL:-https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/e2e}\",\"attestation_signature\":\"${CUSTOMER_ATTESTATION_SIGNATURE:?set CUSTOMER_ATTESTATION_SIGNATURE}\"}"); [ "$CODE" = "202" ]; jq -e ".attestation_status==\"verified\" and .promote_status==\"promoted\"" "$BODY" >/dev/null; curl -sf "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/delivery/${CUSTOMER_ATTESTED_DELIVERY_ID}/status" | jq -e ".status==\"promoted\" and .external_attestation.attestation_status==\"verified\" and .external_attestation.verified_sha==.merged_sha" >/dev/null; COUNT=$(psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM harness_delivery_events WHERE delivery_id='\''${CUSTOMER_ATTESTED_DELIVERY_ID}'\'' AND event_type='\''external_attestation_verified'\'' AND detail->>'\''verified_sha'\''=(SELECT merged_sha FROM harness_deliveries WHERE id='\''${CUSTOMER_ATTESTED_DELIVERY_ID}'\'') AND created_at > NOW() - interval '\''5 minutes'\'';" | tr -d " "); [ "$COUNT" -eq 1 ]'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-20 INV-21 report dispatch 失败不得 parent complete
  动作: 回放 report dispatch/persist 失败 fixture。
  预期观察: delivery.status=report_pending/report_failed，parent run 不 done，parent task 不 completed。
  验证命令: Test: manual:bash -c 'psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM harness_deliveries d JOIN initiative_runs r ON r.id=d.run_id JOIN tasks t ON t.id=d.task_id WHERE d.id='\''${REPORT_FAIL_DELIVERY_ID:?set REPORT_FAIL_DELIVERY_ID}'\'' AND d.status IN ('\''report_pending'\'','\''report_failed'\'') AND r.phase <> '\''done'\'' AND t.status <> '\''completed'\'' AND d.updated_at > NOW() - interval '\''5 minutes'\'';" | tr -d " " | grep -qx "1"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] final report persisted 前 parent 不得 completed; persisted 后 atomically complete
  动作: 查询同一 delivery 的 final report 与 parent 状态。
  预期观察: report persisted 后 delivery.status=completed，initiative_runs.phase=done，tasks.status=completed 同时成立；report 缺失 fixture 中 parent 不 completed。
  验证命令: Test: manual:bash -c 'psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM harness_deliveries d JOIN initiative_runs r ON r.id=d.run_id JOIN tasks t ON t.id=d.task_id WHERE d.id='\''${DELIVERY_ID:?set DELIVERY_ID}'\'' AND d.status='\''completed'\'' AND d.final_report_id IS NOT NULL AND r.phase='\''done'\'' AND t.status='\''completed'\'' AND d.completed_at > NOW() - interval '\''5 minutes'\'';" | tr -d " " | grep -qx "1"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 重放同一 staging/promote/report 事件不重复
  动作: 使用相同 idempotency_key 重放 staging/pass、promote/pass、report/pass。
  预期观察: append-only events 表中每个 idempotency_key 最多一行。
  验证命令: Test: manual:bash -c 'psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -t -c "SELECT count(*) FROM (SELECT idempotency_key FROM harness_delivery_events WHERE delivery_id='\''${DELIVERY_ID:?set DELIVERY_ID}'\'' AND idempotency_key IN ('\''staging-pass'\'','\''promote-pass'\'','\''report-pass'\'') GROUP BY idempotency_key HAVING count(*) > 1) dup;" | tr -d " " | grep -qx "0"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] PR4327 PR4317 parent completed + staging queued fixture 在审计中 FAIL
  动作: 执行合同红测中的只读生产快照 audit fixture。
  预期观察: auditLegacyCompletionFixture 返回 FAIL，原因含 parent_completed_before_staging。
  验证命令: Test: manual:bash -c "node --input-type=module -e \"import('./packages/brain/src/delivery-terminal-authority.js').then(m=>m.auditLegacyCompletionFixture({pr_number:4327,parent_task_status:'completed',run_phase:'done',staging_task_status:'queued',staging_result:null})).then(r=>{if(r.verdict!=='FAIL'||!/parent_completed_before_staging/.test(r.reason||''))process.exit(1)})\""
  期望: exit 0

## DoD Invariant 覆盖条目

- INV-01: N/A，本 sprint 不触及 orphan requeue recovery。
- INV-02: N/A，本 sprint 不触及通知 sent/accepted 判定；失败告警只作为附加，不作为交付成功 oracle。
- INV-03: N/A，本 sprint 不触及 dep-audit。
- INV-04: N/A，本 sprint 不触及 headed relay heartbeat。
- INV-05: N/A，本 sprint 不执行毕业 commit。
- INV-06: 覆盖于 BEHAVIOR Promote API auth 与 final report gate；manual oracle 使用 exit code。
- INV-07: N/A，DoD 命令避免 JS `${}` 双引号 expansion。
- INV-08: N/A smoke 铁律，未提供具体约束。
- INV-09: N/A smoke 铁律，未提供具体约束。
- INV-10: 覆盖于 BEHAVIOR replay idempotency，多轮状态不重置。
- INV-11: N/A，本 sprint 不引入外部付费调用。
- INV-12: N/A，本 sprint 不新增时间常数依赖。
- INV-13: N/A，本 sprint target_environment=local_api。
- INV-14: 覆盖于 BEHAVIOR Merge payload，target_environment 必须在 staging child payload。
- INV-15: N/A，本 sprint 不改 judge API。
- INV-16: 覆盖于 ARTIFACT migration，digest/sha 用 TEXT，不截断。
- INV-17: N/A，本 sprint 不复活退役功能。
- INV-18: 覆盖于失败语义，所有 false/null 返回必须进入 fail-closed。
- INV-19: N/A smoke 铁律，未提供具体约束。
- INV-20: 覆盖于 final report gate，report 阶段漏跑时 parent 不 complete。
- INV-21: 覆盖于 BEHAVIOR final report gate，不能仅凭 Step6 merge/container exit code complete。
- INV-22: N/A，本 sprint 不起草 host 白名单。
- INV-23: 覆盖于 Merge payload，base_repo/pr_url/run_id/task_id 必填。
- INV-24: 覆盖于 PR4327/PR4317 只读 fixture audit。
- INV-25: 覆盖于失败语义，后台 job 失败写 delivery_events。
- INV-26: 覆盖于 ARTIFACT migration，新表 harness_deliveries/harness_delivery_events 独立命名。
- INV-27: 覆盖于 final report gate，harness_report 是真实消费者。
- INV-28: N/A，本 sprint 不新增 UI 多端字段。
- INV-29: 覆盖于 BEHAVIOR tested_sha fail-closed 与 production fingerprint。
- INV-30: N/A，本 sprint 不改 git rev-parse。
- INV-31: N/A，本 sprint 不用真实 worktree 当 deploy root。
- INV-32: 覆盖于 production rollback_required，部署链失败禁止 warning 降级。
- INV-33: 覆盖于 production fingerprint_sha 对账。
- INV-34: N/A，本 sprint 不改 lint-test-quality。
- INV-35: 覆盖于 contract-draft Test Contract 四列表格。
- INV-36: N/A，本 sprint 不提交 Red commit。
- INV-37: N/A，合同红测以状态机行为为主，不用 mock 调度接线。
- INV-38: N/A，本 sprint 不新增 cron。
- INV-39: N/A，generator 不自行 merge PR。
- INV-40: N/A，本 sprint 不改 tmux env。
- INV-41: 覆盖于 PR4327/PR4317 fixture，不复用历史假完成路径。
- INV-42: N/A，本 sprint 不改共享 CI 文件。
- INV-43: 覆盖于 Merge payload SHA 与 final gate SHA 对账。
- INV-44: N/A smoke 铁律，未提供具体约束。
- INV-45: N/A，本 sprint 不直接开 PR。
- INV-46: N/A，本 sprint 不新增 task_type。
- INV-47: N/A，本 sprint 不改常驻服务存活判定。
- INV-48: N/A，本 sprint 不改 LaunchAgents。
- INV-49: N/A，本 sprint 不新增常驻宿主服务。
- INV-50: N/A smoke 铁律，未提供具体约束。
- INV-51: N/A，本 sprint 只定义单 task ws1。
- INV-52: N/A，本 sprint 不使用屏幕/UIA 坐标。
- INV-53: 覆盖于接缝清单与 L2 真 DB/API 验证。
- INV-54: N/A，本 sprint 不触租户数据。
- INV-55: 覆盖于 Promote API header auth；secrets 不写入 git/log。
- INV-56: N/A，本 sprint 不处理聊天/PII。
- INV-57: 覆盖于 BEHAVIOR Promote API 必须认证 approver。
- INV-58: N/A，本 sprint 不触租户查询。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

- Kernel report handler -> staging child payload -> tasks / initiative_runs。
- staging_e2e_results -> harness_deliveries / harness_delivery_events。
- promote/attestation routes -> authenticateApprover -> DB transaction。
- report persisted -> handoff/learning/OKR map -> parent completion gate。
