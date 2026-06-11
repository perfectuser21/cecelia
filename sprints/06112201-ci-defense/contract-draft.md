# Sprint Contract Draft (Round 5)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

本 Sprint 全部产出为 node CLI 脚本 + vitest 测试文件 + CI yaml 新建，无 HTTP 端点。N/A — Reviewer 第 6 维自动满分（验证 oracle 覆盖度按脚本 exit-code + stdout 评估）。

---

## 已知约束（来自回归测试）

- [harness-schema-validation.test.js] → ReviewerOutputSchema 7 维字段：`dod_machineability / scope_match_prd / test_is_red / internal_consistency / risk_registered / verification_oracle_completeness / ci_workflow_alignment`
- [harness-b47-fixes.test.js] → `ci_workflow_alignment` 字段 optional（Brain schema 接口约定）
- [load-skill-content.test.js] → SKILL.md 由 `loadSkillContent()` 以文件路径读取
- [executor-initiative-skill-map.test.js] → skill task_type → skill 路径映射

---

## Golden Path

[PR 含 skill 文件变更] → [CI 触发 skill-ci.yml] → [changed-test-router 路由 fs 依赖测试] → [skill 契约 vitest 正向通过] → [反向 fixture 被拦截] → [合同存在性 gate 守护]

---

### Step 1: 新建独立 skill-ci.yml，在 packages/workflows/skills/** 变更时触发

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 6："CI 接线：brain-ci workflow 在 packages/workflows/skills/** 变更时自动运行步骤 2-5；yaml 仅做触发与调用"

**可观测行为**: 新建 `.github/workflows/skill-ci.yml`，用 `on: paths:` 触发（YAML 原生 path 过滤），当 `packages/workflows/skills/**` 有变更时自动运行 `skill-ci` job 调用 skill 契约测试

**【Round 4 修复说明】** Round 3 要求修改 `ci.yml` 的 `on: paths:` 或在 changes job bash detect 步骤中添加 YAML 列表项，但 `ci.yml` 全程用 bash pattern 检测变更（第 47-51 行），Generator 自然实现（echo `skills=...` bash 行）不会产生 YAML 列表项——旧 ARTIFACT 必然 FAIL。Reviewer 推荐修复方案 A：新建独立 `skill-ci.yml`，不污染 `ci.yml` 现有结构。

**验证命令**:
```bash
# 断言1：含 YAML 列表项格式的 packages/workflows/skills/** path 触发（非注释行；文件不存在时 grep exit 非0 自动 FAIL）
grep -v "^\s*#" .github/workflows/skill-ci.yml | grep -E "^\s+- ['\"]?packages/workflows/skills/\*\*['\"]?\s*$" | grep -q "." || { echo "FAIL: skill-ci.yml 缺 packages/workflows/skills/** YAML path 触发（需列表项格式，排除注释）"; exit 1; }
# 断言2：含 2 空格缩进的顶层 skill-ci: job key 行
grep -E "^  skill-ci:\s*$" .github/workflows/skill-ci.yml | grep -q "." || { echo "FAIL: skill-ci.yml 缺 '  skill-ci:' job 定义（需 2 空格缩进顶层 job key）"; exit 1; }
echo OK
```

**硬阈值**: `.github/workflows/skill-ci.yml` 存在，含 YAML 列表项格式 `packages/workflows/skills/**` path 触发且含 2 空格缩进的 `skill-ci:` 顶层 job key 行

---

### Step 2: changed-test-router.mjs 接收变更文件列表，stdout 含 skill 契约测试路径

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 2："node packages/brain/scripts/ci/changed-test-router.mjs --files <变更文件列表> 输出额外需执行的 fs 依赖测试清单（stdout 含 skill 契约测试路径）"

**可观测行为**: 传入 `packages/workflows/skills/harness-evaluator/SKILL.md` → stdout 至少含一行 skill-contract 相关测试路径

**验证命令**:
```bash
OUT=$(node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md 2>/dev/null)
echo "$OUT" | grep -q "skill-contract" || { echo "FAIL: stdout 无 skill-contract 路径 — OUT=[${OUT}]"; exit 1; }
echo OK
```

**硬阈值**: stdout 含字符串 `skill-contract`（路径指向 `skill-contract.test.js`）

---

### Step 3: changed-test-router.mjs fail-closed（无 --files 参数）

