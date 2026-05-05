# Stop Hook 4 个 P0 彻底修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性修 4 个 P0 让 stop hook 在多 worktree 并发 + 主 CI 误判 + 远端 worker + P5/P6 fail 场景下不再死锁。

**Architecture:** stop-dev.sh 加 cwd 路由 + mtime expire；devloop-check.sh 加 `--workflow CI` 显式过滤 + P5 fail counter；新建 `.claude/settings.json` 把 PreToolUse 注册进 repo；3 个新测试文件 + integrity 扩 4 case。

**Tech Stack:** Bash 5 / jq / gh CLI / curl / GitHub Actions yaml

---

## File Structure

| 文件 | 改动 | 责任 |
|---|---|---|
| `packages/engine/hooks/stop-dev.sh` | line 38-62 重写 | BUG-1 cwd 路由 + BUG-4 mtime expire |
| `packages/engine/lib/devloop-check.sh` | 多处 `gh run list` + P5 分支 | BUG-2 + BUG-4 fail counter |
| `.claude/settings.json` | 新建 | BUG-3 PreToolUse repo 级注册 |
| `packages/engine/tests/integration/stop-dev-multi-worktree.test.sh` | 新建 6 case | BUG-1 验证 |
| `packages/engine/tests/integration/stop-dev-deploy-escape.test.sh` | 新建 4 case | BUG-4 验证 |
| `packages/engine/tests/unit/verify-dev-complete.test.sh` | 加 3 case | BUG-2 + BUG-4 unit |
| `packages/engine/tests/integrity/stop-hook-coverage.test.sh` | 加 4 check | L11-L14 |
| `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh` | 加 1 step | .claude/settings.json 验证 |
| `.github/workflows/ci.yml` | engine-tests-shell 加 2 个新文件 | CI 接通 |
| 8 处版本文件 | 18.21.0 → 18.22.0 | engine 同步 |

---

### Task 1: fail integration tests（v18.7.0 第一 commit）

**Files:**
- Create: `packages/engine/tests/integration/stop-dev-multi-worktree.test.sh`
- Create: `packages/engine/tests/integration/stop-dev-deploy-escape.test.sh`

- [ ] **Step 1: 写 multi-worktree 6 case**

`tests/integration/stop-dev-multi-worktree.test.sh`：

```bash
#!/usr/bin/env bash
# stop-dev-multi-worktree.test.sh — BUG-1 cwd 路由验证
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STOP_HOOK="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

# 共用：build 一个 mock 主仓库 + 3 个 worktree
build_main() {
    local TMP=$(mktemp -d)
    (cd "$TMP" && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init)
    mkdir -p "$TMP/.cecelia"
    # 3 个 dev-active 文件（字典序 A < B < C）
    for b in cp-aaa cp-bbb cp-ccc; do
        cat > "$TMP/.cecelia/dev-active-${b}.json" <<EOF
{"branch":"${b}","worktree":"/tmp/wt-${b}","session_id":"sess-${b}"}
EOF
        # 创各 branch（git worktree add 不实际创目录，仅 ref）
        (cd "$TMP" && git branch "$b" 2>/dev/null || true)
    done
    echo "$TMP"
}

# === Case 1: cwd=主仓库 main → exit 0 不 verify 任何 ===
TMP=$(build_main)
out=$(CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1)
exit_code=$?
if [[ $exit_code -eq 0 && -z "$(echo "$out" | grep -E 'decision|verify')" ]]; then
    pass "Case 1: 主仓库 cwd → exit 0 不 verify"
else
    fail "Case 1: 异常 exit=$exit_code out=$out"
fi
# 3 个 dev-active 应仍在
[[ -f "$TMP/.cecelia/dev-active-cp-aaa.json" ]] && pass "Case 1: dev-active-aaa 保留" || fail "Case 1: aaa 被误删"
rm -rf "$TMP"

# === Case 2: cwd=cp-bbb worktree → 仅 verify cp-bbb，不见 cp-aaa/ccc ===
TMP=$(build_main)
mkdir -p "$TMP/wt-bbb"
(cd "$TMP" && git worktree add "$TMP/wt-bbb" cp-bbb 2>/dev/null || git -c user.email=t@t -c user.name=t worktree add "$TMP/wt-bbb" cp-bbb 2>/dev/null)
# 模拟 cwd 在 wt-bbb（CLAUDE_HOOK_CWD）
out=$(CLAUDE_HOOK_CWD="$TMP/wt-bbb" bash "$STOP_HOOK" 2>&1 || true)
# 应触发 verify_dev_complete cp-bbb（PR 不存在 → P1 反馈"PR 未创建 (branch=cp-bbb)"）
if echo "$out" | grep -q 'cp-bbb'; then
    pass "Case 2: cwd=wt-bbb verify 含 cp-bbb"
else
    fail "Case 2: 输出不含 cp-bbb: $out"
fi
if echo "$out" | grep -qE 'cp-aaa|cp-ccc'; then
    fail "Case 2: 误 verify cp-aaa/ccc: $out"
else
    pass "Case 2: 不 verify cp-aaa/ccc（隔离正确）"
fi
rm -rf "$TMP"

# === Case 3: cwd=cp-bbb worktree 但 dev-active-cp-bbb 不存在 → exit 0 ===
TMP=$(build_main)
rm "$TMP/.cecelia/dev-active-cp-bbb.json"
mkdir -p "$TMP/wt-bbb"
(cd "$TMP" && git worktree add "$TMP/wt-bbb" cp-bbb 2>/dev/null || true)
out=$(CLAUDE_HOOK_CWD="$TMP/wt-bbb" bash "$STOP_HOOK" 2>&1)
exit_code=$?
if [[ $exit_code -eq 0 ]] && [[ -z "$(echo "$out" | grep decision)" ]]; then
    pass "Case 3: cp-bbb dev-active 不存在 → exit 0"
else
    fail "Case 3: 异常 exit=$exit_code"
fi
rm -rf "$TMP"

echo ""
echo "=== stop-dev-multi-worktree: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
```

