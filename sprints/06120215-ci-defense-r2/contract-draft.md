# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应（纯 CI 脚本 + vitest 测试 + yaml 改动）

## 假设补充（Scope 偏差说明）

- [ASSUMPTION: PRD 写 `brain-ci.yml`，但实际仓库无独立 `brain-ci.yml`，Cecelia 统一使用 `.github/workflows/ci.yml` 作为 CI 入口；合同改用 `ci.yml`，所有 skill 触发规则追加至此文件。]
- [ASSUMPTION: changed-test-router.mjs 已存在于 packages/brain/scripts/ci/，本次只追加路由规则]
- [ASSUMPTION: packages/workflows/skills/ 下各 skill 的 SKILL.md 是唯一快照来源，vitest 直接读文件断言]
- [ASSUMPTION: 合同存在性检查脚本接受 git diff --name-only 输出（文件名列表）作为 stdin 输入，不依赖真实 git history]

## 已知约束（来自回归测试）

- [packages/brain/tests/autonomous-sessions.test.js] → autonomous session 管理不影响脚本路由
- [packages/brain/tests/slot-allocator-env-respect.test.js] → 环境路由不被路由脚本绑架

## Golden Path

[变更 skill 文件] → [路由脚本输出契约测试路径] → [契约测试全绿] → [篡改 fixture 必红] → [合同 gate 正确拦截] → [CI 接线完成且 skill-tests 进入 ci-passed]

---

### Step 1: 路由脚本对 skill 文件变更输出契约测试路径

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条「路由触发」，PRD 原文：执行 `node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md`，输出须包含 skill 契约测试的完整路径

**可观测行为**: 执行路由脚本后，stdout JSON 中包含 `packages/brain/tests/skill-contracts/` 下某测试文件路径；不仅输出通用 `packages/brain/tests/` 列表

**验证命令**:
```bash
OUTPUT=$(node packages/brain/scripts/ci/changed-test-router.mjs \
  --files "packages/workflows/skills/harness-evaluator/SKILL.md")
echo "$OUTPUT" | grep -qE "packages/brain/tests/skill-contracts" \
  || { echo "FAIL: 路由未输出 skill-contracts 路径，实际输出: $OUTPUT"; exit 1; }
echo "OK"
```

**硬阈值**: stdout 含 `packages/brain/tests/skill-contracts`（grep 可断言），exit 0

---

### Step 2: skill 契约测试对当前快照全绿

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条「契约测试绿」，PRD 原文：对当前 `packages/workflows/skills/` 快照跑 vitest skill 契约测试，全部通过

**可观测行为**: `npx vitest run packages/brain/tests/skill-contracts/` exit 0，stdout 无 FAIL；覆盖：evaluator 含 `env_missing` 红线与 B-1.6/1.7/1.8 步骤、全文无 `ws_id`/`contract-dod-ws` 残留、reviewer 7 维名与 `harness-shared.js ReviewerOutputSchema` 逐字一致、generator 全文无可执行 `gh pr merge` 命令、proposer 含领域验证规则段

**验证命令**:
```bash
npx vitest run packages/brain/tests/skill-contracts/ --reporter=verbose 2>&1 | tee /tmp/skill-contract-result.log
EXIT=${PIPESTATUS[0]}
grep -qE "Tests.*passed" /tmp/skill-contract-result.log || { echo "FAIL: 契约测试未显示 passed"; exit 1; }
[ "$EXIT" -eq 0 ] || { echo "FAIL: vitest exit=$EXIT"; exit 1; }
echo "OK"
```

**硬阈值**: vitest exit 0，所有 5 个 skill 不变量测试通过（evaluator/reviewer/generator/proposer 各项）

---

### Step 3: 篡改 fixture 必红且错误信息指明缺失不变量名

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条「篡改 fixture 必红」，PRD 原文：对删去 `env_missing` 段的 evaluator SKILL.md 副本跑同一契约测试，测试必非零退出，错误信息须指明缺失的不变量名

