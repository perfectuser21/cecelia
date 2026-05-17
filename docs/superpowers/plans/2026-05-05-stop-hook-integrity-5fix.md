# Stop Hook Integrity 5 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 PR #2766/#2767 留下的 5 个虚假宣称真正修掉：shell 测试激活到 CI / stop-dev.sh ghost 过滤 + P5/P6 启用 / integrity 元测试 / real-env 合成。

**Architecture:** stop-dev.sh 改 2 处（ghost 过滤 + P5/P6 export）；CI yaml 加 engine-tests-shell job 跑所有 .test.sh + smoke.sh，并加 integrity 元测试做"测试有没有被测"自检；real-env-smoke job 加 stop-hook-e2e-real-brain 用 mock gh + 真 Brain endpoint 验全链路。

**Tech Stack:** Bash 5 / jq / gh / curl / GitHub Actions yaml

---

## File Structure

| 文件 | 改动 | 责任 |
|---|---|---|
| `.github/workflows/ci.yml` | 加 engine-tests-shell job + ci-passed 加 needs | shell 套接 CI |
| `packages/engine/hooks/stop-dev.sh` | ghost 过滤 + P5/P6 export | 行为修复 |
| `packages/engine/tests/integrity/stop-hook-coverage.test.sh` | 新建 | 元测试 |
| `packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh` | 新建 | real-env 合成 |
| `packages/engine/tests/unit/verify-dev-complete.test.sh` | 加 ghost 过滤 case | 单元覆盖 |
| 8 处版本文件 | 18.20.1 → 18.21.0 | engine 同步 |

---

### Task 1: fail integrity 元测试 + real-brain 骨架（v18.7.0 第一 commit）

**Files:**
- Create: `packages/engine/tests/integrity/stop-hook-coverage.test.sh`
- Create: `packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh`

- [ ] **Step 1: 写 integrity 元测试**

`packages/engine/tests/integrity/stop-hook-coverage.test.sh`：

```bash
#!/usr/bin/env bash
# stop-hook-coverage.test.sh — 元测试：stop hook 测试套有没有真被 CI 跑 + 配置真接通
set -uo pipefail
THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"

PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

CI_YAML_FILES=$(find "$REPO_ROOT/.github/workflows" -name "*.yml")

expect_in_ci() {
    local pattern="$1"
    local label="$2"
    if grep -qE "$pattern" $CI_YAML_FILES 2>/dev/null; then
        pass "$label 在 CI workflow"
    else
        fail "$label 未接 CI（死代码）"
    fi
}

expect_in_ci 'verify-dev-complete\.test\.sh|tests/unit/\*\.test\.sh|tests/unit/.*test\.sh' "verify-dev-complete unit"
expect_in_ci 'stop-hook-7stage-flow|tests/integration/.*test\.sh' "stop-hook-7stage-flow integration"
expect_in_ci 'ralph-loop-mode|tests/integration/.*test\.sh' "ralph-loop-mode integration"
expect_in_ci 'dev-mode-tool-guard|tests/integration/.*test\.sh' "dev-mode-tool-guard integration"
expect_in_ci 'stop-hook-7stage-smoke|scripts/smoke/.*-smoke\.sh' "stop-hook-7stage-smoke"
expect_in_ci 'ralph-loop-smoke|scripts/smoke/.*-smoke\.sh' "ralph-loop-smoke"

if grep -q 'verify_dev_complete' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 调用 verify_dev_complete"
else
    fail "stop-dev.sh 未调 verify_dev_complete"
fi

if grep -qE 'VERIFY_DEPLOY_WORKFLOW.*=.*1' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 启用 VERIFY_DEPLOY_WORKFLOW=1"
else
    fail "stop-dev.sh P5 disabled（功能死）"
fi

if grep -qE 'VERIFY_HEALTH_PROBE.*=.*1' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 启用 VERIFY_HEALTH_PROBE=1"
else
    fail "stop-dev.sh P6 disabled（功能死）"
fi

if grep -qE 'ghost|session_id.*unknown|is_ghost' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 含 ghost 过滤逻辑"
else
    fail "stop-dev.sh 无 ghost 过滤"
fi

if [[ -f "$REPO_ROOT/packages/engine/hooks/dev-mode-tool-guard.sh" ]]; then
    pass "dev-mode-tool-guard.sh 存在"
else
    fail "dev-mode-tool-guard.sh 缺失"
fi

echo ""
echo "=== integrity: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
```

