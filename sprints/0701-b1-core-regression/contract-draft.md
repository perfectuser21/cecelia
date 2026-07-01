# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 Sprint 为 CI 流水线基础设施改动（ci.yml + scripts/ci/ + regression-contract.yaml），无新增 Brain API 端点。

---

## 已知约束（来自回归测试）

- [ci-path-filter-brain.test.js] → CI `changes` job brain 路径检测必须覆盖 `sprints/` 下的 test/spec 文件（防止 Red 测试被跳过）
- [brain-p0-emergency-fixes.test.js] → cecelia-run.sh setsid stdin 重定向 / harness-evaluate whitelist / port cleanup 三项 P0 修复必须保持

---

## ⚠️ regression-contract.yaml 重构说明（Round 3 新增 — 修问题1）

**Generator 必须将 `regression-contract.yaml` 的整体结构从旧 schema 重构为 `entries:` schema：**

```yaml
# ❌ 旧 schema（当前文件现状，必须删除）
core: []
golden_paths: []

# ✅ 新 schema（Generator 必须重构为此格式）
version: "2.0.0"
updated: "2026-07-01"
entries:
  - name: brain-autonomous-sessions-p0
    priority: P0
    trigger: [PR, push-main]
    test_command: "cd packages/brain && npx vitest run tests/autonomous-sessions.test.js --reporter=verbose"
    description: "Brain P0 — autonomous session 扫描核心逻辑（无 DB 依赖，纯单元测试）"
```

**迁移规则**：
- 删除 `core:` 顶层 key
- 删除 `golden_paths:` 顶层 key
- 新增 `entries:` 顶层 key（数组，≥1 条 P0 条目）
- 旧文件注释可保留，但顶层结构必须只有 `version` / `updated` / `entries` 三个 key

---

## P0 test_command 确认（Round 3 新增 — 修问题3）

**Proposer 已确认 P0 条目的 test_command 具体值**：

```
cd packages/brain && npx vitest run tests/autonomous-sessions.test.js --reporter=verbose
```

**选择依据**：
- `packages/brain/tests/autonomous-sessions.test.js` 已 committed 到 repo（`ls` 确认存在）
- 该测试为纯单元测试（使用 `mkdtempSync` 临时目录，无真实 DB 依赖），CI ubuntu-latest runner 上可直接运行
- 测试覆盖 `scanAutonomousSessions`（`packages/brain/src/routes/autonomous.js`）—— Brain 自主会话扫描核心逻辑，是系统 P0 能力
- vitest 配置（`packages/brain/vitest.config.js`）的 `include: ['tests/**']` 已覆盖此路径

**Generator 必须将此精确命令写入 regression-contract.yaml 的 P0 条目**，不许替换成 `echo ok` 或其他 trivial 命令。

---

## Golden Path

[PR 推送] → [core-regression 无条件触发] → [yq 解析 regression-contract.yaml entries] → [按档过滤 P0/P1] → [空集守卫] → [执行 test_command] → [ci-passed 收录]

### Step 1: PR 推送触发 CI，core-regression job 无条件启动

**来源**: `[FROM_PRD]` — PRD "core-regression job 无任何 `if: contains(needs.changes.outputs....)` 路径门"

**可观测行为**: ci.yml 中 core-regression job 定义无 `if:` 路径门（任意 PR/push 都触发），`timeout-minutes` ≥ 20min

**验证命令**:
```bash
# core-regression job 存在
grep -q 'core-regression:' .github/workflows/ci.yml || { echo "FAIL: core-regression job 不存在"; exit 1; }
# job 定义段内无路径门 if
SECTION=$(awk '/^  core-regression:/{found=1} found && /^  [a-z]/ && !/^  core-regression:/{found=0} found{print}' .github/workflows/ci.yml)
echo "$SECTION" | grep -qE 'if:.*contains\(needs\.changes' && { echo "FAIL: core-regression 含路径门"; exit 1; }
echo "✅ Step 1 验证通过"
```