**可观测行为**: 临时复制 evaluator SKILL.md → 删去 `env_missing` 相关行 → 对该 fixture 运行契约测试 → exit ≠ 0，stderr/stdout 含字面量 `env_missing`（不接受仅 "snapshot mismatch"）

**验证命令**:
```bash
# 建临时 fixture，删去 env_missing 段
FIXTURE=$(mktemp /tmp/evaluator-tampered-XXXXXX.md)
grep -v "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md > "$FIXTURE"

# 负向测试：if 语法不触发 set -e，安全处理预期失败命令；输出重定向到文件
if EVALUATOR_SKILL_FIXTURE="$FIXTURE" \
  npx vitest run packages/brain/tests/skill-contracts/ --reporter=verbose \
  > /tmp/tamper-test.log 2>&1; then
  rm -f "$FIXTURE"
  echo "FAIL: 篡改 fixture 测试全部通过（篡改检测失效，应非零退出）"
  exit 1
fi
rm -f "$FIXTURE"

# 断言：错误信息必须指明缺失不变量名（不接受仅 snapshot mismatch）
grep -qE "env_missing" /tmp/tamper-test.log \
  || { echo "FAIL: 篡改 fixture 错误未指明 'env_missing'，实际: $(tail -20 /tmp/tamper-test.log)"; exit 1; }
echo "OK"
```

**硬阈值**: 测试非零退出，且输出含字面量 `env_missing`

---

### Step 4: 合同存在性 gate 正确拦截缺合同的 PR

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条「合同存在性 gate」，PRD 原文：对含 `sprints/<dir>/` 变更但缺 `contract-draft.md` 的 diff fixture 执行检查脚本，须非零退出并指明缺失文件名；对完整 fixture 执行同一脚本，须 0 退出

**可观测行为（负向）**: stdin 输入仅含 sprints 目录下非合同文件 → 脚本 exit ≠ 0，stdout/stderr 含 `contract-draft.md`

**可观测行为（正向）**: stdin 输入含 `sprints/<dir>/contract-draft.md` → 脚本 exit 0

**验证命令**:
```bash
# 4a: 缺合同 fixture → 必须非零退出并指明文件名（负向测试：if 语法）
if printf "sprints/06120215-ci-defense-r2/src/index.ts\n" \
  | node packages/brain/scripts/ci/check-contract-exists.mjs > /tmp/gate-neg.log 2>&1; then
  echo "FAIL: 缺合同 gate 应非零退出但返回 0"
  exit 1
fi
grep -q "contract-draft.md" /tmp/gate-neg.log \
  || { echo "FAIL: gate 未指明缺失文件名 contract-draft.md，输出: $(cat /tmp/gate-neg.log)"; exit 1; }
echo "Step 4a OK"

# 4b: 完整 fixture → 必须 0 退出
printf "sprints/06120215-ci-defense-r2/contract-draft.md\nsprints/06120215-ci-defense-r2/src/index.ts\n" \
  | node packages/brain/scripts/ci/check-contract-exists.mjs \
  || { echo "FAIL: 完整 fixture 应 0 退出"; exit 1; }
echo "Step 4b OK"
```

**硬阈值**: 4a exit ≠ 0 且输出含 `contract-draft.md`；4b exit 0

---

### Step 5: CI 接线 — skill 文件变更自动触发契约测试且进入 ci-passed

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条「CI 接线」，PRD 原文：`brain-ci.yml`（本合同偏差文档化：实为 `ci.yml`）在 `packages/workflows/skills/**` 路径变更时，自动触发 Step 1-4 的测试与脚本；yaml 改动最小化

**来源补充**: `[AI_ADDED]` — ci-passed 门禁接线验证，理由：新 skill-tests job 若未进入 ci-passed 的 needs 列表，分支保护规则无法感知其结果，PR 仍可绕过合并（Round 1 Reviewer 第 3 条阻塞问题）