**来源**: `[FROM_PRD]` — PRD 边界情况："changed-test-router.mjs 缺 --files 参数 → fail-closed（非零退出）"

**可观测行为**: 无 `--files` 参数 → 脚本非零退出，stderr 含用法提示

**验证命令**:
```bash
node packages/brain/scripts/ci/changed-test-router.mjs 2>/dev/null
EXIT=$?
[ "$EXIT" -ne 0 ] || { echo "FAIL: 缺 --files 参数应非零退出，得到 exit=$EXIT"; exit 1; }
echo OK
```

**硬阈值**: exit code ≠ 0

---

### Step 4: skill 契约 vitest 测试正向通过（当前 SKILL.md 快照合规）

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 3："对当前快照跑 skill 契约 vitest 测试 → 全绿；断言覆盖：evaluator 含 env_missing 红线与 B-1.6/1.7/1.8 步骤、全文无 ws_id/contract-dod-ws 残留、reviewer 7 维名与 harness-shared.js ReviewerOutputSchema 字段逐字一致、generator 全文无 gh pr merge 可执行命令、proposer 含领域验证规则段"

**可观测行为**: `vitest run src/__tests__/skill-contract.test.js` → 全绿（exit 0），没有任何测试 FAIL

**验证命令**:
```bash
cd packages/brain
npx vitest run src/__tests__/skill-contract.test.js 2>&1
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "FAIL: skill-contract.test.js 未全绿 exit=$EXIT"; exit 1; }
# 内容检查：确认测试文件实际覆盖 PRD 要求的 7 项不变量（防止 Generator 写 trivial 测试绕过）
node -e "
const c=require('fs').readFileSync('src/__tests__/skill-contract.test.js','utf8');
const checks=[
  ['B-1.6','evaluator B-1.6步骤'],['B-1.7','evaluator B-1.7步骤'],['B-1.8','evaluator B-1.8步骤'],
  ['ws_id','ws_id/contract-dod-ws残留检查'],['gh pr merge','generator无gh-pr-merge命令'],
  ['ReviewerOutputSchema','reviewer 7维Schema对齐'],['领域验证','proposer领域验证规则段']
];
const missing=checks.filter(([k])=>!c.includes(k)).map(([,d])=>d);
if(missing.length){console.error('FAIL: skill-contract.test.js 缺不变量覆盖: '+missing.join(', '));process.exit(1);}
console.log('OK: 全部7项不变量关键字存在');
" || { echo "FAIL: 不变量内容检查失败"; exit 1; }
echo OK
```

**硬阈值**: vitest exit = 0，0 failed tests；且测试文件含 B-1.6/B-1.7/B-1.8/ws_id/gh pr merge/ReviewerOutputSchema/领域验证 全部 7 个关键字（缺一 exit 1）

---

### Step 5: skill 契约反向拦截（篡改 fixture 触发失败）

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 4："对篡改 fixture（删掉 env_missing 段副本）跑同一测试 → 非零退出，stderr 明示缺失的不变量名"

**可观测行为**: `skill-contract.test.js` 内含反向 fixture `it()` 块，该块须满足以下两个可验证条件：
① **结构**：`it()` 内调用检测函数并显式断言 `expect(result.ok).toBe(false)`（不可用隐式 truthy/不为 null 替代）且断言 `result.missing` 中含 `'env_missing'`；
② **执行**：vitest 跑该 `it()` 结果为绿色通过（PASS = 检测逻辑确实对篡改输入返回失败信号）。

**验证命令**:
```bash
# 断言1：测试文件结构——含显式 toBe(false) 断言（文件内容检查）
node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/skill-contract.test.js','utf8');if(!c.includes('toBe(false)'))process.exit(1);console.log('OK: 含 toBe(false) 显式断言')" || { echo "FAIL: 反向 fixture 缺 toBe(false) 显式断言（不得用隐式 truthy 检查）"; exit 1; }
# 断言2：反向 fixture it() 执行通过（含 env_missing 的 it 绿色 = 检测逻辑正确识别篡改）
cd packages/brain && VITEST_REVERSE=$(npx vitest run src/__tests__/skill-contract.test.js --reporter=verbose 2>&1); echo "$VITEST_REVERSE" | grep -E "✓|✔" | grep -i "env_missing" || { echo "FAIL: env_missing 反向 fixture it() 未通过（检测逻辑未正确识别篡改）"; echo "$VITEST_REVERSE"; exit 1; }
echo OK
```

