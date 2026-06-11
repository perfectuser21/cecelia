contract_branch: cp-06120554-ws-da418741-ws1
sprint_dir: sprints/06120215-ci-defense-r2

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness CI 防线 R2（--changed 漏检 + Skill 契约 + 合同存在性 Gate）

**范围**: packages/brain/scripts/ci/（路由脚本追加 + gate 新建）、packages/brain/tests/skill-contracts/（新目录）、.github/workflows/ci.yml（追加 skill 触发 + job step）
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/scripts/ci/changed-test-router.mjs` 存在，文件内含 `packages/workflows/skills` 路由规则
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/ci/changed-test-router.mjs','utf8');if(!c.includes('packages/workflows/skills'))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/scripts/ci/check-contract-exists.mjs` 存在，文件内含 `contract-draft.md` 相关字符串
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/ci/check-contract-exists.mjs','utf8');if(!c.includes('contract-draft.md'))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/tests/skill-contracts/` 目录存在，含至少一个 `.test.ts` 文件
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/tests/skill-contracts/').filter(f=>f.endsWith('.test.ts'));if(!files.length)process.exit(1)"

- [ ] [ARTIFACT] `.github/workflows/ci.yml` 含 `packages/workflows/skills` 路径触发
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('packages/workflows/skills'))process.exit(1)"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] Step 1 — changed-test-router 对 skill 文件变更输出 skill-contracts 测试路径（不得仅输出通用 unit 列表）
  Test: manual:bash -c 'OUTPUT=$(node packages/brain/scripts/ci/changed-test-router.mjs --files "packages/workflows/skills/harness-evaluator/SKILL.md"); echo "$OUTPUT" | grep -qE "packages/brain/tests/skill-contracts" || { echo "FAIL: router 未输出 skill-contracts 路径，实际: $OUTPUT"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step 2 — skill 契约 vitest 测试对当前 packages/workflows/skills/ 快照全绿（evaluator 含 env_missing 红线 + B-1.6/1.7/1.8 + 无 ws_id 残留、reviewer 7 维名对齐 ReviewerOutputSchema、generator 无 gh pr merge、proposer 含领域验证规则段）
  Test: manual:bash -c 'cd packages/brain && npx vitest run tests/skill-contracts/ --reporter=verbose 2>&1 | tee /tmp/sc-green.log; EXIT=${PIPESTATUS[0]}; [ "$EXIT" -eq 0 ] || { echo "FAIL: 契约测试未全绿 exit=$EXIT"; tail -30 /tmp/sc-green.log; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step 3 — 篡改 fixture（删去 env_missing）必使契约测试非零退出，且错误信息中含字面量 `env_missing`（不接受仅 "snapshot mismatch"）
  Test: manual:bash -c 'FIXTURE=$(mktemp /tmp/eval-tampered-XXXXXX.md); grep -v "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md > "$FIXTURE"; (cd packages/brain && EVALUATOR_SKILL_FIXTURE="$FIXTURE" npx vitest run tests/skill-contracts/ --reporter=verbose) > /tmp/tamper-test.log 2>&1; TAMPER_EXIT=$?; rm -f "$FIXTURE"; [ "$TAMPER_EXIT" -ne 0 ] || { echo "FAIL: 篡改 fixture 应非零退出但返回 0"; exit 1; }; grep -qE "env_missing" /tmp/tamper-test.log || { echo "FAIL: 篡改 fixture 未指明 env_missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step 4a — check-contract-exists.mjs 对缺合同的 sprints/ diff（stdin 无 contract-draft.md）非零退出且 stdout/stderr 含 `contract-draft.md` 字样
  Test: manual:bash -c 'printf "sprints/06120215-ci-defense-r2/src/index.ts\n" | node packages/brain/scripts/ci/check-contract-exists.mjs > /tmp/gate-neg.log 2>&1; GATE_EXIT=$?; [ "$GATE_EXIT" -ne 0 ] || { echo "FAIL: 缺合同 gate 应非零退出但返回 0"; exit 1; }; grep -q "contract-draft.md" /tmp/gate-neg.log || { echo "FAIL: gate 未指明 contract-draft.md，输出: $(cat /tmp/gate-neg.log)"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step 4b — check-contract-exists.mjs 对完整 diff（含 contract-draft.md）0 退出
  Test: manual:bash -c 'printf "sprints/06120215-ci-defense-r2/contract-draft.md\nsprints/06120215-ci-defense-r2/src/index.ts\n" | node packages/brain/scripts/ci/check-contract-exists.mjs || { echo "FAIL: 完整 fixture 应 0 退出"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step 5 — ci.yml yaml 语法合法 + 含 packages/workflows/skills 触发路径 + 含 skill 契约测试 job 引用 + skill-tests 进入 ci-passed needs 列表
  Test: manual:bash -c 'node -e "const yaml=require(\"js-yaml\");const fs=require(\"fs\");yaml.load(fs.readFileSync(\".github/workflows/ci.yml\",\"utf8\"));console.log(\"ok\")" || { echo "FAIL: ci.yml yaml 语法错误"; exit 1; }; grep -qE "packages/workflows/skills" .github/workflows/ci.yml || { echo "FAIL: ci.yml 未含 skill 路径触发"; exit 1; }; grep -qE "changed-test-router|skill-contracts" .github/workflows/ci.yml || { echo "FAIL: ci.yml 未含 skill 契约 job"; exit 1; }; grep -A60 "^  ci-passed:" .github/workflows/ci.yml | grep -qE "skill.tests" || { echo "FAIL: skill-tests 未进入 ci-passed needs 列表"; exit 1; }; echo OK'
  期望: OK
