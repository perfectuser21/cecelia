contract_branch: cp-06121127-ws-badaf654-ws1
sprint_dir: sprints/06120700-ci-defense-r3

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness CI 防线三件套 R3

**范围**: changed-test-router + skill 契约测试套件 + contract-existence-check + brain-ci.yml 接线
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/scripts/ci/changed-test-router.mjs` 存在且可执行
  Test: node -e "require('fs').accessSync('packages/brain/scripts/ci/changed-test-router.mjs', require('fs').constants.R_OK)"

- [x] [ARTIFACT] `packages/workflows/skills/__tests__/skill-contract.test.ts` 存在
  Test: node -e "require('fs').accessSync('packages/workflows/skills/__tests__/skill-contract.test.ts', require('fs').constants.R_OK)"

- [x] [ARTIFACT] `packages/brain/scripts/ci/contract-existence-check.mjs` 存在且可执行
  Test: node -e "require('fs').accessSync('packages/brain/scripts/ci/contract-existence-check.mjs', require('fs').constants.R_OK)"

- [x] [ARTIFACT] `.github/workflows/brain-ci.yml` 存在
  Test: node -e "require('fs').accessSync('.github/workflows/brain-ci.yml', require('fs').constants.R_OK)"

- [x] [ARTIFACT] `skill-contract.test.ts` 内含 4 个 skill 的 describe 块
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/__tests__/skill-contract.test.ts','utf8');['harness-evaluator','harness-contract-reviewer','harness-generator','harness-contract-proposer'].forEach(s=>{if(!c.includes(s))throw new Error('缺 '+s+' describe 块')})"

- [x] [ARTIFACT] `skill-contract.test.ts` 读取 `SKILLS_DIR` 环境变量（禁止硬编码路径，守卫3依赖此接口）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/__tests__/skill-contract.test.ts','utf8');if(!c.includes('SKILLS_DIR'))throw new Error('缺 SKILLS_DIR 环境变量读取 — 守卫3篡改测试将失效')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 守卫 1 — changed-test-router 对 evaluator SKILL.md 输出 ≥ 1 条 test ID 且含 b31-eval-cookie-isolate
  Test: manual:bash -c 'OUTPUT=$(node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md); [ $? -eq 0 ] || exit 1; [ -n "$OUTPUT" ] || { echo "FAIL: 输出为空"; exit 1; }; LINE_COUNT=$(echo "$OUTPUT" | grep -c "." || true); [ "$LINE_COUNT" -ge 1 ] || { echo "FAIL: 输出行数 $LINE_COUNT < 1"; exit 1; }; echo "$OUTPUT" | grep -q "b31-eval-cookie-isolate" || { echo "FAIL: 已知依赖 b31-eval-cookie-isolate 未出现（PRD 要求覆盖所有 fs 依赖）"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 守卫 2 — skill 契約 vitest 套件全绿（4 skill 快照通过）
  Test: manual:bash -c 'cd packages/brain && npx vitest run ../../packages/workflows/skills/__tests__/skill-contract.test.ts --reporter=verbose; EXIT=$?; cd -; [ "$EXIT" -eq 0 ] || { echo "FAIL: skill-contract vitest 失败 exit=$EXIT"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 守卫 3 — 删除 evaluator env_missing 段 → vitest 报红且错误含 "env_missing"
  Test: manual:bash -c 'TMP=$(mktemp -d); cp -r packages/workflows/skills/harness-contract-reviewer packages/workflows/skills/harness-generator packages/workflows/skills/harness-contract-proposer "$TMP/"; mkdir -p "$TMP/harness-evaluator"; grep -v "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md > "$TMP/harness-evaluator/SKILL.md"; OUT=$(cd packages/brain && SKILLS_DIR="$TMP" npx vitest run ../../packages/workflows/skills/__tests__/skill-contract.test.ts 2>&1 || true); cd -; rm -rf "$TMP"; echo "$OUT" | grep -iqE "FAIL|failed|× " || { echo "FAIL: vitest 未报失败（篡改后应失败）"; exit 1; }; echo "$OUT" | grep -iq "env_missing" || { echo "FAIL: 错误信息未具名 env_missing"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 守卫 4 — 缺 contract-draft.md 时 existence-check 返回非零退出且指明路径
  Test: manual:bash -c 'printf "sprints/06120700-ci-defense-r3/task-plan.json\nsprints/06120700-ci-defense-r3/contract-dod.md\n" > /tmp/ci-defense-missing.txt; OUT=$(node packages/brain/scripts/ci/contract-existence-check.mjs --diff-fixture /tmp/ci-defense-missing.txt 2>&1 || true); CODE=$?; [ "$CODE" -ne 0 ] || { echo "FAIL: 缺 contract-draft.md 但 exit=0"; exit 1; }; echo "$OUT" | grep -q "contract-draft.md" || { echo "FAIL: 错误输出未指明缺失路径 contract-draft.md"; exit 1; }; echo "exit=$CODE 且含缺失路径 OK"'
  期望: exit=非0 且含缺失路径 OK

- [x] [BEHAVIOR] 守卫 4 — 含 contract-draft.md 时 existence-check 返回零退出
  Test: manual:bash -c 'printf "sprints/06120700-ci-defense-r3/contract-draft.md\nsprints/06120700-ci-defense-r3/task-plan.json\n" > /tmp/ci-defense-complete.txt; node packages/brain/scripts/ci/contract-existence-check.mjs --diff-fixture /tmp/ci-defense-complete.txt; CODE=$?; [ "$CODE" -eq 0 ] || { echo "FAIL: 含 contract-draft.md 但 exit=$CODE"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 守卫 5 — brain-ci.yml yaml 语法通过且含 skills 触发路径且引用守卫脚本
  Test: manual:bash -c 'test -f .github/workflows/brain-ci.yml || { echo "FAIL: brain-ci.yml 不存在"; exit 1; }; node -e "require(\"js-yaml\").load(require(\"fs\").readFileSync(\".github/workflows/brain-ci.yml\",\"utf8\"))" || { echo "FAIL: yaml 语法错误"; exit 1; }; grep -q "packages/workflows/skills" .github/workflows/brain-ci.yml || { echo "FAIL: 未含 skills 触发路径"; exit 1; }; grep -q "changed-test-router" .github/workflows/brain-ci.yml || { echo "FAIL: 未引用 changed-test-router 脚本"; exit 1; }; grep -q "skill-contract" .github/workflows/brain-ci.yml || { echo "FAIL: 未引用 skill-contract 测试"; exit 1; }; echo OK'
  期望: OK
