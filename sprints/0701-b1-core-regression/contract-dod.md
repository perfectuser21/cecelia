---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: 无条件核心回归闸（B1）

**范围**: regression-contract.yaml（schema 重构 + P0 条目填入）+ scripts/ci/run-core-regression.sh（新增）+ .github/workflows/ci.yml（新增 core-regression job，删除 regression-smoke job）
**大小**: S

---

## ARTIFACT 条目

- [ ] [ARTIFACT] regression-contract.yaml 使用 entries: schema（旧 core:/golden_paths: key 已删除）
  Test: node -e "const c=require('fs').readFileSync('regression-contract.yaml','utf8');if(!c.includes('entries:'))process.exit(1);if(/^core:/m.test(c))process.exit(1);if(/^golden_paths:/m.test(c))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] regression-contract.yaml 含 ≥1 条 P0+PR trigger 条目，test_command 精确指向 autonomous-sessions 测试
  Test: node -e "const c=require('fs').readFileSync('regression-contract.yaml','utf8');if(!c.includes('P0'))process.exit(1);if(!c.includes('PR'))process.exit(1);const CMD='cd packages/brain && npx vitest run tests/autonomous-sessions.test.js --reporter=verbose';if(!c.includes(CMD))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] scripts/ci/run-core-regression.sh 文件存在
  Test: node -e "require('fs').accessSync('scripts/ci/run-core-regression.sh');console.log('OK')"

- [ ] [ARTIFACT] .github/workflows/ci.yml 含 core-regression job
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('core-regression:'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] .github/workflows/ci.yml 不含 regression-smoke job
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(/^  regression-smoke:/m.test(c))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] regression-contract.yaml entries: schema 完整 — entries 存在、旧 core:/golden_paths: 已删除、P0 条目的 test_command 精确指向 autonomous-sessions.test.js
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"regression-contract.yaml\",\"utf8\");if(!c.includes(\"entries:\"))process.exit(1);if(/^core:/m.test(c)){console.error(\"FAIL: 旧 core: key 未删除\");process.exit(1);}if(/^golden_paths:/m.test(c)){console.error(\"FAIL: 旧 golden_paths: key 未删除\");process.exit(1);}const CMD=\"cd packages/brain && npx vitest run tests/autonomous-sessions.test.js --reporter=verbose\";if(!c.includes(CMD)){console.error(\"FAIL: P0 test_command 不是预期值\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

- [ ] [BEHAVIOR] run-core-regression.sh 含 yq + exit 1 守卫 + entries key 引用 + 语法合法
  Test: manual:bash -c 'grep -q "yq" scripts/ci/run-core-regression.sh || { echo "FAIL: 缺 yq"; exit 1; }; grep -q "exit 1" scripts/ci/run-core-regression.sh || { echo "FAIL: 缺 exit 1"; exit 1; }; grep -q "entries" scripts/ci/run-core-regression.sh || { echo "FAIL: 脚本未读 entries key"; exit 1; }; bash -n scripts/ci/run-core-regression.sh || { echo "FAIL: 语法错误"; exit 1; }; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] ci.yml core-regression job 无路径门 if（不依赖 needs.changes.outputs）
  Test: manual:bash -c 'grep -q "core-regression:" .github/workflows/ci.yml || { echo "FAIL: job 不存在"; exit 1; }; SECTION=$(awk "/^  core-regression:/{found=1} found && /^  [a-z]/ && !/^  core-regression:/{found=0} found{print}" .github/workflows/ci.yml); echo "$SECTION" | grep -qE "if:.*contains\(needs\.changes" && { echo "FAIL: 含路径门"; exit 1; }; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] ci.yml 不含 regression-smoke job 及 golden-smoke.test.ts 扫描逻辑
  Test: manual:bash -c 'grep -qE "^  regression-smoke:" .github/workflows/ci.yml && { echo "FAIL: regression-smoke job 仍存在"; exit 1; }; grep -q "golden-smoke.test.ts" .github/workflows/ci.yml && { echo "FAIL: golden-smoke 扫描逻辑仍存在"; exit 1; }; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] ci-passed needs 含 core-regression、不含 regression-smoke，run 块 check 调用同步更新
  Test: manual:bash -c 'NEEDS=$(grep -A3 "ci-passed:" .github/workflows/ci.yml | grep "needs:" | head -1); echo "$NEEDS" | grep -q "core-regression" || { echo "FAIL: ci-passed needs 缺 core-regression"; exit 1; }; echo "$NEEDS" | grep -q "regression-smoke" && { echo "FAIL: ci-passed needs 仍含 regression-smoke"; exit 1; }; grep -q "check \"regression-smoke\"" .github/workflows/ci.yml && { echo "FAIL: ci-passed run 块仍含 check regression-smoke"; exit 1; }; grep -q "check \"core-regression\"" .github/workflows/ci.yml || { echo "FAIL: ci-passed run 块缺 check core-regression"; exit 1; }; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] run-core-regression.sh 空档守卫 — PR 档但无 PR trigger 条目 → exit 1
  Test: manual:bash -c 'TMPF=$(mktemp); printf "version: \"2.0.0\"\nentries:\n  - name: t\n    priority: P0\n    trigger: [push-main]\n    test_command: \"echo ok\"\n" > $TMPF; if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPF" bash scripts/ci/run-core-regression.sh 2>/dev/null; then rm $TMPF; echo "FAIL: 空档未 exit 1"; exit 1; fi; rm $TMPF; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] run-core-regression.sh yq 解析失败守卫 — 格式错误 YAML → exit 非零（FROM_PRD 边界情况）
  Test: manual:bash -c 'TMPF=$(mktemp); printf "version: [broken\nentries: {invalid_yaml" > $TMPF; if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPF" bash scripts/ci/run-core-regression.sh 2>/dev/null; then rm $TMPF; echo "FAIL: 格式错误 YAML 未 exit 非零"; exit 1; fi; rm $TMPF; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] ci.yml core-regression 含 push-main 全集触发逻辑
  Test: manual:bash -c 'SECTION=$(awk "/^  core-regression:/{found=1} found && /^  [a-z]/ && !/^  core-regression:/{found=0} found{print}" .github/workflows/ci.yml); echo "$SECTION" | grep -qE "push-main|push.*main" || { echo "FAIL: core-regression 缺 push-main 全集触发"; exit 1; }; echo "OK"'
  期望: OK

