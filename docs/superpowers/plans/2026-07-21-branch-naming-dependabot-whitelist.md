# branch-naming CI 门禁给 dependabot/** 分支加白名单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Dependabot 自动开的依赖升级 PR 能通过 `branch-naming` CI 门禁，同时不改变对 `cp-*`/基础分支的既有判断行为，也不豁免其他任何 CI job。

**Architecture:** 把当前写死在 `.github/workflows/ci.yml` 的 `branch-naming` job 里的判断逻辑抽取为独立脚本 `scripts/ci/check-branch-naming.sh`，使其可被 `packages/engine/tests/unit/*.test.sh`（glob 自动接入 CI 的 `engine-tests-shell` job）单测覆盖。脚本新增一条 `^dependabot/` 前缀白名单分支。

**Tech Stack:** Bash, GitHub Actions

---

### Task 1: 抽取分支命名判断逻辑为独立脚本（不含 dependabot 白名单，行为与现状等价）

**Files:**
- Create: `scripts/ci/check-branch-naming.sh`
- Modify: `.github/workflows/ci.yml:244-261`（`branch-naming` job 的 `检查分支命名规范` 步骤）

- [ ] **Step 1: 创建脚本，逻辑与 ci.yml 现有内联逻辑逐行等价**

```bash
mkdir -p scripts/ci
cat > scripts/ci/check-branch-naming.sh << 'SCRIPTEOF'
#!/usr/bin/env bash
# check-branch-naming.sh — /dev 工作流分支命名规范校验
# 从 .github/workflows/ci.yml 的 branch-naming job 抽取，供 CI 复用 + 单测覆盖
set -euo pipefail

BRANCH="${1:?usage: check-branch-naming.sh <branch-name>}"

# 基础分支直接跳过
if echo "$BRANCH" | grep -qE '^(main|master|develop|staging|release)$'; then
  echo "✅ 基础分支，跳过命名检查: $BRANCH"
  exit 0
fi

# 兼容 8 位 (MMDDHHNN) 与 10 位 (MMDDHHMMSS) 时间戳
if echo "$BRANCH" | grep -qE '^cp-[0-9]{8,10}-[a-z0-9-]+$'; then
  echo "✅ 分支命名规范: $BRANCH"
else
  echo "::error::分支名 '$BRANCH' 不符合 /dev 工作流规范"
  echo "  当前分支: $BRANCH"
  echo "  要求格式: cp-XXXXXXXX-task-name（8 或 10 位时间戳）"
  echo "  所有代码改动必须通过 /dev 工作流创建分支"
  exit 1
fi
SCRIPTEOF
chmod +x scripts/ci/check-branch-naming.sh
```

- [ ] **Step 2: 验证脚本对现有三类分支的行为与旧逻辑一致**

Run:
```bash
bash scripts/ci/check-branch-naming.sh "main"; echo "exit=$?"
bash scripts/ci/check-branch-naming.sh "cp-07211200-fix-something"; echo "exit=$?"
bash scripts/ci/check-branch-naming.sh "random-branch"; echo "exit=$?"
```
Expected: 第一、二条 `exit=0`，第三条打印 `::error::...` 且 `exit=1`。

- [ ] **Step 3: 修改 ci.yml，`branch-naming` job 改为调用该脚本**

在 `.github/workflows/ci.yml` 中，把（第 244-261 行）：

```yaml
      - name: 检查分支命名规范
        run: |
          BRANCH="${{ github.head_ref }}"
          # 基础分支直接跳过
          if echo "$BRANCH" | grep -qE '^(main|master|develop|staging|release)$'; then
            echo "✅ 基础分支，跳过命名检查: $BRANCH"
            exit 0
          fi
          # 兼容 8 位 (MMDDHHNN) 与 10 位 (MMDDHHMMSS) 时间戳
          if echo "$BRANCH" | grep -qE '^cp-[0-9]{8,10}-[a-z0-9-]+$'; then
            echo "✅ 分支命名规范: $BRANCH"
          else
            echo "::error::分支名 '$BRANCH' 不符合 /dev 工作流规范"
            echo "  当前分支: $BRANCH"
            echo "  要求格式: cp-XXXXXXXX-task-name（8 或 10 位时间戳）"
            echo "  所有代码改动必须通过 /dev 工作流规范"
            exit 1
          fi
```