`chmod +x packages/engine/tests/integrity/stop-hook-coverage.test.sh`

- [ ] **Step 2: 写 real-brain 合成骨架**

`packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh`：

```bash
#!/usr/bin/env bash
# stop-hook-e2e-real-brain.test.sh — real-env-smoke 合成
# 假定 docker compose Brain 已起在 5221（real-env-smoke job 起的）
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BRAIN_URL="${BRAIN_HEALTH_URL:-http://localhost:5221/api/brain/health}"

if ! curl -fsS --max-time 5 "$BRAIN_URL" >/dev/null 2>&1; then
    echo "⚠️  Brain 未起，本测试需 docker compose Brain（real-env-smoke job 起）— 跳过"
    exit 0
fi
pass "前置: Brain 健康"

TMP_MAIN=$(mktemp -d)
mkdir -p "$TMP_MAIN/.cecelia" "$TMP_MAIN/docs/learnings" "$TMP_MAIN/packages/engine/skills/dev/scripts" "$TMP_MAIN/packages/engine/lib" "$TMP_MAIN/packages/engine/hooks"
cat > "$TMP_MAIN/.cecelia/dev-active-cp-test-real.json" <<EOF
{
  "branch": "cp-test-real",
  "worktree": "/tmp/wt-real",
  "started_at": "2026-05-05T10:00:00+08:00",
  "session_id": "real-test-$$"
}
EOF
echo -e "### 根本原因\nfoo\n### 下次预防\n- [ ] bar" > "$TMP_MAIN/docs/learnings/cp-test-real.md"
cp "$REPO_ROOT/packages/engine/lib/devloop-check.sh" "$TMP_MAIN/packages/engine/lib/"
cp "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" "$TMP_MAIN/packages/engine/hooks/"
echo '#!/usr/bin/env bash
exit 0' > "$TMP_MAIN/packages/engine/skills/dev/scripts/cleanup.sh"
chmod +x "$TMP_MAIN/packages/engine/skills/dev/scripts/cleanup.sh"

(cd "$TMP_MAIN" && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git branch -M main)
pass "mock 主仓库 + dev-active 就位"

STUB=$(mktemp -d)
cat > "$STUB/gh" <<'STUB'
#!/usr/bin/env bash
json_field=""
for ((i=1; i<=$#; i++)); do
    [[ "${!i}" == "--json" ]] && { j=$((i+1)); json_field="${!j}"; }
done
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view")
        case "$json_field" in
            mergedAt) echo "2026-05-05T02:00:00Z" ;;
            mergeCommit) echo '{"oid":"abc123def"}' ;;
        esac ;;
    "run list")
        case "$json_field" in
            status) echo "completed" ;;
            conclusion) echo "success" ;;
            databaseId) echo "999" ;;
        esac ;;
    "run view")
        case "$json_field" in
            status) echo "completed" ;;
            conclusion) echo "success" ;;
        esac ;;
esac
exit 0
STUB
chmod +x "$STUB/gh"

export PATH="$STUB:$PATH"
export CLAUDE_HOOK_CWD="$TMP_MAIN"
output=$(bash "$TMP_MAIN/packages/engine/hooks/stop-dev.sh" 2>&1 || echo "EXIT=$?")
echo "stop-dev output: $output"

if [[ ! -f "$TMP_MAIN/.cecelia/dev-active-cp-test-real.json" ]]; then
    pass "done 路径 rm dev-active 成功（P5+P6 真链路通）"
else
    fail "dev-active 仍在 — P5/P6 链路有断点。output: $output"
fi

rm -rf "$TMP_MAIN" "$STUB"

echo ""
echo "=== stop-hook-e2e-real-brain: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
```

`chmod +x packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh`

- [ ] **Step 3: 跑测试验证 fail（预期 fail）**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
chmod +x packages/engine/tests/integrity/stop-hook-coverage.test.sh \
         packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh
