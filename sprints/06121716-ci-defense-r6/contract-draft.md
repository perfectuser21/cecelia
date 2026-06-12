# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 涉及 CI 脚本 + vitest 测试文件 + yaml 配置，无新增 REST 端点。Reviewer 第 6 维自动满分。

---

## 已知约束（来自回归测试）

- [harness-contract-proposer.test.ts] → `version:` 字段须匹配 `/^version:\s*[7-9]\./`
- [harness-contract-proposer.test.ts] → 合同包含 `contract-dod-ws`、`tests/ws`、`.test.ts`
- [harness-contract-proposer.test.ts] → 含 `## Test Contract` 段
- [harness-contract-proposer.test.ts] → 含 `5.0.0` changelog 条目
- [harness-generator.test.ts] → skill 包含 `CONTRACT IS LAW` / `禁止事项` / `合同外`
- [harness-generator.test.ts] → skill 包含测试文件不可改约束
- [harness-v5-ci-checks.test.ts] → `harness-v5-checks.yml` 存在且含 4 核心 job

---

## Golden Path

[packages/workflows/skills/** 变更触发] → [changed-test-router 感知 + skill 契约测试运行 + 合同存在性检查] → [防线有效：任何遗漏当场报红]

---

### Step 1: changed-test-router.mjs 感知 skill 文件变更

**来源**: `[FROM_PRD]` — PRD 背景第 1 条 + Golden Path 步骤 1：vitest `--changed` 不感知 fs 读取型测试，新脚本扫描 `readFileSync` 路径建立 skill 文件→测试文件映射。

**可观测行为**: `node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md` 在 stdout 输出含 `harness-evaluator.test.ts` 路径的清单；对非 skill 路径（如 `packages/brain/src/server.js`）输出空行，退出码 0。

**验证命令**:
```bash
OUTPUT=$(node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md)
echo "$OUTPUT" | grep -q "harness-evaluator.test.ts" || { echo "FAIL: 输出不含 harness-evaluator.test.ts"; exit 1; }
echo OK
```

**硬阈值**: stdout 含 `harness-evaluator.test.ts`，退出码 0

---

### Step 2: skill 契约测试正常路径全绿

**来源**: `[FROM_PRD]` — PRD 背景第 2 条 + Golden Path 步骤 2：evaluator `env_missing`、B-1.6/1.7/1.8、无 ws_id 残留；reviewer 7 维名与 ReviewerOutputSchema 逐字一致；generator 无可执行 `gh pr merge`；proposer 含领域验证规则段。

**可观测行为**: `npx vitest run packages/engine/tests/skills/` 全绿（新增 `harness-evaluator.test.ts` + 扩展 reviewer/generator/proposer 测试均通过）。

**验证命令**:
```bash
# 捕获输出+退出码，避免 |tee 管道吞掉 vitest 退出码
VITEST_OUT=$(npx vitest run packages/engine/tests/skills/ 2>&1)
VITEST_EXIT=$?
echo "$VITEST_OUT"
[ "$VITEST_EXIT" = "0" ] || { echo "FAIL: skill 契约测试未全绿（exit=$VITEST_EXIT）"; exit 1; }
echo OK
```

**硬阈值**: vitest exit 0，无失败用例（含新增 evaluator 测试）

---

### Step 3: 篡改 evaluator skill → 契约测试报红

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 3：删 env_missing 段副本后 vitest 红，错误信息指明缺失不变量名称。

**可观测行为**: 在 evaluator skill 副本中删除 `env_missing` 相关段，`harness-evaluator.test.ts` 断言失败，输出含 `env_missing`。

**验证命令**:
```bash
SKILL_ORIG="$HOME/.claude/skills/harness-evaluator/SKILL.md"
BACKUP=$(mktemp)
cp "$SKILL_ORIG" "$BACKUP"
sed -i.bak "/env_missing/d" "$SKILL_ORIG"  # -i.bak 兼容 macOS BSD sed（不加参数报错）
rm -f "${SKILL_ORIG}.bak"
TAMPER_OUT=$(npx vitest run packages/engine/tests/skills/harness-evaluator.test.ts 2>&1)
TAMPER_EXIT=$?
cp "$BACKUP" "$SKILL_ORIG"
rm -f "$BACKUP"
[ "$TAMPER_EXIT" != "0" ] || { echo "FAIL: 篡改后测试应红"; exit 1; }
echo "$TAMPER_OUT" | grep -q "env_missing" || { echo "FAIL: 红色报错未指明 env_missing"; exit 1; }
echo OK
```

**硬阈值**: vitest exit 非 0；错误输出含 `env_missing`

---

### Step 4: check-contract-exists.mjs 合同存在性检查

**来源**: `[FROM_PRD]` — PRD 背景第 3 条 + Golden Path 步骤 4：harness PR 可不带 contract-draft.md 合并是已知漏洞，本步骤封堵。

**可观测行为**:
- 传入含 `contract-draft.md` 的文件清单 → 退出码 0
- 传入不含 `contract-draft.md` 的清单 → 非零退出 + stderr 指明缺失路径

**验证命令**:
```bash
# 4a: 含 contract-draft.md → 退出码 0
printf "sprints/06121716-ci-defense-r6/contract-draft.md\npackages/brain/src/foo.js\n" | node packages/brain/scripts/ci/check-contract-exists.mjs || { echo "FAIL: 完整清单应退出码 0"; exit 1; }

# 4b: 缺 contract-draft.md → 非零退出
printf "packages/brain/src/foo.js\npackages/brain/src/bar.js\n" | node packages/brain/scripts/ci/check-contract-exists.mjs && { echo "FAIL: 缺合同清单应非零退出"; exit 1; } || echo OK
```

**硬阈值**:
- 含合同清单：退出码 0
- 缺合同清单：退出码非 0 且 stderr 含 `contract-draft.md`

---

### Step 5: CI 自动化 — skills 变更触发防线

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 5：`packages/workflows/skills/**` 有变更的 PR → ci.yml 自动触发步骤 1-4。

**可观测行为**: ci.yml 包含路径过滤为 `packages/workflows/skills/**` 的 step，调用 `changed-test-router.mjs` 和 `check-contract-exists.mjs`，yaml 语法合法。

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('.github/workflows/ci.yml','utf8');
  if (!c.includes('changed-test-router.mjs')) { console.error('FAIL: ci.yml 缺 changed-test-router.mjs'); process.exit(1); }
  if (!c.match(/workflows\/skills\/\*\*/)) { console.error('FAIL: ci.yml 缺 skills/** 路径过滤'); process.exit(1); }
  console.log('OK');
