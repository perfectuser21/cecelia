---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness CI 防线三件套（R8）

**范围**: 新建 changed-test-router.mjs（fs 依赖选测）+ skill 契约测试（5 类不变量）+ skill-contract-check.mjs（纯函数检查器）+ contract-exists.mjs（合同存在性）+ 测试 fixtures + brain-ci-deploy.yml 接线。不改 skill 业务逻辑，不改既有 deploy job。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] changed-test-router.mjs 存在且导出/可执行映射逻辑
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/scripts/ci/changed-test-router.mjs','utf8');if(!c.includes('extraTests'))process.exit(1)"

- [ ] [ARTIFACT] skill-contract-check.mjs 存在且导出 4 个检查器
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/ci/skill-contract-check.mjs','utf8');['checkEvaluator','checkReviewer','checkGenerator','checkProposer'].forEach(k=>{if(!c.includes(k))process.exit(1)})"

- [ ] [ARTIFACT] skill 契约测试 vitest 文件存在
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/ci/__tests__/skill-contract.test.mjs','utf8');if(!c.includes('skill-contract')&&!c.includes('skill_contract')&&!/describe|it\(/.test(c))process.exit(1)"

- [ ] [ARTIFACT] contract-exists.mjs 存在
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/ci/contract-exists.mjs','utf8');if(!c.includes('contract-draft'))process.exit(1)"

- [ ] [ARTIFACT] 三份 fixture 存在（缺合同/完整/非harness diff 清单）
  Test: node -e "['diff-missing-contract.txt','diff-complete.txt','diff-non-harness.txt'].forEach(f=>require('fs').accessSync('packages/brain/scripts/ci/__tests__/fixtures/'+f))"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous — 真实 node 进程/退出码）

- [ ] [BEHAVIOR] (Golden Path Step1 正向) changed-test-router 对 evaluator SKILL.md 输出含 skill 契约测试的清单
  Test: manual:bash -c 'OUT=$(node packages/brain/scripts/ci/changed-test-router.mjs packages/workflows/skills/harness-evaluator/SKILL.md); echo "$OUT"; echo "$OUT" | jq -e ".extraTests | map(test(\"skill-contract\")) | any" || exit 1; echo OK'
  期望: OK（清单非空且含契约测试路径）

- [ ] [BEHAVIOR] (Golden Path Step1 负向) changed-test-router 对非 skill 文件不误报契约测试
  Test: manual:bash -c 'OUT=$(node packages/brain/scripts/ci/changed-test-router.mjs packages/brain/src/server.js); echo "$OUT"; echo "$OUT" | jq -e ".extraTests | map(test(\"skill-contract\")) | any | not" || exit 1; echo OK'
  期望: OK（非 skill 文件不命中契约测试）

- [ ] [BEHAVIOR] (Golden Path Step2) skill 契约测试对现网快照全绿，5 类不变量全 PASS
  Test: manual:bash -c 'npx vitest run packages/brain/scripts/ci/__tests__/skill-contract.test.mjs --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] (Golden Path Step3) 篡改 evaluator 副本删 env_missing → 检查器报红且点名缺失不变量
  Test: manual:bash -c 'node -e '"'"'import("./packages/brain/scripts/ci/skill-contract-check.mjs").then(m=>{const fs=require("fs");const c=fs.readFileSync("packages/workflows/skills/harness-evaluator/SKILL.md","utf8");const t=c.replace(/env_missing/g,"ENV_REMOVED");const r=m.checkEvaluator(t);console.log("missing="+JSON.stringify(r.missing));if(r.ok||!r.missing.includes("env_missing"))process.exit(1);console.log("OK")})'"'"''
  期望: OK（ok=false 且 missing 含 env_missing）

- [ ] [BEHAVIOR] (Golden Path Step3 边界) 篡改作用于副本，真实 skill 文件未被污染
  Test: manual:bash -c 'grep -q "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md || { echo "FAIL: 真实文件被污染"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] (Golden Path Step4 缺合同) 缺 contract-draft.md 的 diff → 非零退出且 stderr 点名缺失文件
  Test: manual:bash -c 'ERR=$(node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-missing-contract.txt 2>&1 || true); echo "$ERR"; if node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-missing-contract.txt; then echo "FAIL: 应非零退出"; exit 1; fi; echo "$ERR" | grep -q "contract-draft.md" || { echo "FAIL: 未点名"; exit 1; }; echo OK'
  期望: OK（非零退出 + 点名 contract-draft.md）

- [ ] [BEHAVIOR] (Golden Path Step4 完整+非harness) 完整 diff 退出 0；非 harness diff 退出 0 不误拦
  Test: manual:bash -c 'node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-complete.txt || { echo "FAIL: 完整合同应退出0"; exit 1; }; node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-non-harness.txt || { echo "FAIL: 非harness被误拦"; exit 1; }; echo OK'
  期望: OK（两者均 exit 0）

- [ ] [BEHAVIOR] (Golden Path Step5) brain-ci-deploy.yml 接 skills 路径 + PR 触发 + 三件套，既有 deploy job 保留，yaml 合法
  Test: manual:bash -c 'F=.github/workflows/brain-ci-deploy.yml; grep -q "packages/workflows/skills" $F || exit 1; grep -q "pull_request" $F || exit 1; grep -Eq "changed-test-router|skill-contract|contract-exists" $F || exit 1; grep -q "Deploy Brain (Gate 3)" $F || exit 1; python3 -c "import yaml; yaml.safe_load(open(\"$F\"))" || exit 1; echo OK'
  期望: OK