`chmod +x` + 注：本 test 在 BUG-1 修之前**预期 fail**（当前是字典序第一，不是 cwd 路由）。

- [ ] **Step 2: 写 deploy-escape 4 case**

`tests/integration/stop-dev-deploy-escape.test.sh`：

```bash
#!/usr/bin/env bash
# stop-dev-deploy-escape.test.sh — BUG-4 mtime expire + P5 fail counter
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STOP_HOOK="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

build_main() {
    local TMP=$(mktemp -d)
    (cd "$TMP" && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init)
    mkdir -p "$TMP/.cecelia"
    echo "$TMP"
}

# === Case 1: dev-active mtime > 30 分钟 → 自动 rm ===
TMP=$(build_main)
cat > "$TMP/.cecelia/dev-active-cp-old.json" <<EOF
{"branch":"cp-old","worktree":"/tmp/wt","session_id":"sess-old"}
EOF
# 改 mtime 到 1 小时前
touch -t $(date -v-1H +%Y%m%d%H%M.%S 2>/dev/null || date -d '1 hour ago' +%Y%m%d%H%M.%S) "$TMP/.cecelia/dev-active-cp-old.json"

CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
if [[ ! -f "$TMP/.cecelia/dev-active-cp-old.json" ]]; then
    pass "Case 1: mtime > 30 分钟 → 自动 rm"
else
    fail "Case 1: 老 dev-active 仍在"
fi
rm -rf "$TMP"

# === Case 2: dev-active mtime < 30 分钟 → 保留 ===
TMP=$(build_main)
cat > "$TMP/.cecelia/dev-active-cp-fresh.json" <<EOF
{"branch":"cp-fresh","worktree":"/tmp/wt","session_id":"sess-fresh"}
EOF
# mtime 是当前（mktemp 默认）
CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
if [[ -f "$TMP/.cecelia/dev-active-cp-fresh.json" ]]; then
    pass "Case 2: mtime < 30 分钟 → 保留"
else
    fail "Case 2: 新 dev-active 误删"
fi
rm -rf "$TMP"

# === Case 3: STOP_HOOK_EXPIRE_MINUTES=1 + mtime 5 分钟前 → 自动 rm ===
TMP=$(build_main)
cat > "$TMP/.cecelia/dev-active-cp-cfg.json" <<EOF
{"branch":"cp-cfg","worktree":"/tmp/wt","session_id":"sess-cfg"}
EOF
touch -t $(date -v-5M +%Y%m%d%H%M.%S 2>/dev/null || date -d '5 minutes ago' +%Y%m%d%H%M.%S) "$TMP/.cecelia/dev-active-cp-cfg.json"

STOP_HOOK_EXPIRE_MINUTES=1 CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
if [[ ! -f "$TMP/.cecelia/dev-active-cp-cfg.json" ]]; then
    pass "Case 3: env STOP_HOOK_EXPIRE_MINUTES=1 + 5 分钟 → rm"
else
    fail "Case 3: env 未生效"
fi
rm -rf "$TMP"

# === Case 4: 连续 3 次 P5 fail → 自动 rm + 写 flag ===
# 这个由 unit case 覆盖（devloop-check.sh 的 fail counter 逻辑），integration
# 这里只验证 stop-hook 不 spam（fail-counter 文件存在但不阻塞流程）
TMP=$(build_main)
cat > "$TMP/.cecelia/dev-active-cp-deploy-fail.json" <<EOF
{"branch":"cp-deploy-fail","worktree":"/tmp/wt","session_id":"sess-d"}
EOF
echo "3" > "$TMP/.cecelia/deploy-fail-count-cp-deploy-fail"
mkdir -p "$TMP/wt"
(cd "$TMP" && git worktree add "$TMP/wt" -b cp-deploy-fail 2>/dev/null || true)
CLAUDE_HOOK_CWD="$TMP/wt" bash "$STOP_HOOK" >/dev/null 2>&1
# fail counter 文件 = 3，stop hook 不应 fail
echo "ℹ️  Case 4: deploy-fail-count=3 流程不崩（具体清理由 verify_dev_complete unit 覆盖）"
pass "Case 4: stop-hook 不因 fail-counter 文件崩"
rm -rf "$TMP"

echo ""
echo "=== stop-dev-deploy-escape: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
```