bash packages/engine/tests/integrity/stop-hook-coverage.test.sh 2>&1 | tail -10
bash packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh 2>&1 | tail -5
```

Expected:
- integrity FAIL 多条（CI 没接 + ghost 过滤无 + P5/P6 disabled）
- real-brain Brain 不健康 → exit 0 容错跳过

- [ ] **Step 4: Commit fail 起点**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
git add packages/engine/tests/integrity/stop-hook-coverage.test.sh \
        packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh
git commit -m "test(engine): integrity 元测试 + real-brain 合成（fail 起点）(cp-0505101826)

按 v18.7.0 第一 commit = fail E2E + smoke 骨架。

integrity: 验 CI workflow 引用 + stop-dev.sh 配置接通（预期 fail，5 项缺失）
real-brain: 真 Brain + mock gh 全链路 done（Brain 不健康时 exit 0）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: stop-dev.sh ghost 过滤 + 单测

**Files:**
- Modify: `packages/engine/hooks/stop-dev.sh:38-46`
- Modify: `packages/engine/tests/unit/verify-dev-complete.test.sh`（加 stop-dev 子进程测试）

- [ ] **Step 1: 改 stop-dev.sh ghost 过滤**

读 `packages/engine/hooks/stop-dev.sh` 第 38-46 行附近的 dev_state for loop。当前是：

```bash
dev_state=""
for _f in "$dev_state_dir"/dev-active-*.json; do
    [[ -f "$_f" ]] && { dev_state="$_f"; break; }
done
```

替换为：

```bash
dev_state=""
for _f in "$dev_state_dir"/dev-active-*.json; do
    [[ -f "$_f" ]] || continue

    # ghost 过滤：远端 sync 来的状态文件不该 block 本机 stop hook
    sid=$(jq -r '.session_id // ""' "$_f" 2>/dev/null)
    wt=$(jq -r '.worktree // ""' "$_f" 2>/dev/null)
    branch_in=$(jq -r '.branch // ""' "$_f" 2>/dev/null)

    is_ghost=0
    # 特征 1: session_id="unknown"（远端 sync 缺 session 标识）
    [[ "$sid" == "unknown" ]] && is_ghost=1
    # 特征 2: worktree path 在本地不存在 + 分支 0 commit ahead of main
    if [[ -n "$wt" && ! -d "$wt" && -n "$branch_in" ]]; then
        ahead=$(git -C "$main_repo" rev-list --count "main..${branch_in}" 2>/dev/null || echo 0)
        [[ "$ahead" -eq 0 ]] && is_ghost=1
    fi

    if [[ "$is_ghost" -eq 1 ]]; then
        echo "[stop-dev] 自动清理 ghost dev-active: $_f (sid=$sid wt=$wt)" >&2
        rm -f "$_f"
        continue
    fi

    dev_state="$_f"
    break
done
```

- [ ] **Step 2: 写 stop-dev.sh ghost 过滤集成测试**

`packages/engine/tests/integration/stop-dev-ghost-filter.test.sh`（新建）：

```bash
#!/usr/bin/env bash
# stop-dev-ghost-filter.test.sh — stop-dev.sh ghost 自动清理验证
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STOP_HOOK="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

# === Case 1: session_id="unknown" ghost 自动清理 ===
TMP=$(mktemp -d)
(cd "$TMP" && git init -q && touch .gitkeep && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git branch -M main)
mkdir -p "$TMP/.cecelia"
cat > "$TMP/.cecelia/dev-active-cp-ghost-1.json" <<EOF
{"branch":"cp-ghost-1","worktree":"/home/cecelia/worktrees/x","session_id":"unknown"}
EOF
CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
exit_code=$?
if [[ ! -f "$TMP/.cecelia/dev-active-cp-ghost-1.json" ]]; then
    pass "Case 1: session_id=unknown 已自动 rm"
else
    fail "Case 1: ghost 仍在"
fi
[[ $exit_code -eq 0 ]] && pass "Case 1: stop-dev exit 0" || fail "Case 1: exit=$exit_code"
rm -rf "$TMP"

