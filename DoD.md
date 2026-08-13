contract_branch: cp-harness-propose-r1-70f1984b-r272a61aa-a4
sprint_dir: sprints/0813-f1-capability-certification-r3
workstream_index: 1

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: F1 Capability 可重复认证闭环 kernel-v1（20260813-r3）

**范围**: 在冻结 GP Contract 身份下打通 F1 的 Generator→Evaluator→Judge→PR→Receipt→Mapper 闭环；新增 `GET /api/brain/capabilities/F1/certification` 回读路径（复用 Mapper `resolveNodeState`/`aggregateCapabilityState` + `harness-gates.verifyImpactMergeFence` + `journey_assertion_receipts` 读写，**不新增平行认证系统**）；PR-CI smoke + nightly 负向矩阵。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] 认证读回端点已注册（复用 capabilities 路由族）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/analytics.js','utf8');if(!c.includes('/capabilities/:capability/certification')&&!c.includes('capabilities/:capability/certification'))process.exit(1)"

- [x] [ARTIFACT] 认证聚合复用现有 Mapper（禁平行系统）
  Test: node -e "const fs=require('fs');const g=fs.readdirSync('packages/brain/src/impact-contract').concat(fs.readdirSync('packages/brain/src/map'));const hit=[...fs.readdirSync('packages/brain/src/impact-contract').map(f=>'impact-contract/'+f),...fs.readdirSync('packages/brain/src/map').map(f=>'map/'+f)].some(p=>{try{const c=fs.readFileSync('packages/brain/src/'+p,'utf8');return c.includes('resolveNodeState')||c.includes('aggregateCapabilityState')||c.includes('verifyImpactMergeFence')}catch{return false}});if(!hit)process.exit(1)"

- [x] [ARTIFACT] 幂等 seed helper 存在（供 smoke/E2E/DoD 复用）
  Test: node -e "require('fs').accessSync('packages/brain/scripts/integration/seed-f1-cert-fixture.js')"

- [x] [ARTIFACT] nightly 负向矩阵集成测试已登记进 POSTGRES_INTEGRATION_TESTS
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('f1-capability-certification.integration.test.js'))process.exit(1)"

## BEHAVIOR 条目（五行剧本 — evaluator 逐条真实执行，manual:bash 单行断言）

- [x] [BEHAVIOR] [L2] B-01: certification 端点对冻结身份返回 green
  动作: seed green 案（幂等 helper 落冻结身份 + F1 journey_step_link + 非 synthetic PASS receipt），curl 认证端点带冻结 gp_contract_id/version/hash + journey_id + step_id + expected_merge_sha
  预期观察: 端点返回 state=green、synthetic=false、receipt_id 非空、gp_contract_hash 回显冻结值 3ade5843…
  等待预算: 0s
  留证: 端点 JSON 响应（进 evidence 字段）
  Test: manual:bash -c 'J=$(node packages/brain/scripts/integration/seed-f1-cert-fixture.js green); M=$(echo "$J" | jq -r .source_sha); R=$(curl -sf "localhost:5221/api/brain/capabilities/F1/certification?gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3&gp_contract_version=1&gp_contract_hash=3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8&journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&step_id=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b&expected_merge_sha=$M"); echo "$R" | jq -e ".capability==\"F1\" and .state==\"green\" and .synthetic==false and (.receipt_id|type==\"string\") and .gp_contract_hash==\"3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8\"" || { echo "FAIL: $R"; exit 1; }'

- [x] [BEHAVIOR] [L2] B-02: 非 synthetic PASS receipt 精确落账
  动作: 复用 B-01 seed green 后，psql 查 F1 journey_step_link 上的 receipt 行
  预期观察: 恰一条 verdict=PASS、synthetic=false、source_sha 40hex、machine_id 非空、scenario_count>0 的 receipt，且 created_at 在近 10 分钟内
  等待预算: 0s
  留证: psql count 输出
  Test: manual:bash -c 'J=$(node packages/brain/scripts/integration/seed-f1-cert-fixture.js green); JSL=$(echo "$J" | jq -r .journey_step_link_id); M=$(echo "$J" | jq -r .source_sha); C=$(psql "$DB_URL" -tAc "SELECT count(*) FROM journey_assertion_receipts WHERE journey_step_link_id='"'"'$JSL'"'"' AND verdict='"'"'PASS'"'"' AND synthetic=false AND source_sha='"'"'$M'"'"' AND scenario_count>0 AND created_at > NOW() - interval '"'"'10 minutes'"'"'" | tr -d " "); [ "$C" = "1" ] || { echo "FAIL: receipt count=$C"; exit 1; }'

- [x] [BEHAVIOR] [L2] B-03: 无合同时不 green
  动作: seed no_contract 案（冻结 hash 不对应任何 signed golden_path_contract_versions），curl 认证端点
  预期观察: state≠green，reason_code=contract_identity_mismatch（fail-closed）
  等待预算: 0s
  留证: 端点 JSON 响应
  Test: manual:bash -c 'J=$(node packages/brain/scripts/integration/seed-f1-cert-fixture.js no_contract); H=$(echo "$J" | jq -r .gp_contract_hash); M=$(echo "$J" | jq -r .source_sha); R=$(curl -sf "localhost:5221/api/brain/capabilities/F1/certification?gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3&gp_contract_version=1&gp_contract_hash=$H&journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&step_id=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b&expected_merge_sha=$M"); echo "$R" | jq -e ".state != \"green\" and .reason_code==\"contract_identity_mismatch\"" || { echo "FAIL: $R"; exit 1; }'