**硬阈值**: 测试文件含 `toBe(false)` 显式断言 + `env_missing` 反向 it() 执行通过（二者缺一不可）

---

### Step 6: 合同存在性 gate — 缺合同 → exit 1

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 5："对含 sprints/<dir>/ 变更但缺 contract-draft.md 的 diff fixture → 非零退出"

**可观测行为**: 传入 sprint 目录下某文件但该目录无 `contract-draft.md` → 脚本 exit 1，stderr 含 sprint 目录名

**验证命令**:
```bash
# 用临时 fixture：sprint 目录有文件但无 contract-draft.md
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/sprints/test-ci-gate"
touch "$TMPDIR/sprints/test-ci-gate/sprint-prd.md"
node packages/brain/scripts/ci/contract-existence-check.mjs \
  --root "$TMPDIR" \
  --files "sprints/test-ci-gate/sprint-prd.md" 2>/dev/null
EXIT=$?
rm -rf "$TMPDIR"
[ "$EXIT" -ne 0 ] || { echo "FAIL: 缺合同应 exit 非0，得到 exit=$EXIT"; exit 1; }
echo OK
```

**硬阈值**: exit code ≠ 0

---

### Step 7: 合同存在性 gate — 有合同 → exit 0

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 5："完整 fixture（含 contract-draft.md）→ 零退出"

**可观测行为**: sprint 目录含 `contract-draft.md` → 脚本 exit 0

**验证命令**:
```bash
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/sprints/test-ci-gate"
touch "$TMPDIR/sprints/test-ci-gate/sprint-prd.md"
touch "$TMPDIR/sprints/test-ci-gate/contract-draft.md"
node packages/brain/scripts/ci/contract-existence-check.mjs \
  --root "$TMPDIR" \
  --files "sprints/test-ci-gate/sprint-prd.md"
EXIT=$?
rm -rf "$TMPDIR"
[ "$EXIT" -eq 0 ] || { echo "FAIL: 有合同应 exit 0，得到 exit=$EXIT"; exit 1; }
echo OK
```

**硬阈值**: exit code = 0

---

## Risks

| # | 风险 | 影响 | Mitigation |
|---|---|---|---|
| R1 | `skill-ci.yml` 语法错误（YAML 格式错误/缩进混用）→ 该 workflow 解析失败 | skill 契约 CI 失效，skill 文件变更无自动守护 | Generator 实现后本地运行 `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/skill-ci.yml'))"` 验证语法；E2E 验收脚本含此检查（Step 8）作为最后一道防线 |
| R2 | `skill-contract.test.js` 快照测试随合法 SKILL.md 演进产生假失败 | 合法 SKILL 更新导致 CI 假红，阻断无关 PR，引发"快照过期"误判 | 明确更新约定：修改 `packages/workflows/skills/` 下任何 SKILL.md 时，同一 PR 必须同步更新 `skill-contract.test.js` 的 fixture 快照；测试文件顶部注释声明此约定，防止下一位开发者把"快照过期"当 bug 处理 |

---

## E2E 验收（target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "=== Step 1: skill-ci.yml 含 skills/** path 触发（YAML 列表项）+ skill-ci: job ==="
grep -v "^\s*#" .github/workflows/skill-ci.yml | grep -E "^\s+- ['\"]?packages/workflows/skills/\*\*['\"]?\s*$" | grep -q "." || { echo "FAIL: skill-ci.yml 缺 skills/** YAML path 触发（排除注释/shell 命令行）；文件不存在时此处自动 FAIL"; exit 1; }
grep -E "^  skill-ci:\s*$" .github/workflows/skill-ci.yml | grep -q "." || { echo "FAIL: skill-ci.yml 缺 skill-ci: job 定义（2 空格缩进顶层 key）"; exit 1; }
echo OK

echo "=== Step 2: changed-test-router.mjs — skill 文件 → stdout 含 skill-contract ==="
OUT=$(node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md 2>/dev/null)
echo "$OUT" | grep -q "skill-contract" || { echo "FAIL: stdout 无 skill-contract 路径 — OUT=[${OUT}]"; exit 1; }
echo OK

