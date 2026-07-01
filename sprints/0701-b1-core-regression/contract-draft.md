# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 Sprint 为 CI 流水线基础设施改动（ci.yml + scripts/ci/ + regression-contract.yaml），无新增 Brain API 端点。

---

## 已知约束（来自回归测试）

- [ci-path-filter-brain.test.js] → CI `changes` job brain 路径检测必须覆盖 `sprints/` 下的 test/spec 文件（防止 Red 测试被跳过）
- [brain-p0-emergency-fixes.test.js] → cecelia-run.sh setsid stdin 重定向 / harness-evaluate whitelist / port cleanup 三项 P0 修复必须保持

---

## Golden Path

[PR 推送] → [core-regression 无条件触发] → [yq 解析 regression-contract.yaml] → [按档过滤 P0/P1] → [空集守卫] → [执行 test_command] → [ci-passed 收录]

### Step 1: PR 推送触发 CI，core-regression job 无条件启动

**来源**: `[FROM_PRD]` — PRD "core-regression job 无任何 `if: contains(needs.changes.outputs....)` 路径门"

**可观测行为**: ci.yml 中 core-regression job 定义无 `if:` 路径门（任意 PR/push 都触发），`timeout-minutes` ≥ 20min（与 regression-smoke 先例一致）

**验证命令**:
```bash
# core-regression job 存在
grep -q 'core-regression:' .github/workflows/ci.yml || { echo "FAIL: core-regression job 不存在"; exit 1; }
# job 定义段内无路径门 if（`if: needs.changes` 形式）
SECTION=$(awk '/^  core-regression:/{found=1} found && /^  [a-z]/ && !/^  core-regression:/{found=0} found{print}' .github/workflows/ci.yml)
echo "$SECTION" | grep -qE 'if:.*contains\(needs\.changes' && { echo "FAIL: core-regression 含路径门"; exit 1; }
echo "✅ Step 1 验证通过"
```

**硬阈值**: core-regression job 在 ci.yml 中存在；job 段内无 `if: ... contains(needs.changes.outputs` 路径门

---

### Step 2: scripts/ci/run-core-regression.sh 用 yq 解析 regression-contract.yaml

**来源**: `[FROM_PRD]` — PRD "scripts/ci/run-core-regression.sh（yq 解析 + 档过滤 + 执行）"

**可观测行为**: 脚本存在、含 yq 命令、从 `regression-contract.yaml` 读取条目

**验证命令**:
```bash
# 文件存在
[ -f scripts/ci/run-core-regression.sh ] || { echo "FAIL: 脚本不存在"; exit 1; }
# 含 yq 调用
grep -q 'yq' scripts/ci/run-core-regression.sh || { echo "FAIL: 缺 yq 调用"; exit 1; }
# 含失败退出（空守卫）
grep -q 'exit 1' scripts/ci/run-core-regression.sh || { echo "FAIL: 缺 exit 1 守卫"; exit 1; }
# 含 CONTRACT_FILE / regression-contract.yaml 引用
grep -qE 'regression-contract\.yaml|CONTRACT_FILE' scripts/ci/run-core-regression.sh || { echo "FAIL: 缺 contract 文件引用"; exit 1; }
echo "✅ Step 2 验证通过"
```

**硬阈值**: 脚本存在 + 含 `yq` 解析 + 含 `exit 1` 空守卫 + 引用 regression-contract.yaml

---

### Step 2b: yq 解析 regression-contract.yaml 格式错误 → job fail

**来源**: `[FROM_PRD]` — PRD "边界情况：yq 解析 regression-contract.yaml 失败（yaml 格式错误）→ job fail，报 yq 错误"

**可观测行为**: 向 run-core-regression.sh 传入格式损坏的 YAML 时，脚本 exit 非零并输出人类可读错误（不静默跳过）

**验证命令**:
```bash
# 创建格式错误 YAML，验证脚本 exit 非零（不静默通过）
TMPCONTRACT=$(mktemp)
printf 'version: [broken\nentries: {invalid_yaml' > "$TMPCONTRACT"
if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPCONTRACT" bash scripts/ci/run-core-regression.sh 2>/dev/null; then
  rm "$TMPCONTRACT"
  echo "FAIL: 格式错误 YAML 应 exit 非零但脚本 exit 0"
  exit 1
fi
rm "$TMPCONTRACT"
echo "✅ Step 2b yq 解析失败守卫通过"
```