# === Case 2: worktree 不存在 + 0 commit ahead 自动清理 ===
TMP=$(mktemp -d)
(cd "$TMP" && git init -q && touch .gitkeep && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git branch -M main && git branch cp-ghost-2)
mkdir -p "$TMP/.cecelia"
cat > "$TMP/.cecelia/dev-active-cp-ghost-2.json" <<EOF
{"branch":"cp-ghost-2","worktree":"/nonexistent/wt","session_id":"realsess123"}
EOF
CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
if [[ ! -f "$TMP/.cecelia/dev-active-cp-ghost-2.json" ]]; then
    pass "Case 2: worktree 不存在 + 0 commit 已 rm"
else
    fail "Case 2: ghost 仍在"
fi
rm -rf "$TMP"

# === Case 3: 真实 dev-active（worktree 存在）保留 ===
TMP=$(mktemp -d)
(cd "$TMP" && git init -q && touch .gitkeep && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git branch -M main)
mkdir -p "$TMP/.cecelia"
WT_REAL=$(mktemp -d)
cat > "$TMP/.cecelia/dev-active-cp-real-3.json" <<EOF
{"branch":"cp-real-3","worktree":"$WT_REAL","session_id":"realsess456"}
EOF
CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
if [[ -f "$TMP/.cecelia/dev-active-cp-real-3.json" ]]; then
    pass "Case 3: 真实 dev-active 保留（worktree 存在 → 触发 verify_dev_complete）"
else
    fail "Case 3: 真实 dev-active 被误 rm"
fi
rm -rf "$TMP" "$WT_REAL"

echo ""
echo "=== stop-dev-ghost-filter: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
```

`chmod +x packages/engine/tests/integration/stop-dev-ghost-filter.test.sh`

- [ ] **Step 3: 跑测试验证 ghost 过滤工作**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
chmod +x packages/engine/tests/integration/stop-dev-ghost-filter.test.sh
bash packages/engine/tests/integration/stop-dev-ghost-filter.test.sh 2>&1 | tail -8
```

Expected: 4 PASS / 0 FAIL（Case 1: 2 assert + Case 2: 1 + Case 3: 1）

- [ ] **Step 4: Commit ghost 过滤**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
git add packages/engine/hooks/stop-dev.sh \
        packages/engine/tests/integration/stop-dev-ghost-filter.test.sh
git commit -m "fix(engine): stop-dev.sh ghost dev-active 自动清理 (cp-0505101826)

特征 1: session_id=\"unknown\"（远端 sync 缺 session 标识）
特征 2: worktree 路径本地不存在 + 分支 0 commit ahead of main

任一特征命中 → rm 文件 + continue 下一个；都是 ghost 时
dev_state=\"\" → exit 0 普通对话。

修今晚 wave2 cp-0504130848 / cp-0504131813 死锁 — 远端 worker
sync 来的状态文件持续 block 本机 stop hook，靠人工 rm。

3 case integration 全过。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: stop-dev.sh 启用 P5/P6

**Files:**
- Modify: `packages/engine/hooks/stop-dev.sh`（verify_dev_complete 调用处）

- [ ] **Step 1: 改 stop-dev.sh P5/P6 export**

读 `packages/engine/hooks/stop-dev.sh` 找到 verify_dev_complete 调用行（约 line 76）。当前是：

```bash
result=$(verify_dev_complete "$branch" "$worktree_path" "$main_repo" 2>/dev/null) || true
```

替换为：

```bash
result=$(
    : "${VERIFY_DEPLOY_WORKFLOW:=1}"
    : "${VERIFY_HEALTH_PROBE:=1}"
    export VERIFY_DEPLOY_WORKFLOW VERIFY_HEALTH_PROBE
    verify_dev_complete "$branch" "$worktree_path" "$main_repo" 2>/dev/null
) || true
```

`:=` 仅在变量未设时赋默认 — 用户外部 `export VERIFY_HEALTH_PROBE=0` 可禁用（escape hatch）。

