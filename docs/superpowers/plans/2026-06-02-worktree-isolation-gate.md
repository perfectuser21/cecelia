# Worktree 隔离防护 Gate 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 跟踪。

**Goal:** 新增 PreToolUse Bash 守卫，拦截"在主仓库 git checkout/switch 到 cp-*/feature 任务分支"，断掉多任务共用主仓库导致的 git 踩踏链起点。

**Architecture:** 独立 hook `worktree-checkout-guard.sh` 挂到 settings.json 现有 Bash matcher（与 bash-guard 并列）；读 PreToolUse payload 的 `.tool_input.command` + `.cwd`，只在命中 `git checkout/switch <cp-*|feature/*>` 且 cwd 在主仓库（git-dir 不含 worktrees）时 exit 2。配套修正 worktree-manage.sh init-or-check 的误导性输出。

**Tech Stack:** Bash, jq, Engine shell 测试套（packages/engine/tests/integration/*.test.sh，CI engine-tests-shell）。

---

## File Structure

- Create: `packages/engine/hooks/worktree-checkout-guard.sh` — 守卫脚本
- Create: `packages/engine/tests/integration/worktree-checkout-guard.test.sh` — 回归测试
- Modify: `packages/engine/.claude/settings.json` — Bash matcher 追加 hook
- Modify: `packages/engine/skills/dev/scripts/worktree-manage.sh:573-579` — cmd_init_or_check 输出修正
- Modify: 版本 7 文件 + feature-registry.yml + regression-contract.yaml

---

### Task 1: 回归测试（Red）

**Files:**
- Create: `packages/engine/tests/integration/worktree-checkout-guard.test.sh`

- [ ] **Step 1: 写测试文件**

```bash
#!/usr/bin/env bash
# worktree-checkout-guard.test.sh — 主仓库 checkout 任务分支拦截测试
set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"   # → packages/engine
GUARD="$REPO_ROOT/hooks/worktree-checkout-guard.sh"

PASS=0; FAIL=0
TMPROOT=$(mktemp -d -t wt-guard-XXXXXX)
trap 'git worktree prune 2>/dev/null; rm -rf "$TMPROOT"' EXIT

make_repo() {
    local r="$1"; mkdir -p "$r"
    ( cd "$r" && git init -q -b main && git -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m init )
}

# 用 python3 安全 JSON 转义 command
run_guard() {
    local cwd="$1" cmd="$2"
    local esc; esc=$(printf '%s' "$cmd" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')
    echo "{\"cwd\":\"$cwd\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":$esc}}" | bash "$GUARD" 2>&1
    echo "EXIT:$?"
}

ec_of() { echo "$1" | grep -oE 'EXIT:[0-9]+' | sed 's/EXIT://'; }

assert_exit() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" == "$expected" ]]; then echo "✅ $label: exit=$got"; PASS=$((PASS+1))
    else echo "❌ $label: exit=$got (期望 $expected)"; FAIL=$((FAIL+1)); fi
}
assert_contains() {
    local label="$1" needle="$2" haystack="$3"
    if [[ "$haystack" == *"$needle"* ]]; then echo "✅ $label"; PASS=$((PASS+1))
    else echo "❌ $label: 缺 [$needle]"; FAIL=$((FAIL+1)); fi
}

MAIN="$TMPROOT/main-repo"; make_repo "$MAIN"

echo "=== Case A: 主仓库 checkout -b cp-* → 拦 ==="
out=$(run_guard "$MAIN" "git checkout -b cp-06021234-foo")
assert_exit "A checkout -b cp-* 拦截" "2" "$(ec_of "$out")"
assert_contains "A 含引导" "worktree" "$out"

echo "=== Case A2: 主仓库 checkout 已存在 cp-* → 拦 ==="
out=$(run_guard "$MAIN" "git checkout cp-06021234-foo")
assert_exit "A2 checkout cp-* 拦截" "2" "$(ec_of "$out")"

echo "=== Case A3: 主仓库 switch -c feature/* → 拦 ==="
out=$(run_guard "$MAIN" "git switch -c feature/bar")
assert_exit "A3 switch -c feature/* 拦截" "2" "$(ec_of "$out")"

echo "=== Case B: 主仓库 checkout main → 放行 ==="
out=$(run_guard "$MAIN" "git checkout main")
assert_exit "B checkout main 放行" "0" "$(ec_of "$out")"

echo "=== Case C: worktree 内 checkout cp-* → 放行 ==="
( cd "$MAIN" && git worktree add -q "$TMPROOT/wt-foo" -b cp-06021234-bar >/dev/null 2>&1 )
out=$(run_guard "$TMPROOT/wt-foo" "git checkout cp-06021234-baz")
assert_exit "C worktree 内放行" "0" "$(ec_of "$out")"

echo "=== Case D: 非 checkout 命令 → 放行 ==="
out=$(run_guard "$MAIN" "ls -la")
assert_exit "D 非 checkout 放行" "0" "$(ec_of "$out")"

echo "=== Case E: 文件路径 checkout → 放行 ==="
out=$(run_guard "$MAIN" "git checkout -- somefile.js")
assert_exit "E 路径 checkout 放行" "0" "$(ec_of "$out")"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
```

- [ ] **Step 2: 运行验证失败**

Run: `bash packages/engine/tests/integration/worktree-checkout-guard.test.sh`
Expected: FAIL（GUARD 文件不存在，bash 报 "No such file"，所有拦截 case exit≠2）

- [ ] **Step 3: commit-1（test only）**

```bash
git add packages/engine/tests/integration/worktree-checkout-guard.test.sh
git commit -m "test: worktree-checkout-guard 回归测试（Red）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 实现 hook + 注册 + 契约修正 + 版本（Green）

**Files:**
- Create: `packages/engine/hooks/worktree-checkout-guard.sh`
- Modify: `packages/engine/.claude/settings.json`
- Modify: `packages/engine/skills/dev/scripts/worktree-manage.sh:573-579`
- Modify: 版本/registry 文件

- [ ] **Step 1: 写守卫脚本**

`packages/engine/hooks/worktree-checkout-guard.sh`：

```bash
#!/usr/bin/env bash
# Worktree Checkout Guard — 拦截主仓库 git checkout/switch 到任务分支(cp-*/feature/*)
# 性能：非 git checkout/switch 命令 ~1ms 放行；命中才跑 git rev-parse
# 背景：主仓库被多任务当共享工作台 → git 操作互相踩踏（见 Issue bfeec6d6）
set -euo pipefail

INPUT="$(cat)"
echo "$INPUT" | jq empty >/dev/null 2>&1 || exit 0
CMD="$(echo "$INPUT" | jq -r '.tool_input.command // ""')"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""')"
[[ -z "$CMD" ]] && exit 0

# 只处理分支切换形态
echo "$CMD" | grep -qE '\bgit[[:space:]]+(checkout|switch)\b' || exit 0
# 文件/路径 checkout（含 " -- "）放行
echo "$CMD" | grep -qE '\bgit[[:space:]]+checkout\b.*[[:space:]]--[[:space:]]' && exit 0

# 提取 checkout|switch 之后第一个非 flag token 作为目标分支
TARGET="$(echo "$CMD" \
  | sed -E 's/.*\bgit[[:space:]]+(checkout|switch)[[:space:]]+//' \
  | tr ' ' '\n' | grep -vE '^-' | head -1 || true)"
[[ -z "$TARGET" ]] && exit 0
# 只拦任务分支
echo "$TARGET" | grep -qE '^(cp-|feature/)' || exit 0

# cwd 是否主仓库（git-dir 不含 worktrees）
GIT_DIR="$(git -C "${CWD:-.}" rev-parse --git-dir 2>/dev/null || echo "")"
[[ -z "$GIT_DIR" ]] && exit 0          # 不在 git 仓库 → 放行
[[ "$GIT_DIR" == *"worktrees"* ]] && exit 0   # 在 worktree → 放行

# 主仓库 + 切任务分支 → 拦截
echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  [WORKTREE GUARD] 禁止在主仓库 checkout 任务分支" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "目标分支: $TARGET" >&2
echo "主仓库不应停在 cp-*/feature 分支——多任务并发会互相抢占工作目录、踩踏 git 操作。" >&2
echo "请在独立 worktree 开发：" >&2
echo "  bash packages/engine/skills/dev/scripts/worktree-manage.sh create <task-name>" >&2
echo "  或运行 /dev" >&2
echo "" >&2
echo "[SKILL_REQUIRED: dev]" >&2
exit 2
```

然后 `chmod +x packages/engine/hooks/worktree-checkout-guard.sh`。

- [ ] **Step 2: 注册到 settings.json**

`packages/engine/.claude/settings.json` 的 Bash matcher 块改为（hooks 数组追加一项）：

```json
      {
        "matcher": "Bash",
        "hooks": [
          {"type": "command", "command": "./hooks/bash-guard.sh"},
          {"type": "command", "command": "./hooks/worktree-checkout-guard.sh"}
        ]
      }