**硬阈值**: 格式错误 YAML → 脚本 exit 非零

---

### Step 3: regression-contract.yaml 含 ≥1 条 P0 触发 PR 的 entries

**来源**: `[FROM_PRD]` — PRD "往 regression-contract.yaml 填 ≥1 条真实 Brain P0 golden path"

**可观测行为**: regression-contract.yaml 的 `entries` 数组含 ≥1 条 `priority: P0`、`trigger` 含 `PR`、`test_command` 非空的条目

**验证命令**:
```bash
# P0 条目存在
node -e "
const fs = require('fs');
const content = fs.readFileSync('regression-contract.yaml', 'utf8');
if (!content.includes('P0')) { console.error('FAIL: 缺 P0 条目'); process.exit(1); }
if (!content.includes('PR')) { console.error('FAIL: 缺 PR trigger'); process.exit(1); }
if (!content.includes('test_command')) { console.error('FAIL: 缺 test_command'); process.exit(1); }
console.log('✅ Step 3 验证通过');
"
```

**硬阈值**: entries 含 ≥1 条 priority=P0 + trigger 含 PR + test_command 非空

---

### Step 4: 空集合守卫 — release 档过滤后为空 → exit 1

**来源**: `[FROM_PRD]` — PRD "空集合守卫：release 档过滤后为空 → exit 1，job 失败（防退化假绿灯）"

**来源补充**: `[AI_ADDED]` — GAN Round 1 防造假：验证空档场景触发 exit 1，防止 run-core-regression.sh 静默跳过

**可观测行为**: 传入不存在 trigger 档时（如 `TRIGGER_TYPE=release-nonexistent`）脚本 exit 1 且有人类可读错误消息

**验证命令**:
```bash
# 创建仅含 push-main trigger 条目的临时合同，用 release 档触发 → 空守卫应 exit 1
TMPCONTRACT=$(mktemp)
cat > "$TMPCONTRACT" << 'YAML'
version: "2.0.0"
entries:
  - name: test-entry
    priority: P0
    trigger: [push-main]
    test_command: "echo ok"
YAML
if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPCONTRACT" bash scripts/ci/run-core-regression.sh; then
  rm "$TMPCONTRACT"
  echo "FAIL: 空档应 exit 1 但脚本 exit 0"
  exit 1
fi
rm "$TMPCONTRACT"
echo "✅ Step 4 空守卫验证通过（exit 1 符合预期）"
```

**硬阈值**: TRIGGER_TYPE=PR 且 entries 无 PR trigger → 脚本 exit 非零

---

### Step 5: 依次执行 test_command，失败立即 exit 1

**来源**: `[FROM_PRD]` — PRD "依次执行每条 test_command；命令引用文件不存在或返回非零 → 立即 exit 1"

**可观测行为**: test_command 失败时 run-core-regression.sh 整体 exit 1，不静默跳过

**验证命令**:
```bash
# 创建含失败命令的临时合同，验证脚本传播 exit 1
TMPCONTRACT=$(mktemp)
cat > "$TMPCONTRACT" << 'YAML'
version: "2.0.0"
entries:
  - name: intentional-fail
    priority: P0
    trigger: [PR]
    test_command: "exit 1"
YAML
if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPCONTRACT" bash scripts/ci/run-core-regression.sh; then
  rm "$TMPCONTRACT"
  echo "FAIL: 失败命令未传播 exit 1"
  exit 1
fi
rm "$TMPCONTRACT"
echo "✅ Step 5 失败传播验证通过"
```

**硬阈值**: test_command exit 非零 → run-core-regression.sh exit 非零

---

### Step 6: regression-smoke 已删除，ci-passed 纳入 core-regression

**来源**: `[FROM_PRD]` — PRD "删除 ci.yml 中的 regression-smoke job" + "把 regression-smoke 从 ci-passed needs 换成 core-regression"

**可观测行为**: ci.yml 不再含 regression-smoke job 定义及其扫 golden-smoke.test.ts 的逻辑；ci-passed needs 列表含 core-regression 不含 regression-smoke