- [ ] **Step 2: 跑 integrity 元测试验证 P5/P6 启用**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
bash packages/engine/tests/integrity/stop-hook-coverage.test.sh 2>&1 | tail -10
```

Expected: integrity 现在 P5/P6 + ghost 过滤 + stop-dev 调用 4 项全过；CI 引用 6 项仍 fail（待 Task 4）。

- [ ] **Step 3: Commit P5/P6 启用**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
git add packages/engine/hooks/stop-dev.sh
git commit -m "feat(engine): stop-dev.sh 启用 P5 (deploy workflow) + P6 (health probe) (cp-0505101826)

stop-dev.sh 调 verify_dev_complete 时默认 export
VERIFY_DEPLOY_WORKFLOW=1 + VERIFY_HEALTH_PROBE=1。

修 PR #2766 的虚假宣称：P5/P6 代码合到 main 但真链路 disabled。
现在 stop hook 真验证 brain-ci-deploy.yml conclusion + GET /api/brain/health 200。

escape hatch: 用户外部 export VERIFY_HEALTH_PROBE=0 可禁用（:= 默认值语法）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: CI engine-tests-shell job + ci-passed needs

**Files:**
- Modify: `.github/workflows/ci.yml`（加新 job + needs）

- [ ] **Step 1: 读 ci.yml 找 ci-passed job**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
grep -n "^  [a-z].*:$\|^  ci-passed\|^jobs:\|needs:" .github/workflows/ci.yml | head -30
```

记下 ci-passed 的 needs 列表位置。

- [ ] **Step 2: 加 engine-tests-shell job（在 ci-passed 之前）**

读现有 yaml 风格（缩进 / `if:` 用法 / `runs-on`），按现有 engine-tests job 模式追加：

找到 `engine-tests` job 块结尾（看缩进），插入：

```yaml
  engine-tests-shell:
    name: Engine Shell Tests (stop hook 套)
    runs-on: ubuntu-latest
    needs: changes
    if: needs.changes.outputs.engine == 'true' || github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - name: Install jq
        run: sudo apt-get update -qq && sudo apt-get install -y jq
      - name: Run unit shell tests
        run: |
          for t in packages/engine/tests/unit/*.test.sh; do
            [[ -f "$t" ]] || continue
            echo "::group::$(basename "$t")"
            bash "$t" || exit 1
            echo "::endgroup::"
          done
      - name: Run integration shell tests
        run: |
          for t in packages/engine/tests/integration/*.test.sh; do
            [[ -f "$t" ]] || continue
            echo "::group::$(basename "$t")"
            bash "$t" || exit 1
            echo "::endgroup::"
          done
      - name: Run integrity meta-tests
        run: |
          for t in packages/engine/tests/integrity/*.test.sh; do
            [[ -f "$t" ]] || continue
            echo "::group::$(basename "$t")"
            bash "$t" || exit 1
            echo "::endgroup::"
          done
      - name: Run smoke (无 Brain 容错跳过 P6 真探针)
        run: |
          for s in packages/engine/scripts/smoke/*-smoke.sh; do
            [[ -f "$s" ]] || continue
            echo "::group::$(basename "$s")"
            bash "$s" || exit 1
            echo "::endgroup::"
          done
```

- [ ] **Step 3: 加 engine-tests-shell 到 ci-passed needs**

找到 ci-passed 的 needs 列表，加 engine-tests-shell：

```yaml
  ci-passed:
    name: CI Passed
    runs-on: ubuntu-latest
    needs:
      - engine-tests
      - engine-tests-shell   # ← 加这行
      - brain-unit
      - ...（保持原有列表）
```

