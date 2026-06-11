contract_branch: cp-harness-propose-r2-ea622a94
sprint_dir: sprints/06112200-report-scriptize

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: harness-report.mjs 脚本化（机械段下沉 + 幂等 + 宿主 git 隔离）

**范围**: `packages/brain/scripts/harness-report.mjs`（新增 CLI 脚本）+ `reportNode` 机械段改调脚本 + vitest 单测；修 stale：thickness:done → 移除 thickness、awk $NF → $2
**大小**: M

> 被测真实系统 = 新增 CLI 脚本 `packages/brain/scripts/harness-report.mjs`；BEHAVIOR 命令直接运行脚本或调 Brain API（localhost:5221）+ psql cecelia，无 mock/stub。本能力无 HTTP 端点，故验证点为脚本的文件产出、DB 状态变更、git 隔离。

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/scripts/harness-report.mjs` 存在，且含 CLI 参数解析（--sprint-dir / --task-id / --pr-url / --feature-id）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/harness-report.mjs','utf8');if(!c.includes('sprint-dir')||!c.includes('task-id')||!c.includes('feature-id'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/brain/scripts/harness-report.mjs` 含分步 try/catch（每步独立失败不中断其余步骤，≥ 4 个 try 块）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/harness-report.mjs','utf8');const n=((c.match(/try\s*\{/g)||[]).length);if(n<4){console.error('FAIL: try/catch 块数 '+n+' < 4');process.exit(1);}console.log('OK: '+n+' try blocks')"