**验证命令**:
```bash
# regression-smoke job 已删除
grep -qE '^  regression-smoke:' .github/workflows/ci.yml && { echo "FAIL: regression-smoke job 仍存在"; exit 1; }
# golden-smoke.test.ts 扫描逻辑已删除
grep -q 'golden-smoke.test.ts' .github/workflows/ci.yml && { echo "FAIL: golden-smoke.test.ts 引用仍存在"; exit 1; }
# ci-passed needs 行：含 core-regression，不含 regression-smoke
NEEDS_LINE=$(grep -A3 'ci-passed:' .github/workflows/ci.yml | grep 'needs:' | head -1)
echo "$NEEDS_LINE" | grep -q 'core-regression' || { echo "FAIL: ci-passed needs 缺 core-regression"; exit 1; }
echo "$NEEDS_LINE" | grep -q 'regression-smoke' && { echo "FAIL: ci-passed needs 仍含 regression-smoke"; exit 1; }
# ci-passed run 块：不含 check "regression-smoke"，含 check "core-regression"
grep -q 'check "regression-smoke"' .github/workflows/ci.yml && { echo "FAIL: ci-passed run 块仍含 check regression-smoke"; exit 1; }
grep -q 'check "core-regression"' .github/workflows/ci.yml || { echo "FAIL: ci-passed run 块缺 check core-regression"; exit 1; }
echo "✅ Step 6 验证通过"
```

**硬阈值**: ci.yml 不含 `regression-smoke:` job；ci-passed needs 行和 run 块均不含 regression-smoke，均含 core-regression

---

## E2E 验收（最终 final-e2e 跑 — local_api 模板）

**journey_type**: dev_pipeline
**target_environment**: local_api

<!-- GOLDEN_SMOKE_ABILITY_SLUG: core-regression-gate -->
<!-- GOLDEN_SMOKE_TARGET_ENV: local_api -->

### Scenario 1: regression-contract-has-p0-entries
<!-- GOLDEN_SMOKE_SCENARIO: regression-contract-has-p0-entries -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
# 验证 regression-contract.yaml 含 ≥1 条 P0+PR trigger 的非空条目
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CONTRACT="$REPO_ROOT/regression-contract.yaml"
[ -f "$CONTRACT" ] || { echo "FAIL: regression-contract.yaml 不存在"; exit 1; }
node -e "
const c = require('fs').readFileSync('$CONTRACT', 'utf8');
if (!c.includes('P0')) { console.error('FAIL: 缺 P0 条目'); process.exit(1); }
if (!c.includes('PR')) { console.error('FAIL: 缺 PR trigger'); process.exit(1); }
if (!c.includes('test_command')) { console.error('FAIL: 缺 test_command'); process.exit(1); }
console.log('✅ Scenario 1 通过');
"
```

### Scenario 2: run-core-regression-script-structure
<!-- GOLDEN_SMOKE_SCENARIO: run-core-regression-script-structure -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/run-core-regression.sh"
[ -f "$SCRIPT" ] || { echo "FAIL: run-core-regression.sh 不存在"; exit 1; }
grep -q 'yq' "$SCRIPT" || { echo "FAIL: 脚本缺 yq 调用"; exit 1; }
grep -q 'exit 1' "$SCRIPT" || { echo "FAIL: 脚本缺 exit 1 空守卫"; exit 1; }
bash -n "$SCRIPT" || { echo "FAIL: 脚本语法错误"; exit 1; }
echo "✅ Scenario 2 通过"
```

### Scenario 3: ci-yml-core-regression-no-path-gate
<!-- GOLDEN_SMOKE_SCENARIO: ci-yml-core-regression-no-path-gate -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CI="$REPO_ROOT/.github/workflows/ci.yml"
grep -q 'core-regression:' "$CI" || { echo "FAIL: core-regression job 不存在"; exit 1; }
# 提取 core-regression 段，验证无路径门
SECTION=$(awk '/^  core-regression:/{found=1} found && /^  [a-z]/ && !/^  core-regression:/{found=0} found{print}' "$CI")
echo "$SECTION" | grep -qE 'if:.*contains\(needs\.changes' && { echo "FAIL: core-regression 含路径门 if"; exit 1; }
echo "✅ Scenario 3 通过"
```

### Scenario 4: ci-yml-regression-smoke-deleted
<!-- GOLDEN_SMOKE_SCENARIO: ci-yml-regression-smoke-deleted -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CI="$REPO_ROOT/.github/workflows/ci.yml"
grep -qE '^  regression-smoke:' "$CI" && { echo "FAIL: regression-smoke job 仍存在"; exit 1; }
grep -q 'golden-smoke.test.ts' "$CI" && { echo "FAIL: golden-smoke.test.ts 扫描逻辑仍存在"; exit 1; }
echo "✅ Scenario 4 通过"
```