**可观测行为**: `ci.yml` 含 `packages/workflows/skills` 触发、含 `skill-tests` job、`ci-passed` 的 `needs` 列表中含 `skill-tests`

**验证命令**:
```bash
# 5a: CI yaml 语法校验
node -e "
  const yaml = require('js-yaml');
  const fs = require('fs');
  yaml.load(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
  console.log('yaml syntax ok');
" || { echo "FAIL: ci.yml yaml 语法错误"; exit 1; }

# 5b: skill 触发路径已接入 changes 输出
grep -qE "packages/workflows/skills" .github/workflows/ci.yml \
  || { echo "FAIL: ci.yml 未含 packages/workflows/skills 触发路径"; exit 1; }

# 5c: skill-tests job 引用了正确脚本
grep -qE "changed-test-router|skill-contracts" .github/workflows/ci.yml \
  || { echo "FAIL: ci.yml 中未找到 skill 契约测试 job 引用"; exit 1; }

# 5d: skill-tests job 必须进入 ci-passed 的 needs 列表，才能真正阻塞 PR（Round 1 Reviewer 阻塞问题 #3）
grep -A60 "^  ci-passed:" .github/workflows/ci.yml | grep -qE "skill.tests" \
  || { echo "FAIL: skill-tests job 未进入 ci-passed 的 needs 列表，PR 合并门禁未接线"; exit 1; }

echo "OK"
```

**硬阈值**: ci.yml yaml 语法合法；含 `packages/workflows/skills` 触发；含 `skill-contracts`/`changed-test-router` 引用；`ci-passed` needs 含 `skill-tests`（grep 可断言）

---

## E2E 验收（final-e2e — target_environment = local_api，bash + node/vitest）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e — Harness CI 防线 R2（--changed 漏检 + Skill 契约 + 合同存在性 Gate）
# 执行环境：本地 ubuntu-latest（CI runner）或开发机，无需 Brain 服务或浏览器
set -e

WORKSPACE_ROOT="$(git rev-parse --show-toplevel)"
cd "$WORKSPACE_ROOT"

echo "=== Step 1: 路由脚本输出 skill 契约测试路径 ==="
OUTPUT=$(node packages/brain/scripts/ci/changed-test-router.mjs \
  --files "packages/workflows/skills/harness-evaluator/SKILL.md")
echo "router output: $OUTPUT"
echo "$OUTPUT" | grep -qE "packages/brain/tests/skill-contracts" \
  || { echo "FAIL: router 未输出 skill-contracts 路径"; exit 1; }
echo "✅ Step 1 PASS"

echo ""
echo "=== Step 2: skill 契约测试对当前快照全绿 ==="
npx vitest run packages/brain/tests/skill-contracts/ --reporter=verbose 2>&1 | tee /tmp/skill-contract-green.log
EXIT_CODE=${PIPESTATUS[0]}
[ "$EXIT_CODE" -eq 0 ] || { echo "FAIL: skill 契约测试未全绿 exit=$EXIT_CODE"; exit 1; }
echo "✅ Step 2 PASS"

echo ""
echo "=== Step 3: 篡改 fixture 必红且指明 env_missing ==="
FIXTURE=$(mktemp /tmp/evaluator-tampered-XXXXXX.md)
grep -v "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md > "$FIXTURE"

# 负向测试：if 语法不触发 set -e，输出重定向到文件后检查
if EVALUATOR_SKILL_FIXTURE="$FIXTURE" \
  npx vitest run packages/brain/tests/skill-contracts/ --reporter=verbose \
  > /tmp/tamper-test.log 2>&1; then
  rm -f "$FIXTURE"
  echo "FAIL: 篡改 fixture 测试全部通过，篡改检测失效"
  exit 1
fi
rm -f "$FIXTURE"