**硬阈值**: core-regression job 在 ci.yml 中存在；job 段内无 `if: ... contains(needs.changes.outputs` 路径门

---

### Step 2: regression-contract.yaml 使用 entries: schema，含 ≥1 条 P0 真实 Brain 测试

**来源**: `[FROM_PRD]` — PRD "往 regression-contract.yaml 填 ≥1 条真实 Brain P0 golden path（test_command 指向已 committed 测试）"

**来源（schema 重构）**: `[AI_ADDED]` — Round 3 新增，原因：现有文件使用 `core:[]/golden_paths:[]` schema，合同所有步骤假设 `entries:` key，不兼容；Generator 必须重构文件格式，否则 yq 解析和脚本执行全部失败。

**可观测行为**:
1. `regression-contract.yaml` 顶层含 `entries:` key
2. 顶层**不含** `core:` key（旧 schema 已删除）
3. 顶层**不含** `golden_paths:` key（旧 schema 已删除）
4. P0 条目 `test_command` 精确值为 `cd packages/brain && npx vitest run tests/autonomous-sessions.test.js --reporter=verbose`
5. 该 test_command 指向的文件真实存在于 repo

**验证命令**:
```bash
# 1. entries: key 存在（非空数组）
node -e "
const c = require('fs').readFileSync('regression-contract.yaml', 'utf8');
if (!c.includes('entries:')) { console.error('FAIL: 缺 entries: key'); process.exit(1); }
if (c.match(/^entries:\s*\[\]/m)) { console.error('FAIL: entries: 为空数组'); process.exit(1); }
console.log('entries: key OK');
" || exit 1

# 2. 旧 schema key 已删除
node -e "
const c = require('fs').readFileSync('regression-contract.yaml', 'utf8');
if (/^core:/m.test(c)) { console.error('FAIL: 旧 core: key 未删除'); process.exit(1); }
if (/^golden_paths:/m.test(c)) { console.error('FAIL: 旧 golden_paths: key 未删除'); process.exit(1); }
console.log('旧 schema key 已清除');
" || exit 1

# 3. P0 条目存在且 test_command 精确匹配
node -e "
const c = require('fs').readFileSync('regression-contract.yaml', 'utf8');
if (!c.includes('P0')) { console.error('FAIL: 缺 P0 条目'); process.exit(1); }
if (!c.includes('PR')) { console.error('FAIL: 缺 PR trigger'); process.exit(1); }
const CMD = 'cd packages/brain && npx vitest run tests/autonomous-sessions.test.js --reporter=verbose';
if (!c.includes(CMD)) { console.error('FAIL: P0 test_command 不是预期值，Generator 不许用 echo ok 等 trivial 命令'); process.exit(1); }
console.log('P0 条目 test_command OK');
" || exit 1

# 4. test_command 指向的文件真实存在
[ -f packages/brain/tests/autonomous-sessions.test.js ] || { echo "FAIL: autonomous-sessions.test.js 不存在于 repo"; exit 1; }
echo "✅ Step 2 验证通过"
```

**硬阈值**:
- `entries:` key 存在且非空
- `core:` / `golden_paths:` 顶层 key 不存在
- P0 条目 test_command = `cd packages/brain && npx vitest run tests/autonomous-sessions.test.js --reporter=verbose`（精确字符串匹配）
- 指向文件 `packages/brain/tests/autonomous-sessions.test.js` 存在

---

### Step 3: scripts/ci/run-core-regression.sh 用 yq 解析 regression-contract.yaml entries

**来源**: `[FROM_PRD]` — PRD "scripts/ci/run-core-regression.sh（yq 解析 + 档过滤 + 执行）"

**可观测行为**: 脚本存在、含 yq 命令、从 `entries` key 读取条目