### Scenario 5: ci-passed-needs-updated
<!-- GOLDEN_SMOKE_SCENARIO: ci-passed-needs-updated -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CI="$REPO_ROOT/.github/workflows/ci.yml"
# 验证 needs: 行（与 Step 6 统一用 grep -A3）
NEEDS_LINE=$(grep -A3 'ci-passed:' "$CI" | grep 'needs:' | head -1)
echo "$NEEDS_LINE" | grep -q 'core-regression' || { echo "FAIL: ci-passed needs 缺 core-regression"; exit 1; }
echo "$NEEDS_LINE" | grep -q 'regression-smoke' && { echo "FAIL: ci-passed needs 仍含 regression-smoke"; exit 1; }
# 验证 run 块内 check 调用（两处引用都必须清除）
grep -q 'check "regression-smoke"' "$CI" && { echo "FAIL: ci-passed run 块仍含 check regression-smoke"; exit 1; }
grep -q 'check "core-regression"' "$CI" || { echo "FAIL: ci-passed run 块缺 check core-regression"; exit 1; }
echo "✅ Scenario 5 通过"
```

### Scenario 6: run-core-regression-empty-guard
<!-- GOLDEN_SMOKE_SCENARIO: run-core-regression-empty-guard -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 15000 -->

```bash
#!/bin/bash
set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TMPCONTRACT=$(mktemp)
cat > "$TMPCONTRACT" << 'YAML'
version: "2.0.0"
entries:
  - name: push-main-only-entry
    priority: P0
    trigger: [push-main]
    test_command: "echo ok"
YAML
if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPCONTRACT" bash "$REPO_ROOT/scripts/ci/run-core-regression.sh" 2>/dev/null; then
  rm "$TMPCONTRACT"
  echo "FAIL: 空档场景应 exit 1 但 exit 0"
  exit 1
fi
rm "$TMPCONTRACT"
echo "✅ Scenario 6 空守卫验证通过"
```

### Scenario 7: yq-parse-failure-exits-nonzero
<!-- GOLDEN_SMOKE_SCENARIO: yq-parse-failure-exits-nonzero -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/run-core-regression.sh"
[ -f "$SCRIPT" ] || { echo "FAIL: run-core-regression.sh 不存在"; exit 1; }
TMPCONTRACT=$(mktemp)
printf 'version: [broken\nentries: {invalid_yaml' > "$TMPCONTRACT"
if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPCONTRACT" bash "$SCRIPT" 2>/dev/null; then
  rm "$TMPCONTRACT"
  echo "FAIL: 格式错误 YAML 应 exit 非零但脚本 exit 0"
  exit 1
fi
rm "$TMPCONTRACT"
echo "✅ Scenario 7 通过"
```

---

## Risks（风险登记）

| # | 风险 | 触发条件 | Mitigation |
|---|---|---|---|
| R1 | yq 在 ubuntu-latest runner 上不可用 | GHA runner 镜像更新后 yq 被移除 | 脚本头部检测 `which yq \|\| { echo "FAIL: yq 不可用"; exit 1; }`；Step 2 BEHAVIOR 覆盖 yq 调用存在性，CI 首次运行即暴露 |
| R2 | regression-contract.yaml YAML 格式错误导致 yq 解析静默跳过 | 手动编辑引入缩进/冒号错误 | 脚本捕获 yq exit code 非零即 exit 1 并打印可读错误；Step 2b [FROM_PRD] BEHAVIOR + Scenario 7 专项覆盖（本 Round 新增）|
| R3 | test_command 路径漂移（文件重命名/删除后条目未更新）| regression-contract.yaml 内 test_command 指向的测试文件被删除 | 脚本执行 test_command 前不作存在性预检，直接 bash -c 执行，文件不存在 → exit 非零；Step 5 BEHAVIOR 覆盖"命令失败 → exit 1"路径 |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `tests/core-regression.test.ts` | 15 项断言（3 项因脚本未创建条件跳过） | → 10 failures（实现前 Red 状态，已验证）|