```

- [ ] **Step 3: 修正 worktree-manage.sh cmd_init_or_check 输出**

`packages/engine/skills/dev/scripts/worktree-manage.sh` 中 `cmd_init_or_check` 末尾自检（约 573-579 行）。当前在主仓库分支创建 worktree 后会因脚本 cwd 仍在主仓库而 `exit 1`。改为：cmd_create 走过（主仓库路径）后，明确输出"已创建，请调用方 cd"，不再误判失败。

把原自检块：
```bash
    # 自检
    git_dir=$(git rev-parse --git-dir 2>/dev/null)
    local current_branch
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    [[ "$git_dir" != *"worktrees"* ]] && { echo "❌ 未在 worktree 中"; exit 1; }
    [[ ! "$current_branch" =~ ^cp- ]] && { echo "❌ 分支名不符合 cp-* 格式"; exit 1; }
    echo "✅ engine-worktree 自检通过"
```
改为：
```bash
    # 自检：脚本是子进程，无法 cd 调用方。区分两种情况：
    #   - 已在 worktree（调用方在 worktree 内调用）→ 验证通过
    #   - 在主仓库刚创建 worktree（cmd_create 已 echo 路径）→ 提示调用方 cd，不误判失败
    git_dir=$(git rev-parse --git-dir 2>/dev/null)
    if [[ "$git_dir" == *"worktrees"* ]]; then
        local current_branch
        current_branch=$(git rev-parse --abbrev-ref HEAD)
        [[ ! "$current_branch" =~ ^cp- ]] && { echo "❌ 分支名不符合 cp-* 格式"; exit 1; }
        echo "✅ engine-worktree 自检通过（已在 worktree）"
    else
        echo "✅ worktree 已创建（见上方路径）。脚本无法 cd 调用方进程——请调用方 cd 进该 worktree 后再继续。" >&2
    fi
