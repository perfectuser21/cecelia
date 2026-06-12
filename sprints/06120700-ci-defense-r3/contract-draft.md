# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应，所有交付物为 CLI 脚本 + vitest 测试套件 + CI workflow 文件。
Reviewer 第 6 维 verification_oracle_completeness 对本节自动满分。

---

## 已知约束（来自回归测试）

- [b31-eval-cookie-isolate.test.js] → `readFileSync` 读取 `packages/workflows/skills/harness-evaluator/SKILL.md`（changed-test-router 必须能识别，**且必须在输出中出现**）
- [b20-planner-thin-prd-subject.test.js] → `readFileSync` 读取 `packages/workflows/skills/harness-planner/SKILL.md`（changed-test-router 必须能识别）
- [skill-drift.test.ts] → 版本一致性检查（不检查内容不变量，属于本 sprint 扩展范围）

---

## Golden Path

[修改 skill 文件] → [fs 依赖路由] → [skill 快照守卫] → [篡改必红验证] → [合同存在性检查] → [CI yaml 验证] → [四道守卫全绿]

---

### Step 1: 触发 — 修改 `packages/workflows/skills/**` 文件

**来源**: `[FROM_PRD]` — PRD "触发" 段（"修改任意 `packages/workflows/skills/**` 文件（如 `harness-evaluator/SKILL.md`）"）

**可观测行为**: 目标 skill 文件存在，作为后续四道守卫的输入。

**验证命令**:
```bash
grep -q "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md || { echo "FAIL: evaluator SKILL.md 不存在或缺 env_missing 不变量内容（skill 文件不完整）"; exit 1; }
echo OK
```

**硬阈值**: 文件存在且含 env_missing 不变量内容，exit 0

---

### Step 2: 守卫 1 — changed-test-router 输出 fs 依赖测试清单（含已知依赖 b31）

**来源**: `[FROM_PRD]` — PRD "守卫 1 — fs 依赖路由" 段（"运行 `node packages/brain/scripts/ci/changed-test-router.mjs --files <路径>` → 标准输出一份额外测试清单，包含**所有** fs 读取依赖该文件的测试 ID"）

**可观测行为**: stdout 至少输出 1 条 test ID，且**已知依赖** `b31-eval-cookie-isolate.test.js` 明确出现在输出中（PRD 明确"包含所有 fs 读取依赖"，合同已知约束列了 b31，若 b31 不出现说明依赖扫描漏读）。

**验证命令**:
```bash
OUTPUT=$(node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md)
[ $? -eq 0 ] || { echo "FAIL: changed-test-router exit 非零"; exit 1; }
[ -n "$OUTPUT" ] || { echo "FAIL: stdout 空，未输出任何 test ID"; exit 1; }
LINE_COUNT=$(echo "$OUTPUT" | grep -c "." || true)
[ "$LINE_COUNT" -ge 1 ] || { echo "FAIL: 输出行数 $LINE_COUNT < 1"; exit 1; }
echo "$OUTPUT" | grep -q "b31-eval-cookie-isolate" || { echo "FAIL: 已知依赖 b31-eval-cookie-isolate 未出现在输出中（PRD 要求覆盖所有 fs 依赖）"; exit 1; }
echo "输出 $LINE_COUNT 条 test ID，b31 已确认"
echo OK
```

**硬阈值**: exit 0 且 stdout ≥ 1 行非空且含 `b31-eval-cookie-isolate` 字面文本

---

### Step 3: 守卫 2 — skill 契约 vitest 全绿（4 个 skill 快照）

**来源**: `[FROM_PRD]` — PRD "守卫 2 — skill 快照契约" 段（"当前 4 个 skill 快照全绿：evaluator、reviewer、generator、proposer"）

**可观测行为**: `skill-contract.test.ts` 运行通过，覆盖 evaluator/reviewer/generator/proposer 四个核心 skill 的内容不变量断言。

**验证命令**:
```bash
cd packages/brain
npx vitest run ../../packages/workflows/skills/__tests__/skill-contract.test.ts --reporter=verbose
EXIT_CODE=$?
cd -
[ "$EXIT_CODE" -eq 0 ] || { echo "FAIL: skill-contract vitest 失败 exit=$EXIT_CODE"; exit 1; }
echo OK
```

**硬阈值**: exit 0，vitest 输出含 "4 passed" 或 4 个 describe 全部通过

---

### Step 4: 守卫 3 — 篡改 evaluator fixture → vitest 报红含 "env_missing"

