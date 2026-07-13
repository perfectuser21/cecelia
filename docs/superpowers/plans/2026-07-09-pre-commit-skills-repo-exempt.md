# pre-commit hook zenithjoy-skills 例外放行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给全局 pre-commit hook 加一个仓库识别例外——`zenithjoy-skills` 仓库（纯 skill SSOT 仓库）跳过 cp-*分支名+`.dev-mode` 强制检查，直接放行提交。

**Architecture:** 在 `PROJECT_ROOT` 确定之后、分支名判断之前，插入一段 `git remote get-url origin` 检测；命中 `zenithjoy-skills` 字符串则 `exit 0`。仓库里有两份完全相同的 hook 文件（`hooks/pre-commit` 和 `packages/engine/hooks/pre-commit`，`~/.git-hooks/pre-commit` 软链到后者），两份都要改，保持一致。

**Tech Stack:** Bash

## Global Constraints

- 只用字符串匹配 `git remote get-url origin` 的返回值，不用目录名/路径判断
- 其他仓库（非 zenithjoy-skills）行为必须与改动前完全一致（回归）
- 测试用 `tests/hooks/test-pre-commit.sh` 现有的 `run_test` helper 模式追加，不改动 helper 签名

---

### Task 1: 追加 zenithjoy-skills 豁免测试用例（Red）

**Files:**
- Modify: `tests/hooks/test-pre-commit.sh`

**Interfaces:**
- Consumes: 现有 `run_test name expected_exit branch has_devmode` helper（4个位置参数，`has_devmode` 目前控制是否创建 `.dev-mode.<branch>` 文件）
- Produces: 无（叶子任务，只加测试）

`run_test` 目前不支持设置 remote origin。为测试豁免逻辑，新增一个独立的测试函数 `run_test_with_origin`（不改动现有 `run_test`，避免破坏已通过的4个用例）。

- [ ] **Step 1: 在 test-pre-commit.sh 里 `run_test` 定义之后插入新 helper + 两条新用例**

在文件末尾 `run_test "feature/* 分支被拒绝" ...` 那一行之后、`echo ""` 之前插入：

```bash
run_test_with_origin() {
    local name="$1"
    local expected_exit="$2"
    local branch="$3"
    local origin_url="$4"

    local tmpdir
    tmpdir=$(mktemp -d)
    cd "$tmpdir"
    git init -q
    git config user.email "test@test.com"
    git config user.name "Test"
    git checkout -q -b "$branch" 2>/dev/null || true
    git remote add origin "$origin_url"

    echo "test" > test.txt
    git add test.txt

    local actual_exit=0
    GIT_DIR="$tmpdir/.git" bash "$HOOK_SRC" >/dev/null 2>&1 || actual_exit=$?

    cd /
    rm -rf "$tmpdir"

    if [[ "$actual_exit" == "$expected_exit" ]]; then
        echo "✅ PASS: $name"
        PASS=$((PASS+1))
    else
        echo "❌ FAIL: $name (expected exit=$expected_exit, got exit=$actual_exit)"
        FAIL=$((FAIL+1))
    fi
}

run_test_with_origin "zenithjoy-skills 仓库 main 分支直接放行" 0 "main" "https://github.com/perfectuser21/zenithjoy-skills.git"
run_test_with_origin "非 zenithjoy-skills 仓库 main 分支仍被拒绝（对照组，防误伤）" 1 "main" "https://github.com/perfectuser21/cecelia.git"
```

- [ ] **Step 2: 跑测试确认新用例失败（其余4条不受影响应仍PASS）**

Run: `bash tests/hooks/test-pre-commit.sh`
Expected: 前4条 `✅ PASS`；`zenithjoy-skills 仓库 main 分支直接放行` 报 `❌ FAIL (expected exit=0, got exit=1)`；`非 zenithjoy-skills...对照组` 报 `✅ PASS`（因为现在还没加豁免逻辑，main 分支本来就被拒绝，凑巧和预期一致——这条在 Task 2 实现后必须仍然 PASS，是防误伤的关键回归点）

- [ ] **Step 3: commit（Red）**

```bash
git add tests/hooks/test-pre-commit.sh
git commit -m "test(hooks): pre-commit 追加 zenithjoy-skills 豁免测试用例（Red）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 实现 zenithjoy-skills 豁免逻辑（Green）

**Files:**
- Modify: `hooks/pre-commit`
- Modify: `packages/engine/hooks/pre-commit`

**Interfaces:**
- Consumes: 无
- Produces: 无（终端任务）

两份文件内容完全一致，改动也完全一致：在 `PROJECT_ROOT` 确定（第8-9行）之后、VITEST/JEST_WORKER_ID 判断之前，插入 zenithjoy-skills 判断。

- [ ] **Step 1: 修改 `hooks/pre-commit`**

把文件开头这段：

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
[[ -z "$PROJECT_ROOT" ]] && exit 0

# 测试框架环境直接放行（Vitest/Jest 跑测试时 execSync 继承这些 env）
if [[ -n "${VITEST:-}" ]] || [[ -n "${JEST_WORKER_ID:-}" ]]; then
    exit 0
fi
```

改成：

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
[[ -z "$PROJECT_ROOT" ]] && exit 0

# 测试框架环境直接放行（Vitest/Jest 跑测试时 execSync 继承这些 env）
if [[ -n "${VITEST:-}" ]] || [[ -n "${JEST_WORKER_ID:-}" ]]; then
    exit 0
fi

# zenithjoy-skills 是纯 skill SSOT 仓库，改 skill 走 skill-creator→PR，不走 /dev
# （decision: pre-commit hook 对 zenithjoy-skills 仓库例外放行）
ORIGIN_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [[ "$ORIGIN_URL" == *"zenithjoy-skills"* ]]; then
    exit 0
fi
```

- [ ] **Step 2: 对 `packages/engine/hooks/pre-commit` 做完全相同的修改**

同样的查找替换（内容与上面一致）。

- [ ] **Step 3: 跑测试确认全部变绿**

Run: `bash tests/hooks/test-pre-commit.sh`
Expected:
```
✅ PASS: main 分支被拒绝
✅ PASS: cp-* 分支无 .dev-mode 被拒绝
✅ PASS: cp-* 分支有 .dev-mode 放行
✅ PASS: feature/* 分支被拒绝
✅ PASS: zenithjoy-skills 仓库 main 分支直接放行
✅ PASS: 非 zenithjoy-skills 仓库 main 分支仍被拒绝（对照组，防误伤）

结果: 6 通过, 0 失败
```

- [ ] **Step 4: 确认两份文件内容一致**

Run: `diff hooks/pre-commit packages/engine/hooks/pre-commit`
Expected: 无输出（完全一致）

- [ ] **Step 5: commit（Green）**

```bash
git add hooks/pre-commit packages/engine/hooks/pre-commit
git commit -m "feat(hooks): pre-commit 对 zenithjoy-skills 仓库例外放行（Green）

zenithjoy-skills 是纯 skill SSOT 仓库，改 skill 走 skill-creator→PR，
不走 /dev（skills-architecture.md 既有决策）。branch-protect.sh 已有
同类先例，pre-commit hook 之前没跟进，导致该仓库任何提交都被误拦。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage**：豁免逻辑（Task 2）✅ / 测试覆盖新场景+对照组防误伤（Task 1）✅ / 两份文件同步（Task 2 Step 2/4）✅。
- **Placeholder scan**：无 TBD，两处代码块均为可直接使用的完整 diff 内容。
- **Type consistency**：`run_test_with_origin` 与现有 `run_test` 共享 `PASS`/`FAIL`/`HOOK_SRC` 变量名，无冲突。
