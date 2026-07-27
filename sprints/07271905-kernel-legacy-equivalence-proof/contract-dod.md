---
skeleton: false
journey_type: dev_pipeline
target_environment: local_api
---
# Contract DoD — Sprint: Legacy P0/P1 全量行为等价证明矩阵

**范围**: 129 条 P0/P1 inventory、8 个行为族、Claude/Codex/Grok 三态矩阵、Engine/CI/GitHub 真实证明与 fail-closed gate
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/engine/src/equivalence/legacy-p0p1-inventory.json` 含 129 个稳定映射，P0=66、P1=63，字段符合合同 Proof Report 行 schema。
  Test: node -e "const fs=require('fs');const p='packages/engine/src/equivalence/legacy-p0p1-inventory.json';const x=JSON.parse(fs.readFileSync(p,'utf8'));if(x.length!==129||x.filter(v=>v.severity==='P0').length!==66||x.filter(v=>v.severity==='P1').length!==63)process.exit(1)"

- [ ] [ARTIFACT] `packages/engine/src/equivalence/legacy-equivalence-gate.ts` 是逐行重算与 fail-closed 的单一实现源。
  Test: node -e "const fs=require('fs');const p='packages/engine/src/equivalence/legacy-equivalence-gate.ts';const s=fs.readFileSync(p,'utf8');if(!s.includes('proven_active')||!s.includes('owner_mismatch'))process.exit(1)"

- [ ] [ARTIFACT] `packages/engine/src/equivalence/github-main-protection-policy.json` 固化六类只读比较字段，不含 token。
  Test: node -e "const fs=require('fs');const p='packages/engine/src/equivalence/github-main-protection-policy.json';const x=JSON.parse(fs.readFileSync(p,'utf8'));for(const k of ['required_status_checks','enforce_admins','required_pull_request_reviews','required_linear_history','allow_force_pushes','allow_deletions'])if(!(k in x))process.exit(1);if(/token|secret/i.test(JSON.stringify(x)))process.exit(1)"

- [ ] [ARTIFACT] `packages/engine/scripts/legacy-equivalence-gate.mjs` 提供 inventory/oracle/Engine/GitHub/fixture/mutation/final CLI，拒绝任意 YAML 命令注入。
  Test: node -e "const fs=require('fs');const p='packages/engine/scripts/legacy-equivalence-gate.mjs';const s=fs.readFileSync(p,'utf8');if(!s.includes('legacy-equivalence-v1')||s.includes('eval('))process.exit(1)"

- [ ] [ARTIFACT] `packages/engine/scripts/smoke/legacy-equivalence-gate-smoke.sh` 与 Engine unit/integration 测试进入现有 glob runner。
  Test: node -e "const fs=require('fs');const p='packages/engine/scripts/smoke/legacy-equivalence-gate-smoke.sh';const s=fs.readFileSync(p,'utf8');if(!s.includes('remove-credential-guard')||!s.includes('4dc3b69a'))process.exit(1)"

- [ ] [ARTIFACT] permanent tests 覆盖逐行、mutation、真实 Engine/GitHub 接缝，且不得 mock 禁 mock 边。
  Test: node -e "const fs=require('fs');for(const p of ['packages/engine/tests/equivalence/legacy-equivalence-gate.test.ts','packages/engine/tests/equivalence/github-protection.integration.test.ts']){const s=fs.readFileSync(p,'utf8');if(/vi\\.mock|jest\\.mock|sinon\\.stub/.test(s))process.exit(1)}"

- [ ] [ARTIFACT] `.github/workflows/ci.yml` 真执行等价 gate 并将结果纳入 `ci-passed`，不是文件存在性检查。
  Test: node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --verify-ci-workflow .github/workflows/ci.yml --output /tmp/legacy-ci-artifact.json

- [ ] [ARTIFACT] Engine 版本、hook 版本、回归契约与 feature registry 按既有六文件同步规则更新。
  Test: node packages/engine/scripts/devgate/check-engine-hygiene.cjs

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] GP Step 1 — 129 行必填字段、family 派生计数与 F01/F06/F08 规则全部成立
  动作: evaluator 对真实 `packages/engine/regression-contract.yaml` 运行 inventory-only。
  预期观察: total=129、P0=66、P1=63、ID 唯一；129/129 行字段非空；八个 family_counts 由逐行重算且总和 129；F01/F06>0、F08 只含发布链。
  验证命令: Test: manual:bash -c 'node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --inventory-only --output /tmp/legacy-inventory.json && jq -e '"'"'def ne:type=="string" and length>0; .inventory_counts=={"total":129,"P0":66,"P1":63} and (.behaviors|length)==129 and ([.behaviors[].behavior_id]|unique|length)==129 and all(.behaviors[];(.behavior_id|ne) and (.severity|test("^P[01]$")) and (.legacy_source|ne) and (.family_id|test("^F0[1-8]$")) and (.unified_owner|ne) and (.unified_construct|ne) and (.assertion_ref|ne) and (.checked_at|ne) and (.expires_at|ne) and (.fail_semantics|ne)) and .family_counts==(reduce .behaviors[] as $b ({"F01":0,"F02":0,"F03":0,"F04":0,"F05":0,"F06":0,"F07":0,"F08":0};.[$b.family_id]+=1)) and ([.family_counts[]]|add)==129 and .family_counts.F01>0 and .family_counts.F06>0 and ([.behaviors[]|select(.family_id=="F08" and (.unified_construct|test("staging|promote|rollback")|not))]|length)==0'"'"' /tmp/legacy-inventory.json'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] GP Step 2 — 每行 owner/construct 与三态 oracle 完整且真实启动
  动作: evaluator 对 129 行运行 positive、violation、recovery oracle。
  预期观察: within 600s 结束；129 行均有非空 owner/construct/assertion_ref，三态均有 exit_code/log。
  验证命令: Test: manual:bash -c 'DEADLINE=$((SECONDS+600)); node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --run-oracles --output /tmp/legacy-oracles.json & PID=$!; until ! kill -0 "$PID" 2>/dev/null; do [ "$SECONDS" -lt "$DEADLINE" ] || { kill "$PID"; exit 1; }; sleep 2; done; wait "$PID"; jq -e '"'"'[.behaviors[]|select((.unified_owner|length)==0 or (.unified_construct|length)==0 or (.assertion_ref|length)==0 or ([.oracles.positive,.oracles.violation,.oracles.recovery]|any(.started!=true or .passed!=true or .exit_code==null or (.log_tail|length)==0 or .assertion_ref==null)))]|length==0'"'"' /tmp/legacy-oracles.json'
  期望: within 600s exit 0

- [ ] [BEHAVIOR] [L2] GP Step 2 — provider 3×8 family 覆盖无缺格，supported 真三态，unsupported 有批准 decision
  动作: evaluator 运行 Claude/Codex/Grok × F01..F08 provider matrix。
  预期观察: within 600s 精确得到 24 个唯一 provider×family 格；支持项均有三态 exit/assertion，不支持项只有批准的 retirement/supersession。
  验证命令: Test: manual:bash -c 'DEADLINE=$((SECONDS+600)); node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --run-providers --output /tmp/legacy-providers.json & PID=$!; until ! kill -0 "$PID" 2>/dev/null; do [ "$SECONDS" -lt "$DEADLINE" ] || { kill "$PID"; exit 1; }; sleep 2; done; wait "$PID"; jq -e '"'"'(.provider_matrix|length)==24 and ([.provider_matrix[]|[.provider,.family_id]]|unique|length)==24 and ([.provider_matrix[].provider]|unique|sort)==["claude","codex","grok"] and ([.provider_matrix[].family_id]|unique|sort)==["F01","F02","F03","F04","F05","F06","F07","F08"] and all(.provider_matrix[];if .support=="supported" then ([.positive,.violation,.recovery]|all(.started==true and .passed==true and .exit_code!=null and (.assertion_ref|type=="string" and length>0))) else (.support=="unsupported" and .decision.status=="approved" and (.decision.kind=="retirement" or .decision.kind=="supersession")) end)'"'"' /tmp/legacy-providers.json'
  期望: within 600s exit 0

- [ ] [BEHAVIOR] [L2] GP Step 3 — guards、全部 stop hooks、DevGate、Evaluator/Judge 与发布链真执行且 skipped=0
  动作: evaluator 运行 Engine 等价套件与 shell glob runner。
  预期观察: within 600s started=true、failed=0、skipped=0，合同列出的 required constructs 全部出现。
  验证命令: Test: manual:bash -c 'DEADLINE=$((SECONDS+600)); node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --run-engine --output /tmp/legacy-engine.json & PID=$!; until ! kill -0 "$PID" 2>/dev/null; do [ "$SECONDS" -lt "$DEADLINE" ] || { kill "$PID"; exit 1; }; sleep 2; done; wait "$PID"; jq -e '"'"'.engine_test_summary.started==true and .engine_test_summary.failed==0 and .engine_test_summary.skipped==0'"'"' /tmp/legacy-engine.json'
  期望: within 600s exit 0

- [ ] [BEHAVIOR] [L2] GP Step 3 — CI workflow 独立 gate job 强制进入 ci-passed
  动作: evaluator 用等价 CLI 结构化解析实际 `.github/workflows/ci.yml`，不以 grep/字符串存在代替。
  预期观察: job id/name 固定，真实 run step 调 gate；`ci-passed.needs` 含该 job 且非 success 必须失败。
  验证命令: Test: manual:bash -c 'node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --verify-ci-workflow .github/workflows/ci.yml --output /tmp/legacy-ci.json && jq -e '"'"'.ci_workflow.job_id=="legacy-equivalence" and .ci_workflow.job_name=="Legacy P0/P1 Equivalence" and .ci_workflow.job_runs_gate==true and .ci_workflow.ci_passed_needs==true and .ci_workflow.ci_passed_requires_success==true'"'"' /tmp/legacy-ci.json'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] GP Step 4 — current SHA、24h TTL、assertion_ref 与 owner 全部逐行有效
  动作: evaluator 在当前 checkout 运行 final gate。
  预期观察: 报告 SHA 等于 `HEAD^{commit}`，expired/missing assertion/owner mismatch 均为 0。
  验证命令: Test: manual:bash -c 'SHA=$(git rev-parse --verify "HEAD^{commit}") && NOW=$(date +%s) && node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --output /tmp/legacy-current.json && jq -e --arg sha "$SHA" --argjson now "$NOW" '"'"'.artifact_sha==$sha and .evidence_ttl_hours==24 and .status_counts.missing_assertion==0 and .status_counts.owner_mismatch==0 and ([.behaviors[]|select(.artifact_sha!=$sha or (.assertion_ref|length)==0 or (.checked_at|type!="string") or (.expires_at|fromdateiso8601)<=$now)]|length)==0'"'"' /tmp/legacy-current.json'
  期望: exit 0

- [ ] [BEHAVIOR] [L3] GP Step 5 — GitHub main protection 真实只读 API 六类 policy 逐字段匹配
  动作: evaluator 使用 `gh api` 的安全凭据真读 main protection，再由 gate 与版本化 policy 比较。
  预期观察: within 60s `requested_live=true`、`match=true`；认证、限流、缺字段或漂移均非零。
  验证命令: Test: manual:bash -c 'DEADLINE=$((SECONDS+60)); until gh api repos/perfectuser21/cecelia/branches/main/protection > /tmp/github-main-protection.json; do [ "$SECONDS" -lt "$DEADLINE" ] || exit 1; sleep 2; done; jq -e '"'"'(.required_status_checks.contexts|type)=="array" and (.enforce_admins.enabled|type)=="boolean" and (.required_pull_request_reviews|type)=="object" and (.required_linear_history.enabled|type)=="boolean" and (.allow_force_pushes.enabled|type)=="boolean" and (.allow_deletions.enabled|type)=="boolean"'"'"' /tmp/github-main-protection.json; node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --verify-github-protection perfectuser21/cecelia main --output /tmp/legacy-github.json; jq -e '"'"'.github_protection.requested_live==true and .github_protection.match==true'"'"' /tmp/legacy-github.json'
  期望: within 60s exit 0

- [ ] [BEHAVIOR] [L2] GP Step 6 — PR #4372 固定 fixture 必须精确红 100/5/129/0
  动作: evaluator 只读 `4dc3b69a...` 产物运行 counterexample 模式。
  预期观察: 立即非零退出并报告 unknown=100、drifted=5、missing assertion=129、green=0。
  验证命令: Test: manual:bash -c 'REF=4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13; git rev-parse --verify "${REF}^{commit}" >/dev/null; OUT=/tmp/pr4372-counterexample.json; if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --counterexample-ref "$REF" --output "$OUT"; then exit 1; fi; jq -e '"'"'.result=="fail" and .status_counts.unknown==100 and .status_counts.drifted==5 and .status_counts.missing_assertion==129 and .matrix.green==0'"'"' "$OUT"'
  期望: gate 非零且 oracle 命令整体 exit 0

- [ ] [BEHAVIOR] [L2] GP Step 7 — credential/stop/branch guard 三种移除 mutation 均 proven-to-fire
  动作: evaluator 在隔离临时副本分别移除三类 guard。
  预期观察: 3/3 gate 非零，violations 指向 missing_construct/oracle_not_fired；工作区不变。
  验证命令: Test: manual:bash -c 'for M in remove-credential-guard remove-stop-hook remove-branch-guard; do O="/tmp/$M.json"; if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --mutation "$M" --output "$O"; then exit 1; fi; jq -e --arg m "$M" '"'"'.result=="fail" and ([.violations[]|select(.mutation==$m)]|length)>0'"'"' "$O" || exit 1; done'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] GP Step 8 — manual-as-auto、hardcoded zero、伪造 match_count 均 proven-to-fire
  动作: evaluator 逐个运行证据类型与汇总伪造 mutation。
  预期观察: 3/3 gate 非零并给出可定位 reason_code。
  验证命令: Test: manual:bash -c 'for M in manual-as-auto hardcoded-mismatch-zero forged-match-count; do O="/tmp/$M.json"; if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --mutation "$M" --output "$O"; then exit 1; fi; jq -e --arg m "$M" '"'"'.result=="fail" and ([.violations[]|select(.mutation==$m)]|length)>0'"'"' "$O" || exit 1; done'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] GP Step 9 — 外部漂移、过期、SHA/ref/owner/oracle/skipped 异常全部 fail-closed
  动作: evaluator 运行八类 failure mutation。
  预期观察: 8/8 非零且没有 mutation 被降级为 unknown/PASS。
  验证命令: Test: manual:bash -c 'for M in github-protection-drift expired-evidence wrong-current-sha empty-assertion-ref owner-mismatch oracle-exception unsupported-without-decision skipped-engine-test; do O="/tmp/$M.json"; if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --mutation "$M" --output "$O"; then exit 1; fi; jq -e --arg m "$M" '"'"'.result=="fail" and ([.violations[]|select(.mutation==$m)]|length)>0'"'"' "$O" || exit 1; done'
  期望: exit 0

- [ ] [BEHAVIOR] [L3] GP Step 10 — 全量真实矩阵才可 PASS 与 143 green
  动作: evaluator 在 current SHA 真跑所有 oracle并真读 GitHub protection。
  预期观察: within 600s 只有 129 proven active、四类 gap=0 且 143 cells 全部有逐行证据时 PASS。
  验证命令: Test: manual:bash -c 'DEADLINE=$((SECONDS+600)); node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --verify-github-protection perfectuser21/cecelia main --output /tmp/legacy-final.json & PID=$!; until ! kill -0 "$PID" 2>/dev/null; do [ "$SECONDS" -lt "$DEADLINE" ] || { kill "$PID"; exit 1; }; sleep 2; done; wait "$PID"; jq -e '"'"'.result=="pass" and .inventory_counts=={"total":129,"P0":66,"P1":63} and .status_counts=={"proven_active":129,"unknown":0,"drifted":0,"missing_assertion":0,"owner_mismatch":0} and .proven_status_count==129 and .matrix.cell_count==143 and .matrix.green==143 and .engine_test_summary.skipped==0 and .github_protection.match==true'"'"' /tmp/legacy-final.json'
  期望: within 600s exit 0

## Invariant 约束逐条映射

- [ ] [BEHAVIOR] [L2] INV-1 不写用户 LaunchAgents
  动作: 运行等价 gate 完整流程。
  预期观察: gate 的 touched_resources 不含 `~/Library/LaunchAgents`。
  验证命令: Test: manual:bash -c 'node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --inventory-only --output /tmp/inv-1.json && jq -e '"'"'(.touched_resources|type)=="array" and ([.touched_resources[]|select(test("Library/LaunchAgents"))]|length==0)'"'"' /tmp/inv-1.json'
  期望: exit 0

- INV-2 N/A：PRD 第 47 行已显式授权本 sprint 修改 `.github/` 等价门禁接线，不属于“未经合同授权”。

- [ ] [BEHAVIOR] [L2] INV-3 判变端与终验端共用同一逐行聚合函数
  动作: 运行 self-consistency 模式分别计算 gate/report verdict。
  预期观察: 两端 status_counts、violations 与 result 深度相等。
  验证命令: Test: manual:bash -c 'node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --self-consistency --output /tmp/inv-3.json && jq -e '"'"'.gate_result==.report_result and .gate_counts==.report_counts and .gate_violations==.report_violations'"'"' /tmp/inv-3.json'
  期望: exit 0

- INV-4 N/A：本合同 Test Contract 已固定为 4 列，路径在第 2 列且反引号包裹；由 [ARTIFACT] 合同文件审查覆盖。
- INV-5 N/A：本 sprint 不建表、不复用 DB 表、不写生产 DB。
- INV-6 N/A：本 sprint 不新增后台 job。
- INV-7 N/A：本 sprint 不提前合并，也不实现 evaluator/judge 前 CI 合并。

- [ ] [BEHAVIOR] [L2] INV-8 ref 存在性使用 `--verify "<ref>^{commit}"`
  动作: 对当前 HEAD 与 #4372 fixture 运行 ref 解析。
  预期观察: 两个 ref 都解析为 40 字符 commit SHA。
  验证命令: Test: manual:bash -c 'A=$(git rev-parse --verify "HEAD^{commit}") && B=$(git rev-parse --verify "4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13^{commit}") && [ "${#A}" -eq 40 ] && [ "${#B}" -eq 40 ]'
  期望: exit 0

- INV-9 N/A：铁律仅写“smoke 铁律”未给可执行语义；GP Step 6-9 的 proven-to-fire smoke 已显式覆盖，不臆造额外要求。
- INV-10 N/A：不新增或判定常驻服务。
- INV-11 N/A：不派发 headed relay。
- INV-12 N/A：不引入跨模块时间常数关系；仅单项 timeout=120s、总预算=600s。

- [ ] [BEHAVIOR] [L3] INV-13 真实世界接缝未真验不得 green
  动作: 真读 GitHub protection 并运行 final gate。
  预期观察: requested_live=true 才可 match/green；无凭据或限流必须非零。
  验证命令: Test: manual:bash -c 'node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --verify-github-protection perfectuser21/cecelia main --output /tmp/inv-13.json && jq -e '"'"'.github_protection.requested_live==true and .github_protection.match==true and .matrix.green==143'"'"' /tmp/inv-13.json'
  期望: exit 0

- INV-14 N/A：不修改 `packages/brain/src/`。
- INV-15 N/A：不派发 headed relay。
- INV-16 N/A：不新增 catch 吞错后台 job；gate 错误全部非零。
- INV-17 N/A：不改依赖 advisory 或白名单。
- INV-18 N/A：输入不含客户 PII/聊天内容；日志只保留 hook/gate 脱敏 tail。
- INV-19 N/A：本 sprint 不 rename 已入册测试。
- INV-20 N/A：同 INV-9，PRD 已用明确 proven-to-fire mutation 替代无定义 smoke 文本。
- INV-21 N/A：不新增 API 端点。
- INV-22 N/A：同 INV-9。
- INV-23 N/A：无租户数据、无 DB。
- INV-24 N/A：不新增 cron/job。
- INV-25 N/A：GitHub 凭据只由 `gh` credential store 使用，不进入输入、产物、git 或日志。

- [ ] [BEHAVIOR] [L2] INV-26 判变基准使用真实 SHA
  动作: gate 真执行 git 读取 HEAD 与 fixture ref。
  预期观察: 每行 artifact_sha 等于 HEAD；fixture artifact_sha 等于固定 PR SHA。
  验证命令: Test: manual:bash -c 'SHA=$(git rev-parse --verify "HEAD^{commit}") && node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --output /tmp/inv-26.json && jq -e --arg sha "$SHA" '"'"'.artifact_sha==$sha and ([.behaviors[]|select(.artifact_sha!=$sha)]|length)==0'"'"' /tmp/inv-26.json'
  期望: exit 0

- INV-27 N/A：不调用通知/写库接口。
- INV-28 N/A：不依赖 journey_features/report job。
- INV-29 N/A：不新增 task_type。
- INV-30 N/A：provider/GitHub/路径/SHA 均从 capability registry、API、repo root 与 git 推导，不写死机器坐标/env。
- INV-31 N/A：同 INV-9。
- INV-32 N/A：不处理 watchdog requeue。
- INV-33 N/A：合同 manual oracle 不用 `node -e` 读取源码；[ARTIFACT] 静态检查不作为 BEHAVIOR。
- INV-34 N/A：smoke 在隔离临时副本做 mutation，不触碰生产资源。
- INV-35 N/A：无租户数据读写。
- INV-36 N/A：不复活退役功能；unsupported 必须引用已有 approved retirement/supersession decision。
- INV-37 N/A：不派发 headed relay。
- INV-38 N/A：这是 generator 的 Red commit 操作纪律；task-plan 明确只精确 add sprint tests。
- INV-39 N/A：本 task-plan 单 ws1 串行实现。
- INV-40 N/A：未复用历史合同；已核对本次初始派发 `attempt_kind=initial`、round=1。
- INV-41 N/A：新增 proof report 字段均由 PRD字面定义，无与既有 HTTP/DB 字段冲突。

- [ ] [BEHAVIOR] [L2] INV-42 部署/门禁失败不得 warning 降级
  动作: 对 oracle-exception 与 github-protection-drift 运行 mutation。
  预期观察: 两次均非零且 result=fail，不出现 warning-only PASS。
  验证命令: Test: manual:bash -c 'for M in oracle-exception github-protection-drift; do O="/tmp/inv-42-$M.json"; if node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --mutation "$M" --output "$O"; then exit 1; fi; jq -e '"'"'.result=="fail"'"'"' "$O" || exit 1; done'
  期望: exit 0

- INV-43 N/A：不新增 host 白名单；target_environment 来自 task payload。
- INV-44 N/A：同 INV-9。
- INV-45 N/A：不新增常驻宿主服务。
- INV-46 N/A：不实现跨扫描周期状态机。

- [ ] [BEHAVIOR] [L2] INV-47 target_environment 与真实目标一致
  动作: local_api evaluator 运行 Engine CLI，并由 CLI 真调外部 GitHub API。
  预期观察: report target_environment=`local_api`，无 windows/真机枚举绕过。
  验证命令: Test: manual:bash -c 'node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --inventory-only --output /tmp/inv-47.json && jq -e '"'"'.target_environment=="local_api"'"'"' /tmp/inv-47.json'
  期望: exit 0

- INV-48 N/A：不修改 task 调度接线。
- INV-49 N/A：不写 DB 字段。
- INV-50 N/A：BEHAVIOR 不含 manual `node -e`；所有 `node -e` 仅为 [ARTIFACT] 静态检查。
- INV-51 N/A：不修改 Brain judge API；F06 只真跑既有 Evaluator/Judge 行为。
- INV-52 N/A：GitHub 为只读免费 API；无外部付费调用。
- INV-53 N/A：generator 只推实现分支，merge 权仍在 controller。
- INV-54 N/A：不修改 controller 完成判定。
- INV-55 N/A：gate 对 spawn status=null、API false/null 与解析失败均显式进入 violations。
- INV-56 N/A：unsupported retirement/supersession 只接受真实 approved decision registry，不凭记忆。

- [ ] [BEHAVIOR] [L2] INV-57 manual oracle 必须记录真实 exit code 且解释器启动
  动作: 运行 provider/Engine oracle。
  预期观察: auto 行不存在 `manual:` assertion，所有三态 `started=true` 且 exit_code 非空。
  验证命令: Test: manual:bash -c 'node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --run-oracles --output /tmp/inv-57.json && jq -e '"'"'[.behaviors[]|select((.method=="auto" and (.assertion_ref|startswith("manual:"))) or ([.oracles.positive,.oracles.violation,.oracles.recovery]|any(.started!=true or .exit_code==null)))]|length==0'"'"' /tmp/inv-57.json'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-58 target_environment 从派发 payload 路由
  动作: evaluator 以本 task payload 指定的 local_api 运行 gate。
  预期观察: report 记录 payload_source=`task.target_environment` 与 local_api。
  验证命令: Test: manual:bash -c 'TARGET_ENVIRONMENT=local_api node packages/engine/scripts/legacy-equivalence-gate.mjs --repo-root "$PWD" --inventory-only --output /tmp/inv-58.json && jq -e '"'"'.target_environment=="local_api" and .target_environment_source=="task.target_environment"'"'"' /tmp/inv-58.json'
  期望: exit 0

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] local_api evaluator 完整执行 contract-draft.md 的单一 bash E2E 块，保存 `/tmp/legacy-final.json` 与真实 GitHub protection 脱敏证据。
  期望: 脚本 exit 0；129 proven active；unknown/drifted/missing/owner mismatch=0；143 green；Engine skipped=0；GitHub match=true。