echo "=== Step 3: changed-test-router.mjs — 无 --files → fail-closed ==="
node packages/brain/scripts/ci/changed-test-router.mjs 2>/dev/null
EXIT=$?
[ "$EXIT" -ne 0 ] || { echo "FAIL: 应 fail-closed 但 exit 0"; exit 1; }
echo OK

echo "=== Step 4: skill 契约 vitest 正向全绿 + 7 项不变量内容覆盖检查 ==="
cd packages/brain
VITEST_OUT=$(npx vitest run src/__tests__/skill-contract.test.js --reporter=verbose 2>&1)
echo "$VITEST_OUT" | grep -qE "0 failed|passed" || { echo "FAIL: skill-contract 未全绿"; echo "$VITEST_OUT"; exit 1; }
# 内容检查：确认测试文件覆盖 PRD 要求的 7 项不变量（防止 Generator 写 trivial 通过测试）
node -e "
const c=require('fs').readFileSync('src/__tests__/skill-contract.test.js','utf8');
const checks=[
  ['B-1.6','evaluator B-1.6步骤'],['B-1.7','evaluator B-1.7步骤'],['B-1.8','evaluator B-1.8步骤'],
  ['ws_id','ws_id/contract-dod-ws残留'],['gh pr merge','generator无gh-pr-merge'],
  ['ReviewerOutputSchema','reviewer 7维Schema对齐'],['领域验证','proposer领域验证规则段']
];
const missing=checks.filter(([k])=>!c.includes(k)).map(([,d])=>d);
if(missing.length){console.error('FAIL: skill-contract.test.js 缺不变量覆盖: '+missing.join(', '));process.exit(1);}
console.log('OK: 全部7项不变量关键字存在');
" || { echo "FAIL: 不变量内容检查失败"; exit 1; }
echo OK

echo "=== Step 5: 反向 fixture — toBe(false) 结构断言 + env_missing it() 通过 ==="
node -e "const c=require('fs').readFileSync('src/__tests__/skill-contract.test.js','utf8');if(!c.includes('toBe(false)'))process.exit(1);console.log('OK: toBe(false) 存在')" || { echo "FAIL: 反向 fixture 缺 toBe(false) 显式断言"; exit 1; }
echo "$VITEST_OUT" | grep -E "✓|✔" | grep -i "env_missing" || { echo "FAIL: env_missing 反向 fixture it() 未通过"; exit 1; }
echo OK
cd "$REPO_ROOT"

echo "=== Step 8: skill-ci.yml YAML 语法验证 ==="
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/skill-ci.yml'))" || { echo "FAIL: skill-ci.yml YAML 语法错误"; exit 1; }
echo OK

echo "=== Step 6: 合同存在性 — 缺合同 → exit 1 ==="
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/sprints/test-ci-gate"
touch "$TMPDIR/sprints/test-ci-gate/sprint-prd.md"
node packages/brain/scripts/ci/contract-existence-check.mjs \
  --root "$TMPDIR" --files "sprints/test-ci-gate/sprint-prd.md" 2>/dev/null
EXIT=$?
rm -rf "$TMPDIR"
[ "$EXIT" -ne 0 ] || { echo "FAIL: 缺合同应 exit 非0，得到 exit=0"; exit 1; }
echo OK

echo "=== Step 7: 合同存在性 — 有合同 → exit 0 ==="
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/sprints/test-ci-gate"
touch "$TMPDIR/sprints/test-ci-gate/sprint-prd.md"
touch "$TMPDIR/sprints/test-ci-gate/contract-draft.md"
node packages/brain/scripts/ci/contract-existence-check.mjs \
  --root "$TMPDIR" --files "sprints/test-ci-gate/sprint-prd.md"
rm -rf "$TMPDIR"
echo OK

echo "✅ Golden Path 全部验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（文件存在性） | `tests/ci-defense.test.js` | changed-test-router.mjs 存在 / contract-existence-check.mjs 存在 / skill-contract.test.js 存在 / skill-ci.yml 存在 | → 4 failures (files not created yet) |
| skill 契约内容（正向+反向） | `../../packages/brain/src/__tests__/skill-contract.test.js` | env_missing / B-1.6 / ReviewerOutputSchema / 领域验证规则 / gh pr merge | Generator 创建后全绿 |