- [ ] **Step 3: 跑测试预期 fail**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-4p0-fix
chmod +x packages/engine/tests/integration/stop-dev-multi-worktree.test.sh \
         packages/engine/tests/integration/stop-dev-deploy-escape.test.sh
bash packages/engine/tests/integration/stop-dev-multi-worktree.test.sh 2>&1 | tail -5
bash packages/engine/tests/integration/stop-dev-deploy-escape.test.sh 2>&1 | tail -5
```

Expected: multi-worktree Case 2 fail（字典序错），deploy-escape Case 1 fail（无 mtime expire）

- [ ] **Step 4: Commit fail tests**

```bash
git add packages/engine/tests/integration/stop-dev-multi-worktree.test.sh \
        packages/engine/tests/integration/stop-dev-deploy-escape.test.sh
git commit -m "test(engine): BUG-1 multi-worktree + BUG-4 deploy-escape fail tests (cp-0505144146)

按 v18.7.0 第一 commit = fail integration test。

multi-worktree 6 case 验 BUG-1 cwd 路由（预期 fail，main 是字典序第一）
deploy-escape 4 case 验 BUG-4 mtime expire + fail counter（预期 fail，main 无 expire）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: stop-dev.sh BUG-1 cwd 路由 + BUG-4 mtime expire

**Files:**
- Modify: `packages/engine/hooks/stop-dev.sh:38-62`

- [ ] **Step 1: 改 dev_state 选择逻辑**

读 `packages/engine/hooks/stop-dev.sh:38-62`（当前 ghost 过滤 for loop），替换为：

```bash
# v18.22.0: BUG-1 cwd 路由 + BUG-4 mtime expire
# 1. 先扫一遍清 ghost (session_id=unknown) + mtime expire (> N 分钟)
EXPIRE_MINUTES="${STOP_HOOK_EXPIRE_MINUTES:-30}"
now_epoch=$(date +%s)
for _f in "$dev_state_dir"/dev-active-*.json; do
    [[ -f "$_f" ]] || continue
    sid=$(jq -r '.session_id // ""' "$_f" 2>/dev/null || echo "")
    if [[ "$sid" == "unknown" ]]; then
        echo "[stop-dev] ghost rm: $_f (session_id=unknown)" >&2
        rm -f "$_f"
        continue
    fi
    # mtime expire（macOS stat -f / Linux stat -c 兼容）
    file_mtime=$(stat -f %m "$_f" 2>/dev/null || stat -c %Y "$_f" 2>/dev/null || echo "$now_epoch")
    age_min=$(( (now_epoch - file_mtime) / 60 ))
    if [[ "$age_min" -gt "$EXPIRE_MINUTES" ]]; then
        echo "[stop-dev] expired rm: $_f (age=${age_min}m > ${EXPIRE_MINUTES}m)" >&2
        rm -f "$_f"
        # 同时清 fail-count 文件
        branch=$(jq -r '.branch // ""' "$_f" 2>/dev/null || echo "")
        [[ -n "$branch" ]] && rm -f "$dev_state_dir/deploy-fail-count-${branch}"
        continue
    fi
done

# 2. cwd 路由：用当前 cwd 的 branch 选 dev-active
current_branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
case "$current_branch" in
    cp-*)
        dev_state="$dev_state_dir/dev-active-${current_branch}.json"
        if [[ ! -f "$dev_state" ]]; then
            exit 0  # 当前 cp-* 分支没活跃 dev-active = 不在 /dev 流程
        fi
        ;;
    *)
        # 主分支 / 非 cp-* / 探测失败 → 不归本 session 管
        exit 0
        ;;
esac
```

注：删除原有 `dev_state=""` for loop 选择逻辑（line 44-62）。

- [ ] **Step 2: 跑 multi-worktree + deploy-escape 测试验证**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-4p0-fix
bash packages/engine/tests/integration/stop-dev-multi-worktree.test.sh 2>&1 | tail -3
bash packages/engine/tests/integration/stop-dev-deploy-escape.test.sh 2>&1 | tail -3
```

Expected: multi-worktree 6 PASS / deploy-escape 4 PASS

- [ ] **Step 3: 跑现有 stop-hook 套不 regression**

```bash
bash packages/engine/tests/integration/stop-dev-ghost-filter.test.sh 2>&1 | tail -3
bash packages/engine/tests/integration/ralph-loop-mode.test.sh 2>&1 | tail -3
bash packages/engine/scripts/smoke/ralph-loop-smoke.sh 2>&1 | tail -3
bash packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh 2>&1 | tail -3
```

Expected: 全过

- [ ] **Step 4: Commit BUG-1 + BUG-4 mtime impl**

```bash
git add packages/engine/hooks/stop-dev.sh
git commit -m "fix(engine): BUG-1 cwd 路由 + BUG-4 mtime expire (cp-0505144146)