替换为：

```yaml
      - name: 检查分支命名规范
        run: bash scripts/ci/check-branch-naming.sh "${{ github.head_ref }}"
```

- [ ] **Step 4: `bash -n` 语法检查两个文件**

Run: `bash -n scripts/ci/check-branch-naming.sh && bash -n .github/workflows/ci.yml 2>&1 || true`
Expected: `check-branch-naming.sh` 语法检查无输出（通过）。`ci.yml` 不是 bash 脚本，`bash -n` 会报错属预期，忽略即可——用 `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` 代替校验 YAML 合法性，Expected: 无异常。

- [ ] **Step 5: Commit**

```bash
git add scripts/ci/check-branch-naming.sh .github/workflows/ci.yml
git commit -m "refactor(ci): 抽取branch-naming判断逻辑为独立脚本，行为不变

为让判断逻辑能被 packages/engine/tests/unit/*.test.sh 单测覆盖，
从 ci.yml 内联脚本块抽取为 scripts/ci/check-branch-naming.sh，
对 main/cp-*/其他分支的判断行为与抽取前逐行等价，无功能变化。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 新增回归测试，暴露 Dependabot 分支当前被误拒的问题（预期该测试跑出 FAIL）

**Files:**
- Create: `packages/engine/tests/unit/check-branch-naming.test.sh`

- [ ] **Step 1: 写测试文件（覆盖旧有三类分支 + 新增 dependabot 断言）**

```bash
mkdir -p packages/engine/tests/unit
cat > packages/engine/tests/unit/check-branch-naming.test.sh << 'TESTEOF'
#!/usr/bin/env bash
# check-branch-naming.test.sh — scripts/ci/check-branch-naming.sh 行为回归测试
set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/check-branch-naming.sh"

PASS=0; FAIL=0

assert_pass() {
  local label="$1" branch="$2"
  if bash "$SCRIPT" "$branch" >/dev/null 2>&1; then
    echo "✅ $label: pass as expected ($branch)"; PASS=$((PASS+1))
  else
    echo "❌ $label: expected pass but got fail ($branch)"; FAIL=$((FAIL+1))
  fi
}

assert_fail() {
  local label="$1" branch="$2"
  if bash "$SCRIPT" "$branch" >/dev/null 2>&1; then
    echo "❌ $label: expected fail but got pass ($branch)"; FAIL=$((FAIL+1))
  else
    echo "✅ $label: fail as expected ($branch)"; PASS=$((PASS+1))
  fi
}

assert_pass "基础分支 main"       "main"
assert_pass "cp-* 8位时间戳"      "cp-07211200-fix-something"
assert_pass "cp-* 10位时间戳"     "cp-0721120059-fix-something"
assert_pass "dependabot 单包"     "dependabot/npm_and_yarn/axios-1.18.0"
assert_pass "dependabot 多包组"   "dependabot/npm_and_yarn/packages/engine/brace-expansion-and-vitest-coverage-v8-3.2.4-4.1.10"
assert_fail "随意命名分支"        "random-feature-branch"
assert_fail "feature/* 分支"      "feature/something"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
TESTEOF
chmod +x packages/engine/tests/unit/check-branch-naming.test.sh
```

- [ ] **Step 2: 跑测试，确认 dependabot 两条断言 FAIL（验证测试确实能捕获当前问题）**

Run: `bash packages/engine/tests/unit/check-branch-naming.test.sh; echo "exit=$?"`
Expected: 输出含
```
❌ dependabot 单包: expected pass but got fail (dependabot/npm_and_yarn/axios-1.18.0)
❌ dependabot 多包组: expected pass but got fail (dependabot/npm_and_yarn/packages/engine/brace-expansion-and-vitest-coverage-v8-3.2.4-4.1.10)
```
且末尾 `PASS=5 FAIL=2`，`exit=1`。

- [ ] **Step 3: Commit（测试先行，此时预期红）**

```bash
git add packages/engine/tests/unit/check-branch-naming.test.sh
git commit -m "test(ci): check-branch-naming新增dependabot分支断言，当前预期FAIL

