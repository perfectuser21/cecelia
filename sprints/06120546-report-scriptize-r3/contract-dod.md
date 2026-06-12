---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: harness-report.mjs 脚本化 + 宿主 git 零接触（R3）

**范围**: `packages/brain/scripts/harness-report.mjs` 新建（7 步顺序 CLI 脚本）+ vitest 单测 + reportNode spawn 路径改接本脚本
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/scripts/harness-report.mjs` 存在且为有效 ESM 模块
  Test: node -e "import('packages/brain/scripts/harness-report.mjs').catch(e=>{ if(!e.message.includes('missing argument'))process.exit(1) })"

- [ ] [ARTIFACT] `packages/brain/scripts/__tests__/harness-report.test.mjs` 存在且含 describe 块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/__tests__/harness-report.test.mjs','utf8');if(!c.includes('describe'))process.exit(1)"

- [ ] [ARTIFACT] `harness-initiative.graph.js` reportNode 含 `harness-report.mjs` spawn 调用路径
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('harness-report.mjs'))process.exit(1)"

- [ ] [ARTIFACT] `harness-report.mjs` awk 修复 + thickness 枚举正确 — 不含 `awk '{print $1}'` 表名提取旧模式；不含废止 thickness 值 `"done"`（有效枚举 thin/medium/thick/mature）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/harness-report.mjs','utf8'); if(c.includes(\"awk '{print \$1}'\"))throw new Error('awk $1 found'); if(c.includes('\"thickness\":\"done\"')||c.includes(\"'thickness':'done'\"))throw new Error('invalid thickness done'); console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] S2 文件生成 — harness-report.md 存在且含摘要关键字（GAN轮数/步骤耗时/Sprint）
  Test: manual:bash -c '
    FIXTURE=$(mktemp -d)
    cat > "${FIXTURE}/sprint-prd.md" << PEOF
# Sprint PRD — fixture
## journey_type: autonomous
PEOF
    echo '"'"'{"gan_rounds":2,"final_e2e_verdict":"PASS","pr_url":"https://github.com/test/1"}'"'"' > "${FIXTURE}/evaluator-output.json"
    node packages/brain/scripts/harness-report.mjs \
      --sprint-dir "${FIXTURE}" \
      --task-id "00000000-0000-0000-0000-000000000001" \
      --pr-url "https://github.com/test/1" \
      --feature-id "fake" 2>&1
    [ -f "${FIXTURE}/harness-report.md" ] || { echo "FAIL: harness-report.md 不存在"; exit 1; }
    grep -qE "(GAN|步骤耗时|Sprint)" "${FIXTURE}/harness-report.md" || { echo "FAIL: harness-report.md 缺摘要内容关键字"; exit 1; }
    echo OK
    rm -rf "${FIXTURE}"
  '
  期望: OK

- [ ] [BEHAVIOR] S3+S4 文件生成 — learning.md 存在且含内容关键字，index.html 含 HTML 结构
  Test: manual:bash -c '
    FIXTURE=$(mktemp -d)
    echo "# test" > "${FIXTURE}/sprint-prd.md"
    node packages/brain/scripts/harness-report.mjs \
      --sprint-dir "${FIXTURE}" \
      --task-id "00000000-0000-0000-0000-000000000001" \
      --pr-url "https://github.com/test/1" \
      --feature-id "fake" 2>&1
    [ -f "${FIXTURE}/learning.md" ] || { echo "FAIL: learning.md 不存在"; exit 1; }
    grep -qiE "sprint|learning|placeholder|洞察|report" "${FIXTURE}/learning.md" || { echo "FAIL: learning.md 无内容关键字 (sprint/learning/placeholder/report)"; exit 1; }
    [ -f "${FIXTURE}/index.html" ] && grep -qi "html" "${FIXTURE}/index.html" || { echo "FAIL: index.html"; exit 1; }
    echo OK
    rm -rf "${FIXTURE}"
  '
  期望: OK

- [ ] [BEHAVIOR] S5 Brain API 回写 — tasks.result 含 pr_url（时间窗防造假）
  Test: manual:bash -c '
    DB="${DB_URL:-postgresql://localhost/cecelia}"
    FIXTURE=$(mktemp -d)
    echo "# test" > "${FIXTURE}/sprint-prd.md"
    TEST_TID=$(psql "$DB" -t -c "INSERT INTO tasks (title,task_type,status,priority,payload) VALUES ('"'"'s5-test'"'"','"'"'harness_report'"'"','"'"'in_progress'"'"','"'"'P2'"'"','"'"'{}'"'"') RETURNING id" | tr -d " \n")
    node packages/brain/scripts/harness-report.mjs \
      --sprint-dir "${FIXTURE}" \
      --task-id "${TEST_TID}" \
      --pr-url "https://github.com/test/999" \
      --feature-id "fake" 2>&1
    PR=$(psql "$DB" -t -c "SELECT result->>'"'"'pr_url'"'"' FROM tasks WHERE id='"'"'${TEST_TID}'"'"' AND updated_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " \n")
    [ -n "$PR" ] || { echo "FAIL: result->>pr_url 为空或时间窗外"; exit 1; }
    echo "OK pr_url=$PR"
    psql "$DB" -c "DELETE FROM tasks WHERE id='"'"'${TEST_TID}'"'"'" 2>/dev/null || true
    rm -rf "${FIXTURE}"
  '
  期望: OK pr_url=https://github.com/test/999

- [ ] [BEHAVIOR] S6 Brain API 回写 — journey_features.status = done（psql 直查，带时间窗防造假）
  Test: manual:bash -c '
    DB="${DB_URL:-postgresql://localhost/cecelia}"
    FIXTURE=$(mktemp -d)
    echo "# test" > "${FIXTURE}/sprint-prd.md"
    FID=$(psql "$DB" -t -c "INSERT INTO journey_features (name,journey_id,kind,status,thickness) VALUES ('"'"'dod-s6-test'"'"','"'"'cecelia-harness-pipeline'"'"','"'"'feature'"'"','"'"'active'"'"','"'"'thin'"'"') RETURNING id" | tr -d " \n")
    TID=$(psql "$DB" -t -c "INSERT INTO tasks (title,task_type,status,priority,payload) VALUES ('"'"'s6-test'"'"','"'"'harness_report'"'"','"'"'in_progress'"'"','"'"'P2'"'"','"'"'{}'"'"') RETURNING id" | tr -d " \n")
    node packages/brain/scripts/harness-report.mjs \
      --sprint-dir "${FIXTURE}" \
      --task-id "${TID}" \
      --pr-url "https://github.com/test/1" \
      --feature-id "${FID}" 2>&1
    STATUS=$(psql "$DB" -t -c "SELECT status FROM journey_features WHERE id='"'"'${FID}'"'"' AND updated_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " \n")
    [ "$STATUS" = "done" ] || { echo "FAIL: status=${STATUS} (expected done，或时间窗外)"; exit 1; }
    echo "OK"
    psql "$DB" -c "DELETE FROM tasks WHERE id='"'"'${TID}'"'"'; DELETE FROM journey_features WHERE id='"'"'${FID}'"'"'" 2>/dev/null || true
    rm -rf "${FIXTURE}"
  '
  期望: OK

- [ ] [BEHAVIOR] S7 Brain API 创建 note — notes 表 5 分钟内新增记录
  Test: manual:bash -c '
    DB="${DB_URL:-postgresql://localhost/cecelia}"
    FIXTURE=$(mktemp -d)
    echo "# test" > "${FIXTURE}/sprint-prd.md"
    TID=$(psql "$DB" -t -c "INSERT INTO tasks (title,task_type,status,priority,payload) VALUES ('"'"'s7-test'"'"','"'"'harness_report'"'"','"'"'in_progress'"'"','"'"'P2'"'"','"'"'{}'"'"') RETURNING id" | tr -d " \n")
    node packages/brain/scripts/harness-report.mjs \
      --sprint-dir "${FIXTURE}" \
      --task-id "${TID}" \
      --pr-url "https://github.com/test/1" \
      --feature-id "fake" 2>&1
    COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM notes WHERE created_at > NOW() - interval '"'"'5 minutes'"'"' AND (title LIKE '"'"'%Report%'"'"' OR title LIKE '"'"'%harness%'"'"' OR title LIKE '"'"'%Sprint%'"'"')" | tr -d " ")
    [ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: 无本轮 note（5min 窗）count=${COUNT}"; exit 1; }
    echo "OK count=${COUNT}"
    psql "$DB" -c "DELETE FROM tasks WHERE id='"'"'${TID}'"'"'" 2>/dev/null || true
    rm -rf "${FIXTURE}"
  '
  期望: OK count>=1

- [ ] [BEHAVIOR] git 零接触 — 执行前后 git status --porcelain 相同
  Test: manual:bash -c '
    FIXTURE=$(mktemp -d)
    echo "# test" > "${FIXTURE}/sprint-prd.md"
    GIT_BEFORE=$(git status --porcelain 2>/dev/null | sort | md5sum)
    node packages/brain/scripts/harness-report.mjs \
      --sprint-dir "${FIXTURE}" \
      --task-id "00000000-0000-0000-0000-000000000001" \
      --pr-url "https://github.com/test/1" \
      --feature-id "fake" 2>&1
    GIT_AFTER=$(git status --porcelain 2>/dev/null | sort | md5sum)
    [ "$GIT_BEFORE" = "$GIT_AFTER" ] || { echo "FAIL: git status 变化"; exit 1; }
    echo OK
    rm -rf "${FIXTURE}"
  '
  期望: OK

- [ ] [BEHAVIOR] PARTIAL_FAIL — Brain API 不可达时文件仍生成，exit非零，stdout含PARTIAL_FAIL
  Test: manual:bash -c '
    FIXTURE=$(mktemp -d)
    echo "# test" > "${FIXTURE}/sprint-prd.md"
    OUT=$(BRAIN_URL=http://localhost:19999 node packages/brain/scripts/harness-report.mjs \
      --sprint-dir "${FIXTURE}" \
      --task-id "00000000-0000-0000-0000-000000000099" \
      --pr-url "https://github.com/test/1" \
      --feature-id "fake" 2>&1) || EXIT=$?
    [ "${EXIT:-0}" -ne 0 ] || { echo "FAIL: 期望非零退出"; exit 1; }
    echo "$OUT" | grep -q "PARTIAL_FAIL" || { echo "FAIL: 无 PARTIAL_FAIL 字样"; exit 1; }
    [ -f "${FIXTURE}/harness-report.md" ] || { echo "FAIL: harness-report.md 未生成"; exit 1; }
    echo OK
    rm -rf "${FIXTURE}"
  '
  期望: OK

- [ ] [BEHAVIOR] 幂等性 — 重复执行第二次 exit code = 0
  Test: manual:bash -c '
    FIXTURE=$(mktemp -d)
    echo "# test" > "${FIXTURE}/sprint-prd.md"
    CMD="node packages/brain/scripts/harness-report.mjs --sprint-dir ${FIXTURE} --task-id 00000000-0000-0000-0000-000000000001 --pr-url https://github.com/test/1 --feature-id fake"
    $CMD 2>&1
    $CMD 2>&1; EXIT=$?
    [ "$EXIT" -eq 0 ] || { echo "FAIL: 重复执行 exit=${EXIT}"; exit 1; }
    echo OK
    rm -rf "${FIXTURE}"
  '
  期望: OK

- [ ] [BEHAVIOR] feature-id 为空时跳过 S6 不报错
  Test: manual:bash -c '
    FIXTURE=$(mktemp -d)
    echo "# test" > "${FIXTURE}/sprint-prd.md"
    EXIT=0
    node packages/brain/scripts/harness-report.mjs \
      --sprint-dir "${FIXTURE}" \
      --task-id "00000000-0000-0000-0000-000000000001" \
      --pr-url "https://github.com/test/1" \
      --feature-id "" 2>&1 || EXIT=$?
    [ -f "${FIXTURE}/harness-report.md" ] || { echo "FAIL: 空 feature-id 时文件仍应生成"; exit 1; }
    echo "OK exit=${EXIT}"
    rm -rf "${FIXTURE}"
  '
  期望: OK（harness-report.md 存在，无 crash）

- [ ] [BEHAVIOR] error path — 缺少必要参数时 exit 非零 + 错误提示
  Test: manual:bash -c '
    node packages/brain/scripts/harness-report.mjs 2>&1; EXIT=$?
    [ "$EXIT" -ne 0 ] || { echo "FAIL: 缺少参数时应 exit 非零"; exit 1; }
    echo "OK exit=${EXIT}"
  '
  期望: OK exit 非零

- [ ] [BEHAVIOR] 降级报告 — evaluator-output.json 缺失时仍生成 harness-report.md 且含 N/A 占位
  Test: manual:bash -c '
    FIXTURE=$(mktemp -d)
    echo "# test prd" > "${FIXTURE}/sprint-prd.md"
    node packages/brain/scripts/harness-report.mjs \
      --sprint-dir "${FIXTURE}" \
      --task-id "00000000-0000-0000-0000-000000000001" \
      --pr-url "https://github.com/test/1" \
      --feature-id "fake" 2>&1
    [ -f "${FIXTURE}/harness-report.md" ] || { echo "FAIL: 降级场景 harness-report.md 未生成"; exit 1; }
    grep -qi "N/A\|n/a\|missing\|not found\|降级" "${FIXTURE}/harness-report.md" || { echo "FAIL: 降级报告未含 N/A 占位"; exit 1; }
    echo OK
    rm -rf "${FIXTURE}"
  '
  期望: OK

gate-allow: cheat/or-true BEHAVIOR（S5/S6/S7）末尾 teardown 清理行为删除测试数据，属非断言操作，清理失败不影响验收结论
