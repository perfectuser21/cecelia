---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: 无条件核心回归闸（B1）

**范围**: regression-contract.yaml + scripts/ci/run-core-regression.sh + .github/workflows/ci.yml（新增 core-regression job，删除 regression-smoke job）
**大小**: S

---

## ARTIFACT 条目

- [ ] [ARTIFACT] regression-contract.yaml 含 `entries` 数组且至少 1 条 P0+PR trigger 非空条目
  Test: node -e "const c=require('fs').readFileSync('regression-contract.yaml','utf8');if(!c.includes('P0')||!c.includes('PR')||!c.includes('test_command'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] scripts/ci/run-core-regression.sh 文件存在
  Test: node -e "require('fs').accessSync('scripts/ci/run-core-regression.sh');console.log('OK')"

- [ ] [ARTIFACT] .github/workflows/ci.yml 含 core-regression job
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('core-regression:'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] .github/workflows/ci.yml 不含 regression-smoke job
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(/^  regression-smoke:/m.test(c))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] regression-contract.yaml 含 ≥1 条 P0 trigger=[PR] 条目（非空 test_command）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"regression-contract.yaml\",\"utf8\");if(!c.includes(\"P0\")){console.error(\"FAIL: 缺 P0\");process.exit(1);}if(!c.includes(\"PR\")){console.error(\"FAIL: 缺 PR trigger\");process.exit(1);}if(!c.includes(\"test_command\")){console.error(\"FAIL: 缺 test_command\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

- [ ] [BEHAVIOR] run-core-regression.sh 含 yq 调用 + exit 1 空守卫 + 脚本语法合法
  Test: manual:bash -c 'grep -q "yq" scripts/ci/run-core-regression.sh || { echo "FAIL: 缺 yq"; exit 1; }; grep -q "exit 1" scripts/ci/run-core-regression.sh || { echo "FAIL: 缺 exit 1"; exit 1; }; bash -n scripts/ci/run-core-regression.sh || { echo "FAIL: 语法错误"; exit 1; }; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] ci.yml core-regression job 无路径门 if（任意 PR/push 无条件触发）
  Test: manual:bash -c 'grep -q "core-regression:" .github/workflows/ci.yml || { echo "FAIL: job 不存在"; exit 1; }; SECTION=$(awk "/^  core-regression:/{found=1} found && /^  [a-z]/ && !/^  core-regression:/{found=0} found{print}" .github/workflows/ci.yml); echo "$SECTION" | grep -qE "if:.*contains\(needs\.changes" && { echo "FAIL: 含路径门"; exit 1; }; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] ci.yml 不含 regression-smoke job 及 golden-smoke.test.ts 扫描逻辑（已删除）
  Test: manual:bash -c 'grep -qE "^  regression-smoke:" .github/workflows/ci.yml && { echo "FAIL: regression-smoke job 仍存在"; exit 1; }; grep -q "golden-smoke.test.ts" .github/workflows/ci.yml && { echo "FAIL: golden-smoke 扫描逻辑仍存在"; exit 1; }; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] ci-passed needs 行含 core-regression、不含 regression-smoke，且 run 块内 check 调用同步清除
  Test: manual:bash -c 'NEEDS=$(grep -A3 "ci-passed:" .github/workflows/ci.yml | grep "needs:" | head -1); echo "$NEEDS" | grep -q "core-regression" || { echo "FAIL: ci-passed needs 缺 core-regression"; exit 1; }; echo "$NEEDS" | grep -q "regression-smoke" && { echo "FAIL: ci-passed needs 仍含 regression-smoke"; exit 1; }; grep -q "check \"regression-smoke\"" .github/workflows/ci.yml && { echo "FAIL: ci-passed run 块仍含 check regression-smoke"; exit 1; }; grep -q "check \"core-regression\"" .github/workflows/ci.yml || { echo "FAIL: ci-passed run 块缺 check core-regression"; exit 1; }; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] run-core-regression.sh 空档守卫 — PR 档但无 PR trigger 条目 → exit 1
  Test: manual:bash -c 'TMPF=$(mktemp); printf "version: \"2.0.0\"\nentries:\n  - name: t\n    priority: P0\n    trigger: [push-main]\n    test_command: \"echo ok\"\n" > $TMPF; if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPF" bash scripts/ci/run-core-regression.sh 2>/dev/null; then rm $TMPF; echo "FAIL: 空档未 exit 1"; exit 1; fi; rm $TMPF; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] run-core-regression.sh yq 解析失败守卫 — 格式错误 YAML → exit 非零（FROM_PRD 边界情况）
  Test: manual:bash -c 'TMPF=$(mktemp); printf "version: [broken\nentries: {invalid_yaml" > $TMPF; if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPF" bash scripts/ci/run-core-regression.sh 2>/dev/null; then rm $TMPF; echo "FAIL: 格式错误 YAML 未 exit 非零"; exit 1; fi; rm $TMPF; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] ci.yml core-regression 含 push-main 全集触发逻辑（TRIGGER_TYPE 含 push-main 分支）
  Test: manual:bash -c 'SECTION=$(awk "/^  core-regression:/{found=1} found && /^  [a-z]/ && !/^  core-regression:/{found=0} found{print}" .github/workflows/ci.yml); echo "$SECTION" | grep -qE "push-main|push.*main" || { echo "FAIL: core-regression 缺 push-main 全集触发"; exit 1; }; echo "OK"'
  期望: OK
