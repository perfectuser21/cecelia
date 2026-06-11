contract_branch: cp-harness-propose-r2-405c1100
sprint_dir: sprints/06112010-contract-gate-r2

# Contract DoD — Sprint: Contract Gate（evaluator 前置确定性预检）

**范围**: 纯 Node 确定性 gate（regex/解析，零 LLM）+ 数据化规则表 + 环境能力清单 + CLI 入口 + `evaluateContractNode` spawn 前接线 + artifact-gate `git fetch` refspec 修复 + 作弊/干净/边界 fixtures（永久回归）+ 单测。不含语义判断（仍归 LLM evaluator）、规则 UI、历史合同回扫。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] 确定性 gate 单一实现存在，导出 runContractGate + 数据化规则表 + 环境能力清单
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/contract-gate.js','utf8');if(!/runContractGate/.test(c)||!/weak-oracle\/curl-no-jq/.test(c)||!/cheat\/mock-env/.test(c)||!/domain\/db-no-time-window/.test(c)||!/ffprobe/.test(c))process.exit(1)"

- [x] [ARTIFACT] CLI 入口存在且从 contract-gate.js 单一来源 import（不复制规则逻辑）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/contract-gate-check.mjs','utf8');if(!/contract-gate(\.js)?['\"]/.test(c)||!/runContractGate/.test(c))process.exit(1)"

- [x] [ARTIFACT] cheat fixture 含全部 6 类作弊模式（CLI 据此抓 ≥6）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/__tests__/fixtures/contract-gate/cheat/contract-dod.md','utf8');['MOCK_','|| true','exit 0','test -f','grep'].forEach(p=>{if(!c.includes(p))process.exit(1)})"

- [x] [ARTIFACT] clean / env-missing / db-no-window / exempt / empty fixtures 全部存在
  Test: node -e "const fs=require('fs'),b='packages/brain/src/lib/__tests__/fixtures/contract-gate/';['clean','env-missing','db-no-window','exempt','empty'].forEach(d=>{if(!fs.existsSync(b+d))process.exit(1)})"

- [x] [ARTIFACT] gate 接线进 evaluateContractNode（spawn 前调用 gate）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/runContractGate|contractGate|contract-gate/.test(c))process.exit(1)"

- [x] [ARTIFACT] artifact-gate fetch 用显式 refspec（refs/remotes/origin/<branch>）修 fail-open
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/refs\/remotes\/origin\//.test(c))process.exit(1)"

## BEHAVIOR 条目（autonomous — 内嵌 manual:bash，evaluator 直接执行；被测=真实 packages/brain CLI/库/graph）

- [x] [BEHAVIOR] 作弊样本 fixture → 非零退出且命中 ≥6 条（规则名+行号+摘录）  ← Golden Path Step 1/2
  Test: manual:bash -c 'OUT=$(node packages/brain/scripts/contract-gate-check.mjs packages/brain/src/lib/__tests__/fixtures/contract-gate/cheat 2>&1) && { echo "FAIL: 应非零退出"; exit 1; }; H=$(echo "$OUT" | grep -cE "^HIT "); [ "$H" -ge 6 ] || { echo "FAIL: 命中 $H < 6"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 作弊样本 → 6 类 ruleId 全部出现  ← Golden Path Step 2
  Test: manual:bash -c 'OUT=$(node packages/brain/scripts/contract-gate-check.mjs packages/brain/src/lib/__tests__/fixtures/contract-gate/cheat 2>&1); for R in weak-oracle/curl-no-jq cheat/mock-env cheat/exit-0-fallback cheat/or-true weak-oracle/file-existence-only weak-oracle/tautology; do echo "$OUT" | grep -q "$R" || { echo "FAIL: $R 未命中"; exit 1; }; done; echo OK'
  期望: OK

- [x] [BEHAVIOR] 干净样本 fixture → 退出码 0 + 通过清单  ← Golden Path Step 3
  Test: manual:bash -c 'OUT=$(node packages/brain/scripts/contract-gate-check.mjs packages/brain/src/lib/__tests__/fixtures/contract-gate/clean 2>&1); RC=$?; [ "$RC" -eq 0 ] || { echo "FAIL: 应 exit 0 实际 $RC"; exit 1; }; echo "$OUT" | grep -qiE "pass|通过" || { echo "FAIL: 无通过清单"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 工具 preflight → 引用 docker/ffprobe 时 env_missing + 工具名  ← Golden Path Step 4
  Test: manual:bash -c 'OUT=$(node packages/brain/scripts/contract-gate-check.mjs packages/brain/src/lib/__tests__/fixtures/contract-gate/env-missing 2>&1) && { echo "FAIL: 应非零退出"; exit 1; }; echo "$OUT" | grep -q "env_missing" || { echo "FAIL: 缺 env_missing"; exit 1; }; echo "$OUT" | grep -qE "docker|ffprobe" || { echo "FAIL: 未指明工具名"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 领域规则 → DB 写入无时间窗命中 domain/db-no-time-window  ← Golden Path Step 5
  Test: manual:bash -c 'OUT=$(node packages/brain/scripts/contract-gate-check.mjs packages/brain/src/lib/__tests__/fixtures/contract-gate/db-no-window 2>&1) && { echo "FAIL: 应非零退出"; exit 1; }; echo "$OUT" | grep -q "domain/db-no-time-window" || { echo "FAIL: 未命中域规则"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 误报逃生口 → gate-allow 豁免单条规则且输出留痕，唯一命中被豁免后 exit 0  ← Golden Path Step 6
  Test: manual:bash -c 'OUT=$(node packages/brain/scripts/contract-gate-check.mjs packages/brain/src/lib/__tests__/fixtures/contract-gate/exempt 2>&1); RC=$?; echo "$OUT" | grep -qiE "gate-allow|豁免|exempt" || { echo "FAIL: 豁免未留痕"; exit 1; }; [ "$RC" -eq 0 ] || { echo "FAIL: 豁免后应 exit 0 实际 $RC"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 边界 + fail-closed → 空合同非零退出；不存在目录非零退出（禁 fail-open）  ← Golden Path Step 7
  Test: manual:bash -c 'node packages/brain/scripts/contract-gate-check.mjs packages/brain/src/lib/__tests__/fixtures/contract-gate/empty >/dev/null 2>&1 && { echo "FAIL: 空合同应非零退出"; exit 1; }; node packages/brain/scripts/contract-gate-check.mjs /nonexistent/cg/path >/dev/null 2>&1 && { echo "FAIL: fail-closed 失效"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 接线 → evaluateContractNode 命中即返回 FAIL 且不 spawn 容器；通过才 spawn  ← Golden Path Step 8
  Test: manual:bash -c 'cd packages/brain && OUT=$(npx vitest run src/workflows/__tests__/contract-gate-wiring.test.js --reporter=dot 2>&1); echo "$OUT" | grep -qE "[1-9][0-9]* passed" && ! echo "$OUT" | grep -qiE "failed|no test files|startup error" || { echo "FAIL: 接线单测未全过"; echo "$OUT" | tail -6; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] artifact-gate 修复 → fetch 用显式 refspec <branch>:refs/remotes/origin/<branch>  ← Golden Path Step 9
  Test: manual:bash -c 'cd packages/brain && OUT=$(npx vitest run src/workflows/__tests__/artifact-gate-fetch-refspec.test.js --reporter=dot 2>&1); echo "$OUT" | grep -qE "[1-9][0-9]* passed" && ! echo "$OUT" | grep -qiE "failed|no test files|startup error" || { echo "FAIL: refspec 单测未全过"; echo "$OUT" | tail -6; exit 1; }; echo OK'
  期望: OK