**来源**: `[FROM_PRD]` — PRD "守卫 3 — 篡改必红" 段（"删除 evaluator fixture 的 `env_missing` 段 → 同一 vitest 套件报错，指明缺失的不变量名称"）

**可观测行为**: 在不修改真实 SKILL.md 的情况下，用临时 fixture 目录（通过 `SKILLS_DIR` 环境变量注入）覆盖 evaluator skill，运行 skill-contract 测试套件 → 失败且错误信息明确含 "env_missing"（而非通用失败信息）。

**实现要求**（`[AI_ADDED]` — 守卫3 能否真正验证取决于此）：`skill-contract.test.ts` 读取 `process.env.SKILLS_DIR` 作为 skill 文件查找前缀，不允许硬编码绝对路径。若硬编码，`SKILLS_DIR` 临时目录覆盖无效，vitest 读原始文件全绿，守卫3 验证失效。Planner **必须**实现 `SKILLS_DIR` 支持。

**验证命令**:
```bash
TMP_SKILL_DIR=$(mktemp -d)
# 拷贝所有 skill，只篡改 evaluator（其他 skill 保持完整避免 ENOENT 干扰）
cp -r packages/workflows/skills/harness-contract-reviewer \
      packages/workflows/skills/harness-generator \
      packages/workflows/skills/harness-contract-proposer \
      "$TMP_SKILL_DIR/"
mkdir -p "$TMP_SKILL_DIR/harness-evaluator"
grep -v "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md > "$TMP_SKILL_DIR/harness-evaluator/SKILL.md"

OUTPUT=$(cd packages/brain && SKILLS_DIR="$TMP_SKILL_DIR" npx vitest run ../../packages/workflows/skills/__tests__/skill-contract.test.ts 2>&1 || true)
cd -
rm -rf "$TMP_SKILL_DIR"

echo "$OUTPUT" | grep -iqE "FAIL|failed|× " || { echo "FAIL: vitest 未报失败（篡改后应失败）"; exit 1; }
echo "$OUTPUT" | grep -iq "env_missing" || { echo "FAIL: 错误信息未明确指出 'env_missing'"; exit 1; }
# 防守卫3静默 false pass：确认 skill-contract.test.ts 已实现 SKILLS_DIR 接口
grep -q "SKILLS_DIR" packages/workflows/skills/__tests__/skill-contract.test.ts || { echo "FAIL: skill-contract.test.ts 缺 SKILLS_DIR 接口（守卫3将静默 false pass）"; exit 1; }
echo OK
```

**硬阈值**: vitest exit 非 0 且输出含 "env_missing" 字面文本；skill-contract.test.ts 源码含 SKILLS_DIR 字面文本

---

### Step 5a: 守卫 4 — contract-existence-check 缺失合同 → 非零退出

**来源**: `[FROM_PRD]` — PRD "守卫 4 — 合同存在性" 段（"传入缺 `contract-draft.md` 的 diff fixture → 非零退出并指明缺失路径"）

**可观测行为**: sprint 目录有其他文件变更但无 `contract-draft.md` 时，脚本非零退出并在 stdout/stderr 指明缺失文件路径。

**验证命令**:
```bash
printf 'sprints/06120700-ci-defense-r3/task-plan.json\nsprints/06120700-ci-defense-r3/contract-dod.md\n' > /tmp/ci-defense-missing.txt
node packages/brain/scripts/ci/contract-existence-check.mjs --diff-fixture /tmp/ci-defense-missing.txt
MISSING_EXIT=$?
[ "$MISSING_EXIT" -ne 0 ] || { echo "FAIL: 缺 contract-draft.md 但 exit=0"; exit 1; }
echo "exit=$MISSING_EXIT (期望非0) OK"
```

**硬阈值**: exit 非 0，且 stdout/stderr 含 "contract-draft.md"

---

### Step 5b: 守卫 4 — contract-existence-check 完整合同 → 零退出

**来源**: `[FROM_PRD]` — PRD "守卫 4 — 合同存在性" 段（"传入完整 diff → 零退出"）

**可观测行为**: sprint 目录变更包含 `contract-draft.md` 时，脚本零退出。

**验证命令**:
```bash
printf 'sprints/06120700-ci-defense-r3/contract-draft.md\nsprints/06120700-ci-defense-r3/task-plan.json\n' > /tmp/ci-defense-complete.txt
node packages/brain/scripts/ci/contract-existence-check.mjs --diff-fixture /tmp/ci-defense-complete.txt
COMPLETE_EXIT=$?
[ "$COMPLETE_EXIT" -eq 0 ] || { echo "FAIL: 含 contract-draft.md 但 exit=$COMPLETE_EXIT"; exit 1; }
echo "exit=0 OK"
```