grep -qE "env_missing" /tmp/tamper-test.log \
  || { echo "FAIL: 篡改 fixture 错误未指明 'env_missing'"; exit 1; }
echo "✅ Step 3 PASS"

echo ""
echo "=== Step 4: 合同存在性 gate ==="
# 4a: 缺合同 fixture → 必须非零退出并指明文件名（if 语法处理预期失败，不触发 set -e）
if printf "sprints/06120215-ci-defense-r2/src/index.ts\n" \
  | node packages/brain/scripts/ci/check-contract-exists.mjs > /tmp/gate-neg.log 2>&1; then
  echo "FAIL: 缺合同 gate 应非零退出但返回 0"
  exit 1
fi
grep -q "contract-draft.md" /tmp/gate-neg.log \
  || { echo "FAIL: gate 未指明缺失文件名 contract-draft.md，输出: $(cat /tmp/gate-neg.log)"; exit 1; }
echo "Step 4a: 缺合同 gate 正确拦截 ✅"

# 4b: 完整 fixture → 必须 0 退出
printf "sprints/06120215-ci-defense-r2/contract-draft.md\nsprints/06120215-ci-defense-r2/src/index.ts\n" \
  | node packages/brain/scripts/ci/check-contract-exists.mjs \
  || { echo "FAIL: 完整 fixture 应 0 退出"; exit 1; }
echo "Step 4b: 完整 fixture gate 放行 ✅"
echo "✅ Step 4 PASS"

echo ""
echo "=== Step 5: CI yaml 语法 + skill 触发接线 + ci-passed 门禁 ==="
node -e "
  const yaml = require('js-yaml');
  const fs = require('fs');
  yaml.load(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
  console.log('yaml syntax ok');
" || { echo "FAIL: ci.yml yaml 语法错误"; exit 1; }

grep -qE "packages/workflows/skills" .github/workflows/ci.yml \
  || { echo "FAIL: ci.yml 未含 packages/workflows/skills 触发路径"; exit 1; }
grep -qE "changed-test-router|skill-contracts" .github/workflows/ci.yml \
  || { echo "FAIL: ci.yml 未含 skill 契约测试 job 引用"; exit 1; }

# 核心门禁：skill-tests 必须进入 ci-passed 的 needs 列表
grep -A60 "^  ci-passed:" .github/workflows/ci.yml | grep -qE "skill.tests" \
  || { echo "FAIL: skill-tests job 未进入 ci-passed 的 needs 列表，PR 合并门禁未接线"; exit 1; }

echo "✅ Step 5 PASS"

echo ""
echo "✅ Golden Path 全程验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `packages/brain/tests/skill-contracts/evaluator-invariants.test.ts` | 路由输出/契约不变量/篡改必红/gate 逻辑 | → 5 failures（router/gate 脚本不存在） |

## 风险（Risks）

| 风险 | 影响 | Mitigation |
|---|---|---|
| `skill-tests` job 未接入 `ci-passed` 的 needs 列表 | skill 文件被篡改的 PR 仍可合并，分支保护门禁形同虚设 | Generator 必须显式修改 `ci-passed` 的 `needs` 列表，合同 Step 5d 验证命令有专项 grep 检查（`grep -A60 "^  ci-passed:" ci.yml \| grep skill.tests`），测试未合规则 evaluator FAIL |
| `EVALUATOR_SKILL_FIXTURE` 环境变量未被 vitest worker 进程继承 | 篡改 fixture 测试在 CI 中实际读原始 SKILL.md，篡改检测无感知（假绿） | 契约测试通过 `process.env['EVALUATOR_SKILL_FIXTURE']`（Node.js worker 继承父进程 env）读取，并在测试开头 `console.log` 打印实际读取路径；CI 日志可确认；同时 Step 3 验证命令要求错误输出含字面量 `env_missing`，若 fixture 读错则断言失败 |