**验证命令**:
```bash
[ -f scripts/ci/run-core-regression.sh ] || { echo "FAIL: 脚本不存在"; exit 1; }
grep -q 'yq' scripts/ci/run-core-regression.sh || { echo "FAIL: 缺 yq 调用"; exit 1; }
grep -q 'exit 1' scripts/ci/run-core-regression.sh || { echo "FAIL: 缺 exit 1 守卫"; exit 1; }
grep -qE 'regression-contract\.yaml|CONTRACT_FILE' scripts/ci/run-core-regression.sh || { echo "FAIL: 缺 contract 文件引用"; exit 1; }
# 脚本从 entries key 读取（不是 core 或 golden_paths）
grep -q 'entries' scripts/ci/run-core-regression.sh || { echo "FAIL: 脚本未读取 entries key"; exit 1; }
bash -n scripts/ci/run-core-regression.sh || { echo "FAIL: 脚本语法错误"; exit 1; }
echo "✅ Step 3 验证通过"
```

**硬阈值**: 脚本存在 + yq + exit 1 守卫 + entries key 引用 + bash 语法合法

---

### Step 3b: yq 解析格式错误 YAML → job fail

**来源**: `[FROM_PRD]` — PRD "边界情况：yq 解析 regression-contract.yaml 失败（yaml 格式错误）→ job fail"

**验证命令**:
```bash
TMPCONTRACT=$(mktemp)
printf 'version: [broken\nentries: {invalid_yaml' > "$TMPCONTRACT"
if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPCONTRACT" bash scripts/ci/run-core-regression.sh 2>/dev/null; then
  rm "$TMPCONTRACT"; echo "FAIL: 格式错误 YAML 应 exit 非零但 exit 0"; exit 1
fi
rm "$TMPCONTRACT"
echo "✅ Step 3b yq 解析失败守卫通过"
```

**硬阈值**: 格式错误 YAML → 脚本 exit 非零

---

### Step 4: 空集合守卫 — 档过滤后无条目 → exit 1

**来源**: `[FROM_PRD]` — PRD "空集合守卫：release 档过滤后为空 → exit 1"

**来源补充**: `[AI_ADDED]` — 防造假：验证脚本不在空档时静默跳过

**验证命令**:
```bash
TMPCONTRACT=$(mktemp)
cat > "$TMPCONTRACT" << 'YAML'
version: "2.0.0"
entries:
  - name: push-main-only
    priority: P0
    trigger: [push-main]
    test_command: "echo ok"
YAML
if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPCONTRACT" bash scripts/ci/run-core-regression.sh 2>/dev/null; then
  rm "$TMPCONTRACT"; echo "FAIL: 空档应 exit 1 但 exit 0"; exit 1
fi
rm "$TMPCONTRACT"
echo "✅ Step 4 空守卫验证通过"
```

**硬阈值**: TRIGGER_TYPE=PR 且 entries 无 PR trigger → 脚本 exit 非零

---

### Step 5: test_command 失败立即 exit 1

**来源**: `[FROM_PRD]` — PRD "依次执行每条 test_command；命令引用文件不存在或返回非零 → 立即 exit 1"

**验证命令**:
```bash
TMPCONTRACT=$(mktemp)
cat > "$TMPCONTRACT" << 'YAML'
version: "2.0.0"
entries:
  - name: intentional-fail
    priority: P0
    trigger: [PR]
    test_command: "exit 1"
YAML
if TRIGGER_TYPE=PR CONTRACT_FILE="$TMPCONTRACT" bash scripts/ci/run-core-regression.sh 2>/dev/null; then
  rm "$TMPCONTRACT"; echo "FAIL: 失败命令未传播 exit 1"; exit 1
fi
rm "$TMPCONTRACT"
echo "✅ Step 5 失败传播验证通过"
```

**硬阈值**: test_command exit 非零 → run-core-regression.sh exit 非零

---