```

- [ ] **Step 4: 版本 bump 19.2.2 → 19.2.3（7 文件）**

```bash
cd /Users/administrator/worktrees/cecelia/worktree-isolation-gate/packages/engine
for f in VERSION .hook-core-version hooks/VERSION hooks/.hook-core-version; do
  echo "19.2.3" > "$f"
done
# package.json / package-lock.json / regression-contract.yaml 用精确替换（见下步用 Edit 工具改 version 行）
```
package.json line29 `"version": "19.2.2"` → `"version": "19.2.3"`；
package-lock.json line2 `"version": "19.2.2"` → `"version": "19.2.3"`（顶层 version；若 packages."" 也有需同步）；
regression-contract.yaml line31 `version: 19.2.2` → `version: 19.2.3`，line32 `updated:` → `2026-06-02`。

- [ ] **Step 5: feature-registry.yml 新增条目**

`packages/engine/feature-registry.yml`：顶部 `version` bump（如 1.1.3 → 1.1.4），features 段追加：
```yaml
  - id: worktree-checkout-guard
    name: Worktree Checkout Guard（主仓库分支隔离）
    type: hook
    path: packages/engine/hooks/worktree-checkout-guard.sh
    status: active
    since: "2026-06-02"
    changelog:
      - version: "19.2.3"
        change: 新增——PreToolUse Bash 守卫，拦截主仓库 git checkout/switch 到 cp-*/feature 任务分支，断踩踏链起点（Issue bfeec6d6）
```

- [ ] **Step 6: regression-contract.yaml 新增回归条目**

在 hooks 段（H1-002/003 附近）追加：
```yaml
  - id: H1-004
    desc: 主仓库（git-dir 不含 worktrees）禁止 git checkout/switch 到 cp-*/feature 分支
    test: packages/engine/tests/integration/worktree-checkout-guard.test.sh
```

- [ ] **Step 7: 运行测试验证通过**

Run: `bash packages/engine/tests/integration/worktree-checkout-guard.test.sh`
Expected: `PASS=8 FAIL=0`，退出码 0。

- [ ] **Step 8: commit-2（impl）**

```bash
git add packages/engine/hooks/worktree-checkout-guard.sh \
        packages/engine/.claude/settings.json \
        packages/engine/skills/dev/scripts/worktree-manage.sh \
        packages/engine/VERSION packages/engine/.hook-core-version \
        packages/engine/hooks/VERSION packages/engine/hooks/.hook-core-version \
        packages/engine/package.json packages/engine/package-lock.json \
        packages/engine/regression-contract.yaml \
        packages/engine/feature-registry.yml
git commit -m "[CONFIG] fix(engine): worktree-checkout-guard 拦主仓库 checkout 任务分支

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** 组件1（守卫 hook）→ Task2 Step1-2；组件2（worktree-manage 修正）→ Task2 Step3；组件3（测试）→ Task1；版本/registry → Task2 Step4-6。SKILL.md 文字修正已剥离为 follow-up（跨 repo），本计划不含。✅
- **Placeholder scan:** 无 TBD/TODO，所有代码完整。✅
- **Type consistency:** hook 名 `worktree-checkout-guard.sh` 全程一致；测试 GUARD 路径指向同名文件；regression test 引用同一测试路径。✅