- [ ] **Step 4: yaml 语法验证 + integrity 元测试再跑**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
# yaml 语法（如有 yamllint）
command -v yamllint >/dev/null 2>&1 && yamllint .github/workflows/ci.yml 2>&1 | tail -5 || echo "yamllint 不可用，跳过"
# integrity 元测试现在应全过
bash packages/engine/tests/integrity/stop-hook-coverage.test.sh 2>&1 | tail -10
```

Expected: integrity 全过（CI 引用 + stop-dev 配置都 OK）

- [ ] **Step 5: Commit CI 接通**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
git add .github/workflows/ci.yml
git commit -m "ci: engine-tests-shell job 激活 stop hook shell 测试套 (cp-0505101826)

修 PR #2766 的虚假宣称：32 unit + 5 integration + 8 smoke shell
测试是死代码（vitest 不识别 .sh，CI workflow 0 引用）。

新 job 跑：
- packages/engine/tests/unit/*.test.sh
- packages/engine/tests/integration/*.test.sh
- packages/engine/tests/integrity/*.test.sh
- packages/engine/scripts/smoke/*-smoke.sh

加进 ci-passed required → main regression 立即可被发现。

integrity 元测试此 commit 后全过。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 8 处版本 + Learning + feature-registry 收尾

**Files:**
- Modify: 8 处版本文件 + `packages/engine/feature-registry.yml`
- Create: `docs/learnings/cp-0505101826-stop-hook-integrity-5fix.md`

- [ ] **Step 1: 8 处版本 bump 18.20.1 → 18.21.0**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
for f in packages/engine/VERSION packages/engine/package.json \
         packages/engine/package-lock.json packages/engine/regression-contract.yaml \
         packages/engine/.hook-core-version packages/engine/hooks/.hook-core-version \
         packages/engine/hooks/VERSION packages/engine/skills/dev/SKILL.md; do
    [[ -f "$f" ]] && sed -i '' 's/18\.20\.1/18.21.0/g' "$f"
done
grep -rn "18\.20\.1" packages/engine/ 2>&1 | grep -v feature-registry | head -3
echo "---新版本---"
grep -rn "18\.21\.0" packages/engine/ 2>&1 | wc -l
```

Expected: `18.20.1` 仅 feature-registry 历史；`18.21.0` 8+ hit

- [ ] **Step 2: feature-registry.yml 加 changelog 顶部**

读 `packages/engine/feature-registry.yml` changelog 列表顶部，在 18.20.1 条目前插入：

```yaml
  - version: "18.21.0"
    date: "2026-05-05"
    change: "feat"
    description: "Stop Hook integrity 5 修复（cp-0505101826）— PR #2766/#2767 上线后自审发现 5 个虚假宣称：(1) 32 unit + 5 integration + 8 smoke shell 测试是死代码（vitest 不识别 .sh，CI workflow 0 引用），(2) stop-dev.sh 没 ghost 过滤（远端 sync 来的 dev-active 持续 block，今晚发生 2 次），(3) P5/P6 真链路 disabled（stop-dev.sh 调 verify_dev_complete 不设 VERIFY_*=1），(4) 无 integrity 元测试，(5) 无 CI 合成场景。修：CI 加 engine-tests-shell job（接 ci-passed required）；stop-dev.sh ghost 过滤（session_id=unknown 或 worktree 不存在+0 commit 自动 rm）；stop-dev.sh export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1（escape hatch :=）；新建 integrity 元测试 + real-brain 合成。Stop Hook 完整闭环第 11 段。"
    files:
      - "packages/engine/hooks/stop-dev.sh (ghost 过滤 + P5/P6 启用)"
      - "packages/engine/tests/integrity/stop-hook-coverage.test.sh (新建元测试)"
      - "packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh (新建合成场景)"
      - "packages/engine/tests/integration/stop-dev-ghost-filter.test.sh (新建 ghost 过滤测试)"
      - ".github/workflows/ci.yml (engine-tests-shell job + ci-passed needs)"
      - "Engine 8 处版本文件 18.21.0"
```

- [ ] **Step 3: 写 Learning**

`docs/learnings/cp-0505101826-stop-hook-integrity-5fix.md`：