### Step 6: regression-smoke 已删除，ci-passed 纳入 core-regression

**来源**: `[FROM_PRD]` — PRD "删除 ci.yml 中的 regression-smoke job" + "把 regression-smoke 从 ci-passed needs 换成 core-regression"

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
# ci-passed run 块
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

### Scenario 1: regression-contract-has-entries-schema
<!-- GOLDEN_SMOKE_SCENARIO: regression-contract-has-entries-schema -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
# 验证 regression-contract.yaml 使用 entries: schema，旧 core:/golden_paths: 已删除
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CONTRACT="$REPO_ROOT/regression-contract.yaml"
[ -f "$CONTRACT" ] || { echo "FAIL: regression-contract.yaml 不存在"; exit 1; }

node -e "
const c = require('fs').readFileSync('$CONTRACT', 'utf8');
if (!c.includes('entries:')) { console.error('FAIL: 缺 entries: key'); process.exit(1); }
if (/^core:/m.test(c)) { console.error('FAIL: 旧 core: key 未删除'); process.exit(1); }
if (/^golden_paths:/m.test(c)) { console.error('FAIL: 旧 golden_paths: key 未删除'); process.exit(1); }
console.log('✅ Scenario 1 通过');
"
```

### Scenario 2: regression-contract-p0-test-command-specific
<!-- GOLDEN_SMOKE_SCENARIO: regression-contract-p0-test-command-specific -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
# 验证 P0 test_command 精确指向真实 Brain 测试（不是 echo ok 等 trivial 命令）
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CONTRACT="$REPO_ROOT/regression-contract.yaml"

node -e "
const c = require('fs').readFileSync('$CONTRACT', 'utf8');
if (!c.includes('P0')) { console.error('FAIL: 缺 P0 条目'); process.exit(1); }
if (!c.includes('PR')) { console.error('FAIL: 缺 PR trigger'); process.exit(1); }
const CMD = 'cd packages/brain && npx vitest run tests/autonomous-sessions.test.js --reporter=verbose';
if (!c.includes(CMD)) { console.error('FAIL: P0 test_command 非预期值（必须指向 autonomous-sessions.test.js）'); process.exit(1); }
console.log('✅ Scenario 2 通过');
"

# 被引用测试文件必须在 repo 中真实存在
[ -f "$REPO_ROOT/packages/brain/tests/autonomous-sessions.test.js" ] || { echo "FAIL: autonomous-sessions.test.js 不存在"; exit 1; }
echo "✅ Scenario 2 完全通过"
```

### Scenario 3: run-core-regression-script-structure
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
grep -q 'entries' "$SCRIPT" || { echo "FAIL: 脚本未读 entries key（仍用旧 schema）"; exit 1; }
bash -n "$SCRIPT" || { echo "FAIL: 脚本语法错误"; exit 1; }
echo "✅ Scenario 3 通过"
```

### Scenario 4: ci-yml-core-regression-no-path-gate
<!-- GOLDEN_SMOKE_SCENARIO: ci-yml-core-regression-no-path-gate -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CI="$REPO_ROOT/.github/workflows/ci.yml"
grep -q 'core-regression:' "$CI" || { echo "FAIL: core-regression job 不存在"; exit 1; }
SECTION=$(awk '/^  core-regression:/{found=1} found && /^  [a-z]/ && !/^  core-regression:/{found=0} found{print}' "$CI")
echo "$SECTION" | grep -qE 'if:.*contains\(needs\.changes' && { echo "FAIL: core-regression 含路径门 if"; exit 1; }
echo "✅ Scenario 4 通过"
```