---

## Red 证据（Round 3 实测 — 修问题2）

测试文件：`sprints/0701-b1-core-regression/tests/core-regression.test.ts`（已提交）

**实际运行结果**（`npx vitest run` 于 2026-07-01）：

```
Tests  10 failed | 5 passed (15)
```

**10 条 FAIL 的具体测试**（均为目标实现未完成的真实红证据）：

| # | 测试描述 | 失败原因 |
|---|---|---|
| 1 | regression-contract.yaml 含 ≥1 条 P0+PR+test_command entries | `entries:` key 不存在（当前用 `core:[]/golden_paths:[]`）|
| 2 | scripts/ci/run-core-regression.sh 脚本文件存在 | 脚本文件不存在 |
| 3 | yq 解析格式错误 YAML 时 exit 非零 | 脚本文件不存在，spawnSync 无法执行 |
| 4 | ci.yml 包含 core-regression job 定义 | ci.yml 无 `core-regression:` job |
| 5 | regression-smoke job 已删除 | ci.yml 仍含 `regression-smoke:` job |
| 6 | regression-smoke 扫 golden-smoke.test.ts 的逻辑已删除 | ci.yml 仍含 `golden-smoke.test.ts` 引用 |
| 7 | ci-passed needs 含 core-regression | ci-passed needs 列表无 `core-regression` |
| 8 | ci-passed needs 不含 regression-smoke | ci-passed needs 列表仍含 `regression-smoke` |
| 9 | ci-passed run 块不含 check "regression-smoke" | run 块仍有 `check "regression-smoke"` |
| 10 | ci-passed run 块含 check "core-regression" | run 块无 `check "core-regression"` |

**5 条 PASS 的具体测试**（文件存在 / guard return 的用例）：

| # | 测试描述 | 通过原因 |
|---|---|---|
| 1 | 脚本含 yq 调用 | `existsSync` guard `return`（脚本不存在时跳过） |
| 2 | 脚本含 exit 1 空集守卫 | 同上 guard return |
| 3 | 脚本引用 regression-contract.yaml 或 CONTRACT_FILE | 同上 guard return |
| 4 | ci.yml 文件存在 | ci.yml 确实存在 |
| 5 | core-regression job 无路径门 if | `jobMatch` 为 null（job 不存在），测试提前 `return`（通过） |

**Red 结论**：10 failed = 真实红证据，Generator 实现前所有目标行为均失败。