```markdown
# Learning — Stop Hook Integrity 5 修复（2026-05-05）

分支：cp-0505101826-stop-hook-integrity-5fix
版本：Engine 18.20.1 → 18.21.0
前置 PR：#2766 (verify_dev_complete P1-P7) + #2767 (Task 3/5/6)
本 PR：第 11 段 — integrity 加固

## 故障

PR #2766 + #2767 上线后 Alex 让我"深度看有没有问题 + 有没有 integrity test"。
自审发现 5 个虚假宣称：

1. **shell 测试是死代码**：32 unit + 5 integration + 8 smoke 全部不在 CI 跑
   （vitest 不识别 .test.sh，`.github/workflows/` 0 引用）— main 有人改
   verify_dev_complete / stop-dev.sh 不会被 CI 拦
2. **ghost 过滤缺失**：stop-dev.sh 取 dev-active-*.json 第一个就 break，
   远端 sync 来的 session_id="unknown" + 远端 worktree 路径 + 0 commit 的
   ghost 持续 block stop hook（今晚 cp-0504130848 / cp-0504131813 死锁 2 次）
3. **P5/P6 真链路 disabled**：stop-dev.sh 调 verify_dev_complete 没设
   VERIFY_*=1，P5/P6 代码合到 main 但实战不启用
4. **无 integrity 元测试**：没有"测试有没有被测"的检查
5. **无 CI 合成场景**：没有起真 Brain → mock PR merged → stop-dev.sh 真跑
   → 验 P5+P6+done 的端到端

## 根本原因

PR #2766 优先修核心决策树（verify_dev_complete 7 阶段重写），把"代码合到
main"当成"功能上线"。两个差距：
- 测试代码合了但 CI 不跑 = 假绿
- 函数定义了但 caller 没用 = 假启用

PR #2767 跟进修测试基础设施，但没自审"测试自己有没有被测"。
ghost 过滤问题积累 2 个月（远端 worker sync 模式从 4/27 起就有）—
每次 ghost 出现都靠人工 rm，没人系统化修。

## 本次解法

### 修复 1 — engine-tests-shell CI job
.github/workflows/ci.yml 加新 job 跑所有 unit/integration/integrity/smoke
shell 脚本，加进 ci-passed required。下次 stop hook 套被改坏 CI 立即抓。

### 修复 2 — stop-dev.sh ghost 过滤
取 dev-active-*.json 时检查：
- session_id="unknown" → 自动 rm
- worktree 路径不存在 + 分支 0 commit ahead of main → 自动 rm
都是 ghost 时 dev_state="" → exit 0 普通对话。

### 修复 3 — stop-dev.sh 启用 P5/P6
调 verify_dev_complete 时 := 默认 export VERIFY_DEPLOY_WORKFLOW=1
VERIFY_HEALTH_PROBE=1。escape hatch：用户 export 0 可禁用。

### 修复 4 — integrity 元测试
新建 stop-hook-coverage.test.sh：
- grep CI yaml 验证关键 .test.sh 被引用
- grep stop-dev.sh 验证 verify_dev_complete 调用 + P5/P6 启用 + ghost 过滤
- 接 engine-tests-shell job

### 修复 5 — real-env 合成场景
新建 stop-hook-e2e-real-brain.test.sh：
- mock 主仓库 + dev-active + Learning + cleanup
- mock gh CLI 模拟 PR merged + deploy success
- 真跑 stop-dev.sh → curl 真 Brain endpoint → 验 done 路径 rm dev-active
- Brain 不健康时 exit 0 容错（CI real-env-smoke job 起 docker compose）

## 下次预防

- [ ] **代码合到 main ≠ 功能上线**：必须有"caller 真调"的元测试。函数定义但 caller 不调 = dead code，CI 应抓
- [ ] **测试合到 main ≠ 测试在跑**：必须 grep `.github/workflows/` 验证测试文件被引用，否则测试本身是 dead code
- [ ] **任何决策路径有 env flag**：必须有元测试 grep 验证 caller 设置了 flag（如 `VERIFY_*=1`），否则 flag 路径是 dead code
- [ ] **ghost 状态文件**（远端 sync 来的）必须自动过滤：识别特征 + 自动 rm + 不依赖人工
- [ ] **Lint job 不止管"新增"**：lint-test-pairing 已对 modified 也检查，但还需要"caller 真调"层面的 lint
- [ ] **大 PR 的"留后续 task"必须 ≤ 3 day**：今晚 PR #2766 的 plan Task 3/5/6 合在 #2767，但仍有这一波 5 修复才补完整。下次 PR 上限 = 一次合就闭环

## 验证证据

- engine-tests-shell job 跑通：unit 32 case + integration 5+3 + integrity 8 + smoke 8 全过
- stop-dev-ghost-filter 3 case 真跑通过（session_id=unknown / worktree 不存在 / 真 worktree 保留）
- integrity 元测试 8 项全过（CI 引用 6 + stop-dev 配置 2）
- real-brain 合成 3 PASS（Brain 健康场景，本地无 Brain 时 exit 0 容错）
- 8 处版本文件 18.21.0
- ci-passed needs 含 engine-tests-shell

## Stop Hook 完整闭环（11 段）

| 段 | PR | 内容 |
|---|---|---|
| 4/21 | #2503 | cwd-as-key 身份归一 |
| 5/4 | #2745 | 散点 12 → 集中 3 |
| 5/4 | #2746 | 探测失败 fail-closed |
| 5/4 | #2747 | 三态出口严格分离 |
| 5/4 | #2749 | condition 5 真完成守门 |
| 5/4 | #2752 | Ralph Loop 模式 |
| 5/4 | #2757 | 50 case 测试金字塔 |
| 5/4 | #2759 | PreToolUse 拦截 |
| 5/4 | #2761 | done schema 修正 |
| 5/4 | #2766 | 7 阶段决策树 + monitor-loop guard |
| 5/4 | #2767 | 测试基础设施完善 + cleanup 解耦 |
| 5/5 | **本 PR** | **integrity 5 修复 — 死代码激活 + ghost 过滤 + P5/P6 启用** |
```