### Scenario 5: ci-yml-regression-smoke-deleted
<!-- GOLDEN_SMOKE_SCENARIO: ci-yml-regression-smoke-deleted -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CI="$REPO_ROOT/.github/workflows/ci.yml"
grep -qE '^  regression-smoke:' "$CI" && { echo "FAIL: regression-smoke job 仍存在"; exit 1; }
grep -q 'golden-smoke.test.ts' "$CI" && { echo "FAIL: golden-smoke.test.ts 扫描逻辑仍存在"; exit 1; }
echo "✅ Scenario 5 通过"
```

### Scenario 6: ci-passed-needs-updated
<!-- GOLDEN_SMOKE_SCENARIO: ci-passed-needs-updated -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CI="$REPO_ROOT/.github/workflows/ci.yml"
NEEDS_LINE=$(grep -A3 'ci-passed:' "$CI" | grep 'needs:' | head -1)
echo "$NEEDS_LINE" | grep -q 'core-regression' || { echo "FAIL: ci-passed needs 缺 core-regression"; exit 1; }
echo "$NEEDS_LINE" | grep -q 'regression-smoke' && { echo "FAIL: ci-passed needs 仍含 regression-smoke"; exit 1; }
grep -q 'check "regression-smoke"' "$CI" && { echo "FAIL: ci-passed run 块仍含 check regression-smoke"; exit 1; }
grep -q 'check "core-regression"' "$CI" || { echo "FAIL: ci-passed run 块缺 check core-regression"; exit 1; }
echo "✅ Scenario 6 通过"
```

### Scenario 7: run-core-regression-empty-guard
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
  rm "$TMPCONTRACT"; echo "FAIL: 空档场景应 exit 1 但 exit 0"; exit 1
fi
rm "$TMPCONTRACT"
echo "✅ Scenario 7 空守卫验证通过"
```

### Scenario 8: yq-parse-failure-exits-nonzero
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
  rm "$TMPCONTRACT"; echo "FAIL: 格式错误 YAML 应 exit 非零但 exit 0"; exit 1
fi
rm "$TMPCONTRACT"
echo "✅ Scenario 8 通过"
```

---

## 接缝清单（Round 3 — 本 Sprint 接缝分析）

本 Sprint 改 CI 流水线基础设施，所有验收点均为**逻辑断言**（文件内容/脚本结构/YAML schema），不依赖真机 UIA / 生产环境 / 真实外部服务。

| 接缝 | 类型 | 验证位置 | 说明 |
|---|---|---|---|
| yq 在 ubuntu-latest runner 是否可用 | 接缝断言（CI 环境） | GHA 首次 push 触发时自然验证 | 脚本头部 `which yq \|\| exit 1` 守卫；若 CI 失败即暴露 |
| autonomous-sessions.test.js 在 CI ubuntu-latest 上是否能无 DB 跑通 | 接缝断言（CI 环境） | GHA core-regression job 首次跑 | 该测试纯单元测试（mkdtempSync），本地已验证可运行，CI 应通过 |

两条接缝均无法在本地完全模拟 GHA 环境，但逻辑覆盖在合同 Step 2-5 的 BEHAVIOR 命令中已尽可能验证（脚本结构 + yq 存在性 + 空守卫 + 失败传播）。GHA 首次运行为最终真实验证点。标 **logic-done-pending（GHA 真实 CI 运行前）**。

---

## Risks（风险登记）

| # | 风险 | 触发条件 | Mitigation |
|---|---|---|---|
| R1 | yq 在 ubuntu-latest runner 不可用 | GHA runner 镜像更新移除 yq | 脚本头部检测 `which yq \|\| { echo "FAIL: yq 不可用"; exit 1; }`；首次 CI 运行即暴露 |
| R2 | autonomous-sessions.test.js 被删除/移动导致 P0 命令失效 | 文件重命名后合同未更新 | Scenario 2 验证文件存在性；regression-contract.yaml 更新时 Scenario 2 在 regression CI 中立即失败 |
| R3 | regression-contract.yaml 格式错误导致 yq 静默跳过 | 手动编辑引入 YAML 错误 | 脚本捕获 yq exit code；Step 3b + Scenario 8 专项覆盖 |