- [x] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 的 reportNode 含 harness-report.mjs 调用（机械段已改）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('harness-report.mjs')&&!c.includes('harness-report'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/brain/src/__tests__/harness-report-script.test.js` 存在（vitest 单测，由 generator 从 sprints/.../tests/ 复制到此路径）
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-report-script.test.js');console.log('OK')"

- [x] [ARTIFACT] 脚本不含 thickness:"done"（stale 已修）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/harness-report.mjs','utf8');if(/thickness.*[\"']done[\"']|[\"']done[\"'].*thickness/.test(c)){console.error('FAIL: stale thickness:done 仍存在');process.exit(1);}console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual:bash，evaluator 直接跑；journey_type=autonomous）

- [x] [BEHAVIOR] Golden Path Step 1 — 脚本文件存在，缺参数时输出 usage/error（CLI 入口正确）
  Test: manual:bash -c 'test -f packages/brain/scripts/harness-report.mjs || { echo "FAIL: 脚本不存在"; exit 1; }; node packages/brain/scripts/harness-report.mjs 2>&1 | grep -qiE "task-id|sprint-dir|usage|required|error" || { echo "FAIL: 缺参数无错误提示"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] Golden Path Step 2a — 脚本在 fixture sprint-dir 生成 harness-report.md + learning.md + index.html
  Test: manual:bash -c 'FIXTURE="sprints/06111555-forensics-no-overwrite-r2"; TASK_ID=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "INSERT INTO tasks (title, task_type, status, priority) VALUES ('"'"'behavior-test-report'"'"', '"'"'harness_report'"'"', '"'"'in_progress'"'"', '"'"'P3'"'"') RETURNING id" 2>/dev/null | awk '"'"'NF{print $1; exit}'"'"'); FEAT_ID=$(curl -sf -X POST "localhost:5221/api/brain/journey_features" -H "Content-Type: application/json" -d '"'"'{"name":"behavior-rpt-feat","kind":"feature","status":"planned"}'"'"' | jq -r ".id"); node packages/brain/scripts/harness-report.mjs --sprint-dir "$FIXTURE" --task-id "$TASK_ID" --pr-url "https://github.com/test/repo/pull/1" --feature-id "$FEAT_ID"; true; test -f "${FIXTURE}/harness-report.md" || { echo "FAIL: harness-report.md 未生成"; exit 1; }; grep -qE "Sprint:|PR #|━━|harness" "${FIXTURE}/harness-report.md" || { echo "FAIL: harness-report.md 格式不符"; exit 1; }; test -f "${FIXTURE}/learning.md" || { echo "FAIL: learning.md 未生成"; exit 1; }; test -f "${FIXTURE}/index.html" || { echo "FAIL: index.html 未生成"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] Golden Path Step 2b — 脚本调用后 task status 变 completed
  Test: manual:bash -c 'FIXTURE="sprints/06111555-forensics-no-overwrite-r2"; TASK_ID=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "INSERT INTO tasks (title, task_type, status, priority) VALUES ('"'"'behavior-test-task-status'"'"', '"'"'harness_report'"'"', '"'"'in_progress'"'"', '"'"'P3'"'"') RETURNING id" 2>/dev/null | awk '"'"'NF{print $1; exit}'"'"'); FEAT_ID=$(curl -sf -X POST "localhost:5221/api/brain/journey_features" -H "Content-Type: application/json" -d '"'"'{"name":"behavior-rpt-feat2","kind":"feature","status":"planned"}'"'"' | jq -r ".id"); node packages/brain/scripts/harness-report.mjs --sprint-dir "$FIXTURE" --task-id "$TASK_ID" --pr-url "https://github.com/test/repo/pull/1" --feature-id "$FEAT_ID"; true; TASK_STATUS=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID" | jq -r ".status"); [ "$TASK_STATUS" = "completed" ] || { echo "FAIL: task status=$TASK_STATUS，期望 completed"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] Golden Path Step 2c — feature status 变 done，且 thickness:done 被 Brain 400 拒绝（stale fix 双验）
  Test: manual:bash -c 'FIXTURE="sprints/06111555-forensics-no-overwrite-r2"; FEAT_ID=$(curl -sf -X POST "localhost:5221/api/brain/journey_features" -H "Content-Type: application/json" -d '"'"'{"name":"behavior-stale-fix-feat","kind":"feature","status":"planned"}'"'"' | jq -r ".id"); TASK_ID=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "INSERT INTO tasks (title, task_type, status, priority) VALUES ('"'"'behavior-stale-test'"'"', '"'"'harness_report'"'"', '"'"'in_progress'"'"', '"'"'P3'"'"') RETURNING id" 2>/dev/null | awk '"'"'NF{print $1; exit}'"'"'); node packages/brain/scripts/harness-report.mjs --sprint-dir "$FIXTURE" --task-id "$TASK_ID" --pr-url "https://github.com/test/repo/pull/1" --feature-id "$FEAT_ID"; true; FEAT_STATUS=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "SELECT status FROM journey_features WHERE id='"'"'$FEAT_ID'"'"'" | tr -d '"'"' '"'"'); [ "$FEAT_STATUS" = "done" ] || { echo "FAIL: feature status=$FEAT_STATUS，期望 done"; exit 1; }; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "localhost:5221/api/brain/journey_features/$FEAT_ID" -H "Content-Type: application/json" -d '"'"'{"thickness":"done"}'"'"'); [ "$CODE" = "400" ] || { echo "FAIL: thickness:done 应被 Brain 400 拒绝，got $CODE"; exit 1; }; echo OK'
  期望: OK（feature.status=done + thickness:done → 400）

- [x] [BEHAVIOR] Golden Path Step 2e — notes POST 运行时验证（分步汇总含 notes 步骤状态；task PATCH 不受 notes 502 影响）
  Test: manual:bash -c 'FIXTURE="sprints/06111555-forensics-no-overwrite-r2"; TASK_ID=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "INSERT INTO tasks (title, task_type, status, priority) VALUES ('"'"'behavior-notes-test'"'"', '"'"'harness_report'"'"', '"'"'in_progress'"'"', '"'"'P3'"'"') RETURNING id" 2>/dev/null | awk '"'"'NF{print $1; exit}'"'"'); FEAT_ID=$(curl -sf -X POST "localhost:5221/api/brain/journey_features" -H "Content-Type: application/json" -d '"'"'{"name":"behavior-notes-feat","kind":"feature","status":"planned"}'"'"' | jq -r ".id"); OUTPUT=$(node packages/brain/scripts/harness-report.mjs --sprint-dir "$FIXTURE" --task-id "$TASK_ID" --pr-url "https://github.com/test/repo/pull/1" --feature-id "$FEAT_ID" 2>&1) || true; echo "$OUTPUT" | grep -qiE "(note|report.note)" || { echo "FAIL: 分步汇总无 notes 步骤输出 output=$OUTPUT"; exit 1; }; TASK_STATUS=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID" | jq -r ".status"); [ "$TASK_STATUS" = "completed" ] || { echo "FAIL: notes 非阻断，task PATCH 不应受 notes 502 影响 status=$TASK_STATUS"; exit 1; }; echo OK'
  期望: OK（notes 步骤出现在汇总；task status=completed）

- [x] [BEHAVIOR] Golden Path Step 3 — registry upsert 幂等（第二次运行后条目数不增；第二次 exit 1 为预期行为）
  Test: manual:bash -c 'FIXTURE="sprints/06111555-forensics-no-overwrite-r2"; TASK_ID=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "INSERT INTO tasks (title, task_type, status, priority) VALUES ('"'"'behavior-idemp-test'"'"', '"'"'harness_report'"'"', '"'"'in_progress'"'"', '"'"'P3'"'"') RETURNING id" 2>/dev/null | awk '"'"'NF{print $1; exit}'"'"'); FEAT_ID=$(curl -sf -X POST "localhost:5221/api/brain/journey_features" -H "Content-Type: application/json" -d '"'"'{"name":"behavior-idemp-feat","kind":"feature","status":"planned"}'"'"' | jq -r ".id"); node packages/brain/scripts/harness-report.mjs --sprint-dir "$FIXTURE" --task-id "$TASK_ID" --pr-url "https://github.com/test/repo/pull/2" --feature-id "$FEAT_ID"; true; COUNT_BEFORE=$(curl -sf "localhost:5221/api/brain/registry?limit=1000" | jq ". | length"); IDEMP_EXIT=0; node packages/brain/scripts/harness-report.mjs --sprint-dir "$FIXTURE" --task-id "$TASK_ID" --pr-url "https://github.com/test/repo/pull/2" --feature-id "$FEAT_ID" 2>&1 | tail -3 || IDEMP_EXIT=$?; COUNT_AFTER=$(curl -sf "localhost:5221/api/brain/registry?limit=1000" | jq ". | length"); [ "$COUNT_AFTER" -le "$COUNT_BEFORE" ] || { echo "FAIL: registry 增长 before=$COUNT_BEFORE after=$COUNT_AFTER（非幂等）"; exit 1; }; echo "OK: registry 幂等验证通过（idempotent_exit=$IDEMP_EXIT）"'
  期望: OK（registry 条目数不增；idempotent_exit=1 属预期，不强断为 0）

- [x] [BEHAVIOR] Golden Path Step 4 — 宿主 git status 和 branch 在脚本执行前后完全一致（git 隔离）
  Test: manual:bash -c 'FIXTURE="sprints/06111555-forensics-no-overwrite-r2"; TASK_ID=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "INSERT INTO tasks (title, task_type, status, priority) VALUES ('"'"'behavior-git-test'"'"', '"'"'harness_report'"'"', '"'"'in_progress'"'"', '"'"'P3'"'"') RETURNING id" 2>/dev/null | awk '"'"'NF{print $1; exit}'"'"'); FEAT_ID=$(curl -sf -X POST "localhost:5221/api/brain/journey_features" -H "Content-Type: application/json" -d '"'"'{"name":"behavior-git-feat","kind":"feature","status":"planned"}'"'"' | jq -r ".id"); GIT_BEFORE=$(git -C /workspace status --porcelain); BRANCH_BEFORE=$(git -C /workspace branch --show-current); node packages/brain/scripts/harness-report.mjs --sprint-dir "$FIXTURE" --task-id "$TASK_ID" --pr-url "https://github.com/test/repo/pull/3" --feature-id "$FEAT_ID" 2>&1 | tail -3 || true; GIT_AFTER=$(git -C /workspace status --porcelain); BRANCH_AFTER=$(git -C /workspace branch --show-current); [ "$GIT_AFTER" = "$GIT_BEFORE" ] || { echo "FAIL: git status 被脚本修改"; exit 1; }; [ "$BRANCH_AFTER" = "$BRANCH_BEFORE" ] || { echo "FAIL: git branch 被脚本修改"; exit 1; }; echo OK'
  期望: OK（git status 字节级不变；branch 不变）

- [x] [BEHAVIOR] 边界情况 Step 5 — sprint-prd.md 缺失时 WARN+跳过，task PATCH 仍成功（其余步骤继续）
  Test: manual:bash -c 'EMPTY_FIXTURE=$(mktemp -d); TASK_ID=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "INSERT INTO tasks (title, task_type, status, priority) VALUES ('"'"'behavior-missing-prd'"'"', '"'"'harness_report'"'"', '"'"'in_progress'"'"', '"'"'P3'"'"') RETURNING id" 2>/dev/null | awk '"'"'NF{print $1; exit}'"'"'); FEAT_ID=$(curl -sf -X POST "localhost:5221/api/brain/journey_features" -H "Content-Type: application/json" -d '"'"'{"name":"behavior-missing-prd-feat","kind":"feature","status":"planned"}'"'"' | jq -r ".id"); OUTPUT=$(node packages/brain/scripts/harness-report.mjs --sprint-dir "$EMPTY_FIXTURE" --task-id "$TASK_ID" --pr-url "https://github.com/test/repo/pull/1" --feature-id "$FEAT_ID" 2>&1) || true; [ -n "$OUTPUT" ] || { echo "FAIL: 脚本无输出"; exit 1; }; echo "$OUTPUT" | grep -qiE "warn|skip|not found|缺失|missing" || { echo "FAIL: 无 WARN/skip 输出 output=$OUTPUT"; exit 1; }; TASK_STATUS=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID" | jq -r ".status"); [ "$TASK_STATUS" = "completed" ] || { echo "FAIL: sprint-prd.md 缺失不应阻断 task PATCH status=$TASK_STATUS"; exit 1; }; rm -rf "$EMPTY_FIXTURE"; echo OK'
  期望: OK（WARN/skip 出现；task status=completed）

- [x] [BEHAVIOR] 边界情况 Step 6 — 某步失败（feature 404）后续步骤继续 + exit 1 + ❌ 汇总
  Test: manual:bash -c 'FIXTURE="sprints/06111555-forensics-no-overwrite-r2"; TASK_ID=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "INSERT INTO tasks (title, task_type, status, priority) VALUES ('"'"'behavior-partial-fail'"'"', '"'"'harness_report'"'"', '"'"'in_progress'"'"', '"'"'P3'"'"') RETURNING id" 2>/dev/null | awk '"'"'NF{print $1; exit}'"'"'); INVALID_FEAT="00000000-0000-0000-0000-000000000000"; EXIT_CODE=0; OUTPUT=$(node packages/brain/scripts/harness-report.mjs --sprint-dir "$FIXTURE" --task-id "$TASK_ID" --pr-url "https://github.com/test/repo/pull/1" --feature-id "$INVALID_FEAT" 2>&1) || EXIT_CODE=$?; [ "$EXIT_CODE" -ne 0 ] || { echo "FAIL: 部分失败（feature 404）时脚本应 exit 1"; exit 1; }; echo "$OUTPUT" | grep -qE "❌|FAIL" || { echo "FAIL: 脚本无失败汇总（❌/FAIL 标志）output=$OUTPUT"; exit 1; }; TASK_STATUS=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID" | jq -r ".status"); [ "$TASK_STATUS" = "completed" ] || { echo "FAIL: feature PATCH 失败后 task PATCH 应继续执行 status=$TASK_STATUS"; exit 1; }; echo OK'
  期望: OK（exit 1；❌ 汇总存在；task status=completed）