先加测试暴露问题：Dependabot 官方分支名 dependabot/npm_and_yarn/xxx
不符合 cp-* 格式会被现有脚本拒绝，验证测试能捕获这个真实问题
（PR#4142/#4145 CI 上实测复现）。下一提交加白名单让其转绿。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: 给脚本加 dependabot 白名单，让测试转绿

**Files:**
- Modify: `scripts/ci/check-branch-naming.sh`

- [ ] **Step 1: 在基础分支检查之后、cp-* 检查之前插入 dependabot 放行分支**

把脚本中：

```bash
# 基础分支直接跳过
if echo "$BRANCH" | grep -qE '^(main|master|develop|staging|release)$'; then
  echo "✅ 基础分支，跳过命名检查: $BRANCH"
  exit 0
fi

# 兼容 8 位 (MMDDHHNN) 与 10 位 (MMDDHHMMSS) 时间戳
```

改为：

```bash
# 基础分支直接跳过
if echo "$BRANCH" | grep -qE '^(main|master|develop|staging|release)$'; then
  echo "✅ 基础分支，跳过命名检查: $BRANCH"
  exit 0
fi

# Dependabot 官方固定分支名格式（dependabot/npm_and_yarn/xxx），非 /dev 工作流产出，
# 单独放行——其余 CI job（测试/依赖冲突扫描等）对 Dependabot PR 照常跑，不豁免
if echo "$BRANCH" | grep -qE '^dependabot/'; then
  echo "✅ Dependabot 分支，跳过命名检查: $BRANCH"
  exit 0
fi

# 兼容 8 位 (MMDDHHNN) 与 10 位 (MMDDHHMMSS) 时间戳
```

- [ ] **Step 2: 重跑测试，确认全绿**

Run: `bash packages/engine/tests/unit/check-branch-naming.test.sh; echo "exit=$?"`
Expected: 全部 `✅`，末尾 `PASS=7 FAIL=0`，`exit=0`。

- [ ] **Step 3: `bash -n` 语法检查**

Run: `bash -n scripts/ci/check-branch-naming.sh`
Expected: 无输出（通过）。

- [ ] **Step 4: Commit**

```bash
git add scripts/ci/check-branch-naming.sh
git commit -m "fix(ci): branch-naming门禁给dependabot/**分支加白名单

Dependabot 自动升级 PR 分支名固定为 dependabot/npm_and_yarn/xxx，
不符合 cp-XXXXXXXX-task-name 格式，导致每个 Dependabot PR 必然被
branch-naming + ci-passed 总闸拒绝（实测 PR#4142/#4145）。新增
dependabot/ 前缀白名单放行，其余 CI job 不豁免。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: PR 合并后验证对 #4142 / #4145 生效

**Files:** 无代码改动，纯验证步骤

- [ ] **Step 1: 确认本次修复 PR 已 merge 到 main**

Run: `gh pr view <本次PR号> --json state,mergedAt`
Expected: `state: MERGED`

- [ ] **Step 2: 触发 Dependabot 重新同步分支，拿最新 main（含修复）跑 CI**

```bash
gh pr comment 4142 --body "@dependabot rebase"
gh pr comment 4145 --body "@dependabot rebase"
```

- [ ] **Step 3: 等待 Dependabot 推新 commit 后重查 CI**

Run: `gh pr checks 4142 2>&1 | grep branch-naming` 与 `gh pr checks 4145 2>&1 | grep branch-naming`
Expected: 两条都显示 `pass`（`#4145` 的 `brain-unit`/`engine-tests` 等因 vitest 4.x 依赖冲突可能仍为 fail，属预期中的独立问题，不在本次修复范围）。