- [x] [BEHAVIOR] [L2] B-04: 无 receipt 时不 green
  动作: seed no_receipt 案（F1 journey_step_link 存在但无任何 receipt），curl 认证端点
  预期观察: state=gray，reason_code=no_receipt（缺证据，非缺陷）
  等待预算: 0s
  留证: 端点 JSON 响应
  Test: manual:bash -c 'J=$(node packages/brain/scripts/integration/seed-f1-cert-fixture.js no_receipt); M=$(echo "$J" | jq -r .source_sha); R=$(curl -sf "localhost:5221/api/brain/capabilities/F1/certification?gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3&gp_contract_version=1&gp_contract_hash=3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8&journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&step_id=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b&expected_merge_sha=$M"); echo "$R" | jq -e ".state != \"green\" and .reason_code==\"no_receipt\"" || { echo "FAIL: $R"; exit 1; }'

- [x] [BEHAVIOR] [L2] B-05: 错 SHA 时不 green
  动作: seed wrong_sha 案（receipt 的 source_sha 与 expected_merge_sha 不一致），curl 认证端点
  预期观察: state=unknown，reason_code=revision_mismatch（拒绝共享 validation clock）
  等待预算: 0s
  留证: 端点 JSON 响应
  Test: manual:bash -c 'J=$(node packages/brain/scripts/integration/seed-f1-cert-fixture.js wrong_sha); M=$(echo "$J" | jq -r .source_sha); R=$(curl -sf "localhost:5221/api/brain/capabilities/F1/certification?gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3&gp_contract_version=1&gp_contract_hash=3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8&journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&step_id=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b&expected_merge_sha=$M"); echo "$R" | jq -e ".state != \"green\" and .reason_code==\"revision_mismatch\"" || { echo "FAIL: $R"; exit 1; }'

- [x] [BEHAVIOR] [L2] B-06: 缺 Feature 时不 green
  动作: seed missing_feature 案（F1 journey_step_link.feature_id 为 NULL），curl 认证端点
  预期观察: state≠green，reason_code=anchor_target_missing（缺 Feature 绑定，无法归属）
  等待预算: 0s
  留证: 端点 JSON 响应
  Test: manual:bash -c 'J=$(node packages/brain/scripts/integration/seed-f1-cert-fixture.js missing_feature); M=$(echo "$J" | jq -r .source_sha); R=$(curl -sf "localhost:5221/api/brain/capabilities/F1/certification?gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3&gp_contract_version=1&gp_contract_hash=3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8&journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&step_id=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b&expected_merge_sha=$M"); echo "$R" | jq -e ".state != \"green\" and .reason_code==\"anchor_target_missing\"" || { echo "FAIL: $R"; exit 1; }'

- [x] [BEHAVIOR] [L2] INV-1 [validation-clock] 缺/错 merge SHA 一律 fail-closed 不 green
  动作: seed wrong_sha 案后，故意省略 expected_merge_sha query 参数 curl 端点
  预期观察: state≠green（缺 clock 锚点即拒绝，不得回退成任意 receipt 冒充 green）
  等待预算: 0s
  留证: 端点 JSON 响应
  Test: manual:bash -c 'node packages/brain/scripts/integration/seed-f1-cert-fixture.js wrong_sha >/dev/null; R=$(curl -sf "localhost:5221/api/brain/capabilities/F1/certification?gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3&gp_contract_version=1&gp_contract_hash=3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8&journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&step_id=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b"); echo "$R" | jq -e ".state != \"green\"" || { echo "FAIL: 缺 merge SHA 竟 green: $R"; exit 1; }'

- [x] [BEHAVIOR] [L2] INV-2 [evidence-vs-defect] 无 receipt(补证据) 与 receipt FAIL(缺陷) 语义区分
  动作: 先 seed no_receipt 案读 reason，再 seed receipt_fail 案（一条 verdict=FAIL receipt）读 state
  预期观察: no_receipt → reason_code=no_receipt（gray，走补证据）；receipt_fail → state=red（缺陷），二者 reason 不相同
  等待预算: 0s
  留证: 两次端点 JSON 响应
  Test: manual:bash -c 'J1=$(node packages/brain/scripts/integration/seed-f1-cert-fixture.js no_receipt); M1=$(echo "$J1" | jq -r .source_sha); R1=$(curl -sf "localhost:5221/api/brain/capabilities/F1/certification?gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3&gp_contract_version=1&gp_contract_hash=3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8&journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&step_id=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b&expected_merge_sha=$M1"); J2=$(node packages/brain/scripts/integration/seed-f1-cert-fixture.js receipt_fail); M2=$(echo "$J2" | jq -r .source_sha); R2=$(curl -sf "localhost:5221/api/brain/capabilities/F1/certification?gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3&gp_contract_version=1&gp_contract_hash=3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8&journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&step_id=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b&expected_merge_sha=$M2"); echo "$R1" | jq -e ".reason_code==\"no_receipt\"" >/dev/null && echo "$R2" | jq -e ".state==\"red\" and .reason_code==\"receipt_fail\"" >/dev/null || { echo "FAIL: R1=$R1 R2=$R2"; exit 1; }'