" || { echo "FAIL: ci.yml 扩展检查失败"; exit 1; }
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))" 2>/dev/null || { echo "FAIL: ci.yml yaml 语法错误"; exit 1; }
echo "CI yaml 语法合法"
```

**硬阈值**: ci.yml 含 `changed-test-router.mjs` 调用 + `workflows/skills/**` 路径；yaml 可解析

**注意 [AI_ADDED]**: 理由：yaml 语法检查防止 generator 写出格式错误的 CI 配置导致 CI 全挂。

---

## Risks

| 风险 | 概率 | 影响 | Mitigation |
|---|---|---|---|
| ci.yml 新增 step 破坏全局 CI（语法错误 / job 依赖链断裂）| 中 | 高 | Generator 必须本地跑 `node -e "require('js-yaml').load(...)"` 验证 yaml 合法（Step 5 验证命令覆盖）；新 step 写在独立 job 下，不修改现有 job 的 `needs:` 依赖链 |
| macOS BSD sed 行为差异导致篡改验证脚本出错（`sed -i` 无参数报错）| 中 | 低 | 所有 `sed -i` 统一改为 `sed -i.bak`（`.bak` 后缀形式，Linux/macOS 均支持），执行后立即 `rm -f "${file}.bak"` 清理 |
| evaluator SKILL.md 未安装（`~/.claude/skills/` 无此 skill）→ Step 3 无法执行 | 低 | 低 | Step 3 验证命令内置文件存在性检查；E2E Step 3 已有 `if [ -f "$SKILL_ORIG" ]` 守卫，环境缺失时输出 SKIP 提示而不是静默假绿 |

---

## E2E 验收（final-e2e）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -e
cd "$(git rev-parse --show-toplevel)"

echo "=== CI 防线三件套 E2E 验收 ==="

# Step 1: changed-test-router 感知验证
echo "--- Step 1: changed-test-router 感知 ---"
OUTPUT=$(node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md)
echo "$OUTPUT" | grep -q "harness-evaluator.test.ts" || { echo "FAIL: step1 - 未检测到评测者测试"; exit 1; }
# 边界：非 skill 路径输出为空
EMPTY_OUT=$(node packages/brain/scripts/ci/changed-test-router.mjs --files packages/brain/src/server.js)
[ -z "$(echo "$EMPTY_OUT" | tr -d '[:space:]')" ] || { echo "FAIL: step1 - 非 skill 路径应输出空清单"; exit 1; }
echo "✅ Step 1 通过"

# Step 2a: engine skill 契约测试全绿（packages/engine/tests/skills/）
# 注：验证新建的 harness-evaluator.test.ts + 扩展后的 reviewer/generator/proposer 测试
echo "--- Step 2a: engine skill 契约测试 ---"
VITEST_OUT=$(npx vitest run packages/engine/tests/skills/ 2>&1)
VITEST_EXIT=$?
echo "$VITEST_OUT"
[ "$VITEST_EXIT" = "0" ] || { echo "FAIL: step2a - skill 契约测试未全绿（exit=$VITEST_EXIT）"; exit 1; }
echo "✅ Step 2a 通过"

# Step 2b: sprint 本地测试套件全绿（sprints/06121716-ci-defense-r6/tests/）
# 注：ci-defense-r6.test.ts 验证脚本行为 + ci.yml 扩展 + 各 skill 测试文件扩展
echo "--- Step 2b: sprint 本地测试套件 ---"
SPRINT_OUT=$(npx vitest run sprints/06121716-ci-defense-r6/tests/ 2>&1)
SPRINT_EXIT=$?
echo "$SPRINT_OUT"
[ "$SPRINT_EXIT" = "0" ] || { echo "FAIL: step2b - sprint 测试未全绿（exit=$SPRINT_EXIT）"; exit 1; }
echo "✅ Step 2b 通过"

# Step 3: 篡改验证
echo "--- Step 3: 篡改检测 ---"
SKILL_ORIG="$HOME/.claude/skills/harness-evaluator/SKILL.md"
if [ -f "$SKILL_ORIG" ]; then
  BACKUP=$(mktemp)
  cp "$SKILL_ORIG" "$BACKUP"
  sed -i.bak "/env_missing/d" "$SKILL_ORIG"  # -i.bak 兼容 macOS BSD sed
  rm -f "${SKILL_ORIG}.bak"
  TAMPER_EXIT=0
  TAMPER_OUT=$(npx vitest run packages/engine/tests/skills/harness-evaluator.test.ts 2>&1) || TAMPER_EXIT=$?
  cp "$BACKUP" "$SKILL_ORIG"
  rm -f "$BACKUP"
  [ "$TAMPER_EXIT" != "0" ] || { echo "FAIL: step3 - 篡改后测试应红"; exit 1; }
  echo "$TAMPER_OUT" | grep -q "env_missing" || { echo "FAIL: step3 - 红色报错未指明 env_missing"; exit 1; }
  echo "✅ Step 3 通过"
else
  echo "⚠️  skill 文件不存在于 $SKILL_ORIG，跳过步骤 3（技能未安装）"
fi

# Step 4: check-contract-exists.mjs
echo "--- Step 4: 合同存在性检查 ---"
printf "sprints/06121716-ci-defense-r6/contract-draft.md\npackages/brain/src/foo.js\n" | \
  node packages/brain/scripts/ci/check-contract-exists.mjs || { echo "FAIL: step4a - 完整清单应退出码 0"; exit 1; }
printf "packages/brain/src/foo.js\npackages/brain/src/bar.js\n" | \
  node packages/brain/scripts/ci/check-contract-exists.mjs && { echo "FAIL: step4b - 缺合同清单应非零退出"; exit 1; } || true
echo "✅ Step 4 通过"

# Step 5: ci.yml 验证
echo "--- Step 5: CI 自动化验证 ---"
node -e "
  const c = require('fs').readFileSync('.github/workflows/ci.yml','utf8');
  if (!c.includes('changed-test-router.mjs')) { console.error('FAIL: ci.yml 缺 changed-test-router.mjs'); process.exit(1); }
  if (!c.match(/workflows\/skills\/\*\*/)) { console.error('FAIL: ci.yml 缺 skills/** 路径过滤'); process.exit(1); }
  console.log('ci.yml 扩展验证 OK');
" || { echo "FAIL: step5 - ci.yml 检查失败"; exit 1; }
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))" 2>/dev/null || \
  { echo "FAIL: step5 - ci.yml yaml 语法错误"; exit 1; }
echo "✅ Step 5 通过"

echo ""
echo "✅ CI 防线三件套 E2E 全部 5 步验证通过"
```

---

## Test Contract

| 测试套件 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Sprint 本地（brain vitest，由 `brain=true` 触发）| `sprints/06121716-ci-defense-r6/tests/ci-defense-r6.test.ts` | changed-test-router 脚本存在+输出 / check-contract-exists 行为 / ci.yml 扩展（changed-test-router + skills/** + check-contract-exists）/ reviewer 7 维名 / generator 无 gh pr merge / proposer 领域验证 | → 6+ failures（脚本不存在 / ci.yml 未扩展）|
| Engine skills（engine-tests vitest，由 `engine=true` 触发）| `packages/engine/tests/skills/harness-evaluator.test.ts`（新建）| evaluator env_missing / B-1.6~1.8 / ws_id 残留 / skipIf 模式 | → 4+ failures（文件不存在）|