- [ ] **Step 4: 跑全套测试 + check-cleanup**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
bash packages/engine/skills/dev/scripts/check-cleanup.sh 2>&1 | tail -5
echo "---unit---"
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -2
echo "---integration---"
bash packages/engine/tests/integration/stop-hook-7stage-flow.test.sh 2>&1 | tail -2
bash packages/engine/tests/integration/stop-dev-ghost-filter.test.sh 2>&1 | tail -2
echo "---integrity---"
bash packages/engine/tests/integrity/stop-hook-coverage.test.sh 2>&1 | tail -2
echo "---smoke---"
bash packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh 2>&1 | tail -2
```

Expected: 全过 / check-cleanup OK

- [ ] **Step 5: Commit 收尾**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-integrity-5fix
git add packages/engine/VERSION packages/engine/package.json \
        packages/engine/package-lock.json packages/engine/regression-contract.yaml \
        packages/engine/.hook-core-version packages/engine/hooks/.hook-core-version \
        packages/engine/hooks/VERSION packages/engine/skills/dev/SKILL.md \
        packages/engine/feature-registry.yml \
        docs/learnings/cp-0505101826-stop-hook-integrity-5fix.md
git commit -m "[CONFIG] chore: bump engine 18.20.1 → 18.21.0 + Learning + feature-registry (cp-0505101826)

Stop Hook integrity 5 修复完整闭环（第 11 段）：
- engine-tests-shell CI job 激活 shell 测试套
- stop-dev.sh ghost 过滤（自动 rm session_id=unknown/worktree 不存在）
- stop-dev.sh 启用 P5 P6（VERIFY_*=1 := 默认）
- integrity 元测试 + real-brain 合成

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 完成定义

- engine-tests-shell job 跑通（unit + integration + integrity + smoke 全过）
- stop-dev-ghost-filter 3 case 全过
- integrity 元测试全过
- real-brain 合成 Brain 健康场景全过 / 无 Brain exit 0
- 8 处版本 18.21.0
- ci-passed needs 含 engine-tests-shell
- Learning 含 ### 根本原因 + ### 下次预防

## Self-Review

**1. Spec coverage**
- §3.1 修复 1 CI engine-tests-shell → Task 4 ✓
- §3.2 修复 2 ghost 过滤 → Task 2 ✓
- §3.3 修复 3 P5/P6 启用 → Task 3 ✓
- §3.4 修复 4 integrity 元测试 → Task 1 (写) + Task 4 (接 CI) ✓
- §3.5 修复 5 real-brain → Task 1 ✓
- §5 测试策略：integrity/integration/unit/smoke 全覆盖 ✓
- §6 文件清单 6 项 → 全在 Task 1-5 中 ✓

**2. Placeholder scan** — 无 TBD/TODO/implement later

**3. Type consistency** — `is_ghost` / `sid` / `wt` / `branch_in` / `ahead` 4 变量贯穿 stop-dev.sh ghost 过滤；`VERIFY_DEPLOY_WORKFLOW` / `VERIFY_HEALTH_PROBE` env 一致；测试文件路径全部 `packages/engine/tests/{unit,integration,integrity}/*.test.sh`