**硬阈值**: exit 0

---

### Step 6: 守卫 5 (CI 接线) — brain-ci.yml yaml 语法 + 触发路径 + 守卫脚本引用

**来源**: `[FROM_PRD]` — PRD "CI 接线" 段（"`brain-ci.yml` 对 `packages/workflows/skills/**` 变更新增 job step，依次执行上述脚本与 vitest；CI yaml 通过语法校验"）

**可观测行为**: `.github/workflows/brain-ci.yml` 文件存在、yaml 语法合法，`on.paths` 包含 `packages/workflows/skills/**` 触发路径，**且** job steps 中引用了 `changed-test-router` 脚本与 `skill-contract` 测试（证明 CI 不只触发，而是真正依次执行守卫）。

**验证命令**:
```bash
# 1. 文件存在且含 skills 触发路径（合并为内容检查，消除 weak-oracle/file-existence-only gate）
grep -q "packages/workflows/skills" .github/workflows/brain-ci.yml || { echo "FAIL: brain-ci.yml 不存在或未覆盖 skills 触发路径"; exit 1; }

# 2. yaml 语法（js-yaml 是 monorepo 已有依赖）
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/brain-ci.yml','utf8'))" || { echo "FAIL: yaml 语法错误"; exit 1; }

# 3. CI job steps 中引用守卫脚本名（防止只配 on.paths 而不执行守卫）
grep -q "changed-test-router" .github/workflows/brain-ci.yml || { echo "FAIL: brain-ci.yml 未引用 changed-test-router 脚本（CI 接线未完成）"; exit 1; }
grep -q "skill-contract" .github/workflows/brain-ci.yml || { echo "FAIL: brain-ci.yml 未引用 skill-contract 测试（CI 接线未完成）"; exit 1; }
echo OK
```

**硬阈值**: exit 0，文件含 `packages/workflows/skills`、`changed-test-router`、`skill-contract` 字样

---

## Risks

| # | 风险 | Mitigation |
|---|---|---|
| R1 | `SKILLS_DIR` 接口假设：Planner 实现 skill-contract.test.ts 时硬编码路径，`SKILLS_DIR` 覆盖无效 → 守卫3篡改测试静默 false pass（即使代码未实现，vitest 读原始 SKILL.md 全绿） | Mitigation：合同 ARTIFACT 条目新增一条，验证 skill-contract.test.ts 源码中含 `SKILLS_DIR` 字面文本；Step 4 实现要求段明确"不允许硬编码路径" |
| R2 | brain-ci.yml 触发但不执行守卫脚本：仅在 `on.paths` 里配 `packages/workflows/skills/**`，job steps 不含任何守卫命令 → 守卫5验证命令只 grep 触发路径字符串即误判"CI 接线完成" | Mitigation：Step 6 验证命令额外 grep `changed-test-router` 与 `skill-contract` 关键词，确认守卫脚本被引用；BEHAVIOR 守卫5 内嵌此三步 grep |

---

## E2E 验收（final-e2e — target_environment: local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e 验收脚本 — CI 防线三件套 R3（local_api，纯文件/脚本验证）
set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "=== Step 1: 前提条件 — evaluator SKILL.md 存在且含 env_missing 不变量 ==="
grep -q "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md || { echo "FAIL: evaluator SKILL.md 不存在或缺 env_missing 不变量内容"; exit 1; }
echo OK

echo ""
echo "=== Step 2: 守卫 1 — changed-test-router 输出 test IDs（含 b31）==="
OUTPUT=$(node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md)
[ -n "$OUTPUT" ] || { echo "FAIL: stdout 空"; exit 1; }
LINE_COUNT=$(echo "$OUTPUT" | grep -c "." || true)
[ "$LINE_COUNT" -ge 1 ] || { echo "FAIL: 输出行数 < 1"; exit 1; }
echo "$OUTPUT" | grep -q "b31-eval-cookie-isolate" || { echo "FAIL: 已知依赖 b31-eval-cookie-isolate 未出现在输出中"; exit 1; }
echo "输出 $LINE_COUNT 条 test ID，b31 已确认"

echo ""
echo "=== Step 3: 守卫 2 — skill 契约 vitest 全绿 ==="
cd packages/brain
npx vitest run ../../packages/workflows/skills/__tests__/skill-contract.test.ts --reporter=verbose
cd "$REPO_ROOT"
echo OK