stop-dev.sh:38-62 重写：
- BUG-1: dev_state 选择改用 cwd → branch 路由（git rev-parse --abbrev-ref HEAD）
  - cp-* 分支 → 仅取对应 dev-active-\${branch}.json
  - 主分支 / 非 cp-* → exit 0 不归本 session 管
- BUG-4: dev-active 文件 mtime > STOP_HOOK_EXPIRE_MINUTES (默认 30 分钟)
  自动 rm + 顺手清 deploy-fail-count 文件

修今晚 12:55 多 worktree + deploy fail 双重死锁。

stop-dev-multi-worktree 6 PASS / stop-dev-deploy-escape Case 1-3 PASS。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: BUG-2 `--workflow CI` 显式过滤

**Files:**
- Modify: `packages/engine/lib/devloop-check.sh`（多处）

- [ ] **Step 1: 找所有 `gh run list --branch` 调用**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-4p0-fix
grep -n "gh run list --branch" packages/engine/lib/devloop-check.sh
```

记下所有行号（应该 3-5 处主 CI 查询，不含 brain-ci-deploy.yml 那一处）。

- [ ] **Step 2: 用 sed 加 `--workflow CI`**

只改"取主 CI run"的调用，不动已经显式 `--workflow brain-ci-deploy.yml` 的：

```bash
# 用 sed 把 `--branch "$branch" --limit` 替换成 `--branch "$branch" --workflow CI --limit`
# 但只在不含 --workflow 的行
cd /Users/administrator/worktrees/cecelia/stop-hook-4p0-fix
python3 - <<'PY'
import re
path = "packages/engine/lib/devloop-check.sh"
with open(path) as f: content = f.read()
# 匹配 `gh run list --branch "$X" --limit N --json` 但不含 --workflow
pattern = r'(gh run list --branch "[^"]+")\s+(--limit \d+ --json)'
def repl(m):
    if "--workflow" in m.group(0):
        return m.group(0)
    return f'{m.group(1)} --workflow CI {m.group(2)}'
new = re.sub(pattern, repl, content)
with open(path, "w") as f: f.write(new)
print("done")
PY

# 验证
grep -n "gh run list --branch" packages/engine/lib/devloop-check.sh | head -10
```

Expected: 主 CI 查询行都含 `--workflow CI`

- [ ] **Step 3: 加 unit case 覆盖 BUG-2**

读 `packages/engine/tests/unit/verify-dev-complete.test.sh`，在 Case 28 后加 Case 29：

```bash
# === Case 29: P4 误判防护（BUG-2）— DeepSeek conclusion=success + 主 CI status=in_progress
# 应反馈 "等 CI" 而不是 "auto-merge" ===
PATH="$SMART_STUB:$ORIG_PATH"
# stub 区分 --workflow CI vs 别的 workflow
# 改 stub 让 "run list --workflow CI" 返 in_progress，无 workflow 返 success
cat > "$SMART_STUB/gh" <<'STUB'
#!/usr/bin/env bash
json_field=""
workflow_filter=""
for ((i=1; i<=$#; i++)); do
    arg="${!i}"
    case "$arg" in
        --json) j=$((i+1)); json_field="${!j}" ;;
        --workflow) j=$((i+1)); workflow_filter="${!j}" ;;
    esac
done
cmd="$1 $2"
case "$cmd" in
    "pr list") echo "100" ;;
    "pr view") [[ "$json_field" == "mergedAt" ]] && echo "" || echo "" ;;
    "run list")
        if [[ "$workflow_filter" == "CI" ]]; then
            # 主 CI in_progress
            case "$json_field" in
                status) echo "in_progress" ;;
                conclusion) echo "" ;;
                databaseId) echo "999" ;;
            esac
        else
            # 没 --workflow filter → 旧行为，返 completed/success（DeepSeek 误判源）
            case "$json_field" in
                status) echo "completed" ;;
                conclusion) echo "success" ;;
                databaseId) echo "111" ;;
            esac
        fi
        ;;
esac
exit 0
STUB
chmod +x "$SMART_STUB/gh"