echo ""
echo "=== Step 4: 守卫 3 — 篡改必红（env_missing） ==="
TMP_SKILL_DIR=$(mktemp -d)
cp -r packages/workflows/skills/harness-contract-reviewer \
      packages/workflows/skills/harness-generator \
      packages/workflows/skills/harness-contract-proposer \
      "$TMP_SKILL_DIR/"
mkdir -p "$TMP_SKILL_DIR/harness-evaluator"
grep -v "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md > "$TMP_SKILL_DIR/harness-evaluator/SKILL.md"
OUTPUT=$(cd packages/brain && SKILLS_DIR="$TMP_SKILL_DIR" npx vitest run ../../packages/workflows/skills/__tests__/skill-contract.test.ts 2>&1 || true)
cd "$REPO_ROOT"
rm -rf "$TMP_SKILL_DIR"
echo "$OUTPUT" | grep -iqE "FAIL|failed|× " || { echo "FAIL: vitest 未报失败"; exit 1; }
echo "$OUTPUT" | grep -iq "env_missing" || { echo "FAIL: 错误信息未含 env_missing"; exit 1; }
# 防守卫3静默 false pass：确认 skill-contract.test.ts 已实现 SKILLS_DIR 接口
grep -q "SKILLS_DIR" packages/workflows/skills/__tests__/skill-contract.test.ts || { echo "FAIL: skill-contract.test.ts 缺 SKILLS_DIR 接口（守卫3将静默 false pass）"; exit 1; }
echo OK

echo ""
echo "=== Step 5a: 守卫 4 — existence-check 缺失 → 非零 ==="
printf 'sprints/06120700-ci-defense-r3/task-plan.json\nsprints/06120700-ci-defense-r3/contract-dod.md\n' > /tmp/ci-defense-missing.txt
node packages/brain/scripts/ci/contract-existence-check.mjs --diff-fixture /tmp/ci-defense-missing.txt \
  && { echo "FAIL: 缺 contract-draft.md 但 exit=0"; exit 1; } || true
echo OK

echo ""
echo "=== Step 5b: 守卫 4 — existence-check 完整 → 零 ==="
printf 'sprints/06120700-ci-defense-r3/contract-draft.md\nsprints/06120700-ci-defense-r3/task-plan.json\n' > /tmp/ci-defense-complete.txt
node packages/brain/scripts/ci/contract-existence-check.mjs --diff-fixture /tmp/ci-defense-complete.txt \
  || { echo "FAIL: 含 contract-draft.md 但 exit 非零"; exit 1; }
echo OK

echo ""
echo "=== Step 6: 守卫 5 — brain-ci.yml yaml 语法 + 触发路径 + 守卫脚本引用 ==="
grep -q "packages/workflows/skills" .github/workflows/brain-ci.yml \
  || { echo "FAIL: brain-ci.yml 不存在或未覆盖 skills 触发路径"; exit 1; }
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/brain-ci.yml','utf8'))" \
  || { echo "FAIL: yaml 语法错误"; exit 1; }
grep -q "changed-test-router" .github/workflows/brain-ci.yml \
  || { echo "FAIL: brain-ci.yml 未引用 changed-test-router 脚本"; exit 1; }
grep -q "skill-contract" .github/workflows/brain-ci.yml \
  || { echo "FAIL: brain-ci.yml 未引用 skill-contract 测试"; exit 1; }
echo OK

echo ""
echo "✅ CI 防线三件套 E2E 全部验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| CLI 脚本（router + existence-check） | `tests/ci-defense.test.ts` | b31-eval-cookie-isolate/contract-draft.md/brain-ci.yml | → scripts not found → FAIL × 3 |
| skill 契约套件 | `../../packages/workflows/skills/__tests__/skill-contract.test.ts` | env_missing/B-1.6/ffprobe | → file not found → FAIL × 2 |

**Planner 实现要求**（合同硬约束，Reviewer 第 3 条 test_is_red 明确）：
- `skill-contract.test.ts` **必须**以 `process.env.SKILLS_DIR ?? '<固定前缀>'` 方式读取 skill 文件路径，**禁止硬编码绝对路径**。否则守卫3的 `SKILLS_DIR="$TMP"` 临时目录注入无效，vitest 读原始文件全绿，篡改必红验证静默 false pass。
- 合同 ARTIFACT 条目会通过 `grep SKILLS_DIR` 验证此要求已实现。