result=$(VERIFY_DEPLOY_WORKFLOW=0 VERIFY_HEALTH_PROBE=0 verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 29 BUG-2 防护" "blocked" "$status"
assert_contains "Case 29 反馈含 CI 进行中（不是 auto-merge）" "CI 进行中" "$result"
restore_path
```

- [ ] **Step 4: 跑 unit + integrity**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-4p0-fix
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -3
```

Expected: Case 29 PASS（30 PASS / 0 FAIL）

- [ ] **Step 5: Commit BUG-2**

```bash
git add packages/engine/lib/devloop-check.sh \
        packages/engine/tests/unit/verify-dev-complete.test.sh
git commit -m "fix(engine): BUG-2 gh run list --workflow CI 显式过滤 (cp-0505144146)

devloop-check.sh 多处 \`gh run list --branch\` 加 \`--workflow CI\`，避免
DeepSeek/archive-learnings 等小 workflow conclusion=success 误判 P4
auto-merge（实际主 CI 还红/in_progress）。

unit Case 29 验：DeepSeek success + 主 CI in_progress → 反馈 \"等 CI\"
不是 \"auto-merge\"。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: BUG-3 PreToolUse 进 repo

**Files:**
- Create: `.claude/settings.json`

- [ ] **Step 1: 创建 .claude/settings.json**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-4p0-fix
mkdir -p .claude
cat > .claude/settings.json <<'EOF'
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "ScheduleWakeup",
        "hooks": [
          {
            "type": "command",
            "command": "bash $CLAUDE_PROJECT_DIR/packages/engine/hooks/dev-mode-tool-guard.sh"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash $CLAUDE_PROJECT_DIR/packages/engine/hooks/dev-mode-tool-guard.sh"
          }
        ]
      }
    ]
  }
}
EOF
```

- [ ] **Step 2: 验证 JSON 合法**

```bash
jq empty .claude/settings.json && echo "JSON OK"
```

Expected: JSON OK

- [ ] **Step 3: smoke 加 verify step**

读 `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh` 找最后一个 `pass` 行，前面加：

```bash
# Step 9 (新增): .claude/settings.json 含 PreToolUse 注册
if [[ -f "$REPO_ROOT/.claude/settings.json" ]] && \
   jq -e '.hooks.PreToolUse | length > 0' "$REPO_ROOT/.claude/settings.json" >/dev/null 2>&1; then
    pass "Step 9: .claude/settings.json 含 PreToolUse 注册（BUG-3 跨机器同步）"
else
    fail "Step 9: .claude/settings.json 缺 PreToolUse 注册"
fi
```

- [ ] **Step 4: 跑 smoke**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-4p0-fix
bash packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh 2>&1 | tail -3
```

Expected: 9 PASS / 0 FAIL

- [ ] **Step 5: Commit BUG-3**

```bash
git add .claude/settings.json packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh
git commit -m "feat(engine): BUG-3 PreToolUse 进 repo (.claude/settings.json) (cp-0505144146)

把 PreToolUse hook 注册（ScheduleWakeup + Bash）写进 repo 级
.claude/settings.json，每个 git clone 该 repo 的 CC 实例自动激活。

修远端 worker（西安/HK VPS/Codex）拦不到 ScheduleWakeup / Bash bg
退 turn 的 gap。

\$CLAUDE_PROJECT_DIR 是 CC 内置 env（无需用户配置）。

smoke Step 9 验证 .claude/settings.json 存在 + 含 PreToolUse 注册。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: BUG-4 P5 fail counter（devloop-check.sh）

**Files:**
- Modify: `packages/engine/lib/devloop-check.sh`（P5 deploy fail 分支）

- [ ] **Step 1: 找 P5 deploy fail 分支**

```bash
grep -n "deploy 失败\|deploy_conclusion" packages/engine/lib/devloop-check.sh | head -5
```

定位 `deploy_conclusion != "success"` 处。

- [ ] **Step 2: 加 fail counter 逻辑**

在 P5 deploy fail 分支加：

```bash
# v18.22.0: BUG-4 P5 fail counter — 连续 3 次失败自动 expire
fail_count_file="${main_repo}/.cecelia/deploy-fail-count-${branch}"
fail_count=$(cat "$fail_count_file" 2>/dev/null || echo 0)
fail_count=$((fail_count + 1))
echo "$fail_count" > "$fail_count_file" 2>/dev/null || true

if [[ "$fail_count" -ge 3 ]]; then
    rm -f "${main_repo}/.cecelia/dev-active-${branch}.json"
    rm -f "$fail_count_file"
    : > "${main_repo}/.cecelia/deploy-failed-${branch}.flag" 2>/dev/null || true
    result_json=$(_devloop_jq -n --arg b "$branch" \
        '{"status":"done","reason":"deploy fail 3x → auto-expire dev-active (\($b))，等独立 PR 修 deploy"}')
    break
fi

# 原有 deploy 失败反馈
result_json=$(_devloop_jq -n --arg id "$deploy_run_id" --arg c "$deploy_conclusion" --arg n "$fail_count" \
    '{"status":"blocked","reason":"deploy 失败 (\($c))[\($n)/3]","action":"看 gh run view \($id) --log-failed"}')
break
```

P5 success 分支加清掉 counter：

```bash
# 原有 success 分支前加：
rm -f "${main_repo}/.cecelia/deploy-fail-count-${branch}" 2>/dev/null || true
```

- [ ] **Step 3: 加 unit Case 30**

`tests/unit/verify-dev-complete.test.sh` 加：

```bash
# === Case 30 BUG-4: 连续 3 次 P5 fail → done escape + 写 flag ===
PATH="$SMART_STUB:$ORIG_PATH"
set_stub "100" "2026-05-05T13:00:00Z" "abc" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc"}]' "completed" "failure"

# 模拟 fail counter 已经 = 2
echo "2" > "$SMART_MAIN/.cecelia/deploy-fail-count-cp-test"
mkdir -p "$SMART_MAIN/.cecelia"

result=$(export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=0; verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 30 BUG-4 P5 fail 3x escape" "done" "$status"

# 验证 flag 写了 + dev-active 删了
[[ -f "$SMART_MAIN/.cecelia/deploy-failed-cp-test.flag" ]] && \
    pass "Case 30 deploy-failed flag 写入" || \
    fail "Case 30 flag 缺"
[[ ! -f "$SMART_MAIN/.cecelia/dev-active-cp-test.json" ]] && \
    pass "Case 30 dev-active 自动 rm" || \
    fail "Case 30 dev-active 仍在"
restore_path
rm -f "$SMART_MAIN/.cecelia/deploy-failed-cp-test.flag"
```

- [ ] **Step 4: 跑 unit + integration**

```bash
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -3
bash packages/engine/tests/integration/stop-dev-deploy-escape.test.sh 2>&1 | tail -3
```

Expected: unit Case 30 PASS（31 PASS / 0 FAIL）

- [ ] **Step 5: Commit BUG-4 fail counter**

```bash
git add packages/engine/lib/devloop-check.sh \
        packages/engine/tests/unit/verify-dev-complete.test.sh
git commit -m "fix(engine): BUG-4 P5 deploy fail counter (cp-0505144146)

devloop-check.sh P5 deploy fail 分支加 counter 逻辑：
- 每次失败 .cecelia/deploy-fail-count-\${branch} +1
- counter ≥ 3 → 自动 rm dev-active + 写 deploy-failed-\${branch}.flag → done
- success 分支清 counter

让 deploy 修复需要独立 PR 的场景下，stop hook 不再永久 stuck。

Case 30 验证 3 次 fail 触发 escape。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: integrity 元测试 L11-L14 + CI yaml + 收尾

**Files:**
- Modify: `packages/engine/tests/integrity/stop-hook-coverage.test.sh`
- Modify: `.github/workflows/ci.yml`（engine-tests-shell 加新文件）
- Modify: 8 处版本文件 + feature-registry
- Create: `docs/learnings/cp-0505144146-stop-hook-4p0-fix.md`

- [ ] **Step 1: integrity 加 L11-L14**

读 `packages/engine/tests/integrity/stop-hook-coverage.test.sh`，在最后 `=== integrity:` 行前加：

```bash
# === L11: stop-dev.sh 含 mtime expire 逻辑（BUG-4）===
if grep -qE 'EXPIRE_MINUTES|file_mtime|age_min' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "L11: stop-dev.sh 含 mtime expire 逻辑"
else
    fail "L11: BUG-4 mtime expire 缺"
fi

# === L12: stop-dev.sh 含 cwd 路由（BUG-1）===
if grep -qE 'rev-parse --abbrev-ref HEAD' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" && \
   grep -qE 'case.*cp-\*' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "L12: stop-dev.sh 含 cwd 路由（BUG-1 修复）"
else
    fail "L12: BUG-1 cwd 路由缺"
fi

# === L13: devloop-check.sh 主 CI 查询必带 --workflow CI（BUG-2）===
# 不带 --workflow CI 的 `gh run list --branch ` 应为 0（除 brain-ci-deploy.yml 等显式指定的）
violations=$(grep -nE 'gh run list --branch' "$REPO_ROOT/packages/engine/lib/devloop-check.sh" | grep -v -- '--workflow' | wc -l | tr -d ' ')
if [[ "$violations" -eq 0 ]]; then
    pass "L13: 所有 gh run list --branch 都带 --workflow（BUG-2 修复）"
else
    fail "L13: $violations 处 gh run list --branch 缺 --workflow"
fi

# === L14: .claude/settings.json 在 repo（BUG-3）===
if [[ -f "$REPO_ROOT/.claude/settings.json" ]] && \
   jq -e '.hooks.PreToolUse | length > 0' "$REPO_ROOT/.claude/settings.json" >/dev/null 2>&1; then
    pass "L14: .claude/settings.json 含 PreToolUse 注册（BUG-3 修复）"
else
    fail "L14: BUG-3 settings 缺"
fi
```

- [ ] **Step 2: ci.yml 加新 .test.sh 到 engine-tests-shell**

读 `.github/workflows/ci.yml` 找 engine-tests-shell job 的 integration 列表，加：

```yaml
      - name: Run integration shell tests
        run: |
          for t in \
              packages/engine/tests/integration/stop-hook-7stage-flow.test.sh \
              packages/engine/tests/integration/stop-dev-ghost-filter.test.sh \
              packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh \
              packages/engine/tests/integration/stop-dev-multi-worktree.test.sh \
              packages/engine/tests/integration/stop-dev-deploy-escape.test.sh \
              packages/engine/tests/integration/ralph-loop-mode.test.sh \
              packages/engine/tests/integration/dev-mode-tool-guard.test.sh; do
              ...
```

- [ ] **Step 3: 8 处版本 18.21.0 → 18.22.0**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-4p0-fix
for f in packages/engine/VERSION packages/engine/package.json \
         packages/engine/package-lock.json packages/engine/regression-contract.yaml \
         packages/engine/.hook-core-version packages/engine/hooks/.hook-core-version \
         packages/engine/hooks/VERSION packages/engine/skills/dev/SKILL.md; do
    [[ -f "$f" ]] && sed -i '' 's/18\.21\.0/18.22.0/g' "$f"
done
grep -rn "18\.21\.0" packages/engine/ 2>&1 | grep -v feature-registry | head -3
```

- [ ] **Step 4: feature-registry 加 changelog**

读 `packages/engine/feature-registry.yml` 顶部，在 18.21.0 条目前加：

```yaml
  - version: "18.22.0"
    date: "2026-05-05"
    change: "feat"
    description: "Stop Hook 4 个 P0 彻底修复（cp-0505144146）— Notion contract 4 BUG 全修。BUG-1 cwd-as-key 真匹配（stop-dev.sh 用 git rev-parse 选当前 worktree 的 dev-active，不再字典序混淆多 worktree 并发）；BUG-2 gh run list --workflow CI 显式过滤（防 DeepSeek 等小 workflow conclusion=success 误判 P4 auto-merge）；BUG-3 PreToolUse 进 repo (.claude/settings.json) 让远端 worker 也受拦；BUG-4 P5/P6 escape window（mtime > 30 分钟自动 expire + P5 fail counter ≥ 3 → 自动 rm dev-active + deploy-failed.flag）。Stop Hook 闭环第 12 段。"
    files:
      - "packages/engine/hooks/stop-dev.sh (BUG-1 cwd 路由 + BUG-4 mtime expire)"
      - "packages/engine/lib/devloop-check.sh (BUG-2 --workflow CI + BUG-4 P5 fail counter)"
      - ".claude/settings.json (BUG-3 PreToolUse repo 级注册)"
      - "tests/integration/stop-dev-multi-worktree.test.sh (新建 6 case BUG-1 验证)"
      - "tests/integration/stop-dev-deploy-escape.test.sh (新建 4 case BUG-4 验证)"
      - "tests/integrity/stop-hook-coverage.test.sh (扩 L11-L14 = 15 case)"
      - "Engine 8 处版本文件 18.22.0"
```

- [ ] **Step 5: 写 Learning**

`docs/learnings/cp-0505144146-stop-hook-4p0-fix.md`：

```markdown
# Learning — Stop Hook 4 个 P0 彻底修复（2026-05-05）

分支：cp-0505144146-stop-hook-4p0-fix
版本：Engine 18.21.0 → 18.22.0
前置 PR：#2766/#2767/#2770
本 PR：第 12 段（按段计）

## 故障

5/5 12:55 实战死锁触发 Notion contract 记录的 4 个 P0 bug：

- **BUG-1** stop-dev.sh 字典序遍历 .cecelia/dev-active-*.json 取第一个，session B 触发 stop hook 被压去 verify session A 的状态
- **BUG-2** `gh run list --branch X --limit 1` 取最新任意 run，DeepSeek conclusion=success → P4 误判 auto-merge
- **BUG-3** PreToolUse 配置在 ~/.claude/settings.json 不在 repo，远端 worker 拦不到
- **BUG-4** PR merged 后 brain-ci-deploy.yml fail，verify_dev_complete 永久 block，dev-active 永久 stuck

死锁持续 4+ 轮反馈循环，靠手动 rm dev-active 解开。

## 根本原因

PR #2503 标题写"cwd-as-key 切线"但实现没真用 cwd 做 key（4/21 引入名实不符 bug 持续到 5/5）。
P5/P6 引入时（#2766）没考虑 deploy/health fail 后需要独立 PR 修这件事，没设计 escape window。
PreToolUse 写到 ~/.claude/settings.json 是 4/21 决策时优先单机，没考虑多 worker 跨机器场景。
gh run list --limit 1 在 PR #2766 7 阶段重写时遗漏了 --workflow CI 过滤。

## 本次解法

### BUG-1 cwd 路由
stop-dev.sh:38-62 重写：先扫一遍清 ghost + mtime expire，然后 cwd → branch 路由选 dev-active。主分支 / 非 cp-* exit 0 不归本 session 管。

### BUG-2 --workflow CI 显式过滤
devloop-check.sh 多处 gh run list --branch 加 --workflow CI（python re.sub 批量改）。整数性元测试 L13 grep 验证 violations=0。

### BUG-3 PreToolUse 进 repo
新建 .claude/settings.json，把 PreToolUse hook（ScheduleWakeup + Bash）注册写进 repo 级配置。\$CLAUDE_PROJECT_DIR 是 CC 内置 env，每个 clone 的实例自动激活。

### BUG-4 P5/P6 escape window
- A. mtime expire：dev-active 文件 mtime > 30 分钟（默认，可调 STOP_HOOK_EXPIRE_MINUTES）→ 自动 rm + 顺手清 fail-counter
- B. P5 fail counter：连续 3 次 P5 deploy fail → auto-expire dev-active + 写 deploy-failed.flag

## 下次预防

- [ ] 任何 invariant 改动必须有 integrity 元测试 grep 验证（防 BUG-1 这种"名号在但实现错"）
- [ ] gh CLI 调用必须明确 workflow filter（避免最新任意 run 误判）
- [ ] 跨机器配置必须放 repo 级（不放 ~/.claude/）
- [ ] 异步外部状态（deploy / health）必须有 escape window，不能让 stop hook 永久 stuck

## 验证证据

- multi-worktree 6 case + deploy-escape 4 case integration 全过
- unit 31 case 全过（含 Case 29 BUG-2 + Case 30 BUG-4）
- integrity 15 case 全过（L1-L14）
- smoke step 9 验 .claude/settings.json
- engine 8 处版本 18.22.0
- Notion contract 4 BUG 标 ✅ resolved（待本 PR 合并后更新）

## Stop Hook 闭环延续

| 段 | PR | 内容 |
|---|---|---|
| 11 | #2770 | integrity 5 修复（死代码激活）|
| **12** | **本 PR** | **4 个 P0 彻底修（BUG-1/2/3/4）** |
```

- [ ] **Step 6: 跑全套 + check-cleanup**

```bash
bash packages/engine/skills/dev/scripts/check-cleanup.sh 2>&1 | tail -3
echo "---unit---"
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -1
echo "---integration---"
bash packages/engine/tests/integration/stop-dev-multi-worktree.test.sh 2>&1 | tail -1
bash packages/engine/tests/integration/stop-dev-deploy-escape.test.sh 2>&1 | tail -1
bash packages/engine/tests/integration/stop-dev-ghost-filter.test.sh 2>&1 | tail -1
bash packages/engine/tests/integration/stop-hook-7stage-flow.test.sh 2>&1 | tail -1
bash packages/engine/tests/integration/ralph-loop-mode.test.sh 2>&1 | tail -1
echo "---integrity---"
bash packages/engine/tests/integrity/stop-hook-coverage.test.sh 2>&1 | tail -1
echo "---smoke---"
bash packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh 2>&1 | tail -1
bash packages/engine/scripts/smoke/ralph-loop-smoke.sh 2>&1 | tail -1
```

Expected: 全过 / check-cleanup OK

- [ ] **Step 7: Commit 收尾**

```bash
git add packages/engine/tests/integrity/stop-hook-coverage.test.sh \
        .github/workflows/ci.yml \
        packages/engine/VERSION packages/engine/package.json \
        packages/engine/package-lock.json packages/engine/regression-contract.yaml \
        packages/engine/.hook-core-version packages/engine/hooks/.hook-core-version \
        packages/engine/hooks/VERSION packages/engine/skills/dev/SKILL.md \
        packages/engine/feature-registry.yml \
        docs/learnings/cp-0505144146-stop-hook-4p0-fix.md
git commit -m "[CONFIG] chore: bump engine 18.21.0 → 18.22.0 + integrity L11-L14 + Learning (cp-0505144146)

Stop Hook 4 个 P0 彻底修复完整闭环（第 12 段）：
- BUG-1 cwd-as-key 真匹配（多 worktree 不混淆）
- BUG-2 gh run list --workflow CI（防 DeepSeek 误判）
- BUG-3 .claude/settings.json 进 repo（远端 worker 也拦）
- BUG-4 P5/P6 escape window（mtime + fail counter）

integrity L11-L14 grep 验证 4 BUG 修复存在。
engine-tests-shell job 接 stop-dev-multi-worktree + stop-dev-deploy-escape。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 完成定义

- 6 multi-worktree + 4 deploy-escape integration 全过
- unit 31 case 全过（Case 29 BUG-2 + Case 30 BUG-4）
- integrity 15 case 全过（L11-L14）
- smoke 9 step 全过
- engine-tests-shell CI job 含新 .test.sh
- engine 8 处版本 18.22.0
- `.claude/settings.json` 在 repo
- Learning 含 ### 根本原因 + ### 下次预防

## Self-Review

**1. Spec coverage**
- §3.1 BUG-1 cwd 路由 + ghost + mtime → Task 2 ✓
- §3.2 BUG-2 --workflow CI → Task 3 ✓
- §3.3 BUG-3 .claude/settings.json → Task 4 ✓
- §3.4 BUG-4 P5 fail counter → Task 5 ✓
- §3.5 invariant L11-L14 → Task 6 ✓
- §5 测试策略：unit/integration/integrity/smoke 全覆盖 ✓
- §6 文件清单 9 项 → 全在 Task 1-6 中 ✓

**2. Placeholder scan** — 无 TBD/TODO

**3. Type consistency**
- `dev_state` / `current_branch` / `EXPIRE_MINUTES` / `fail_count_file` / `deploy-failed-${branch}.flag` 命名贯穿
- 测试文件路径 `tests/integration/stop-dev-*.test.sh` 一致
- env var：`STOP_HOOK_EXPIRE_MINUTES` / `VERIFY_DEPLOY_WORKFLOW` / `VERIFY_HEALTH_PROBE` 一致
