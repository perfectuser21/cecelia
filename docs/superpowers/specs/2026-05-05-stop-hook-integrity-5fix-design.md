# Stop Hook Integrity 5 修复 — Design Spec

> 分支: cp-0505101826-stop-hook-integrity-5fix
> 日期: 2026-05-05
> 前置 PR: #2766 (verify_dev_complete P1-P7) + #2767 (Task 3/5/6 后续)
> 本 PR: 第 11 段 — integrity 加固

## 1. 背景

PR #2766 + #2767 上线后自审发现 5 个虚假宣称：

1. **shell 测试是死代码**：32 unit + 5 integration + 8 smoke 全部不在 CI 跑（vitest 不识别 `.test.sh`，`.github/workflows/` 0 引用）— main 上有人改 verify_dev_complete / stop-dev.sh 不会被 CI 拦
2. **ghost 过滤缺失**：`stop-dev.sh` 取 `dev-active-*.json` 第一个就 break，远端 sync 来的 `session_id="unknown"` + 远端 worktree 路径 + 0 commit 的 ghost 持续 block stop hook（今晚发生 2 次）
3. **P5/P6 真链路 disabled**：`stop-dev.sh:76` 调 `verify_dev_complete` 没设 `VERIFY_DEPLOY_WORKFLOW=1` / `VERIFY_HEALTH_PROBE=1`，P5/P6 代码合到 main 但实战不启用
4. **无 integrity 元测试**：没有"测试有没有被测"的检查 — 任何 stop hook 测试被移出 CI 不会有人发现
5. **无 CI 合成场景**：没有起真 Brain → mock PR merged → stop-dev.sh 真跑 → 验 P5+P6+done 的端到端集成

## 2. 设计目标

```
[1] CI engine-tests-shell job → 跑所有 stop hook .test.sh + smoke.sh
[2] stop-dev.sh ghost 过滤 → 自动 rm session_id=unknown + worktree 不存在 + 0 commit 的 dev-active
[3] stop-dev.sh 启用 P5/P6 → 默认 export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1
[4] integrity 元测试 → grep CI workflow yaml 验证关键 .test.sh 被引用 + stop-dev.sh 调用真接通
[5] CI 合成场景 → real-env-smoke job 加 stop-hook-e2e-real-brain
```

## 3. 架构

### 3.1 修复 1 — engine-tests-shell CI job

`.github/workflows/ci.yml` 加新 job：

```yaml
engine-tests-shell:
  name: Engine Shell Tests (stop hook 套)
  runs-on: ubuntu-latest
  needs: [changes]
  if: needs.changes.outputs.engine == 'true' || github.ref == 'refs/heads/main'
  steps:
    - uses: actions/checkout@v4
    - name: Install jq + gh
      run: |
        sudo apt-get update -qq
        sudo apt-get install -y jq
        # gh 已预装 ubuntu-latest
    - name: Run unit tests
      run: |
        for t in packages/engine/tests/unit/*.test.sh; do
          echo "::group::$(basename $t)"
          bash "$t" || exit 1
          echo "::endgroup::"
        done
    - name: Run integration tests
      run: |
        for t in packages/engine/tests/integration/*.test.sh; do
          [[ -f "$t" ]] || continue
          echo "::group::$(basename $t)"
          bash "$t" || exit 1
          echo "::endgroup::"
        done
    - name: Run smoke (本地无 Brain，dead URL 路径必跑通)
      run: |
        for s in packages/engine/scripts/smoke/*-smoke.sh \
                 packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh; do
          [[ -f "$s" ]] || continue
          echo "::group::$(basename $s)"
          bash "$s" || exit 1
          echo "::endgroup::"
        done
```

加进 `ci-passed` job 的 `needs:` 列表 — 必跑且 required。

### 3.2 修复 2 — stop-dev.sh ghost 过滤

`packages/engine/hooks/stop-dev.sh:38-46` 现在的 for loop：
```bash
for _f in "$dev_state_dir"/dev-active-*.json; do
    [[ -f "$_f" ]] && { dev_state="$_f"; break; }
done
```

替换为：
```bash
for _f in "$dev_state_dir"/dev-active-*.json; do
    [[ -f "$_f" ]] || continue

    # ghost 过滤
    sid=$(jq -r '.session_id // ""' "$_f" 2>/dev/null)
    wt=$(jq -r '.worktree // ""' "$_f" 2>/dev/null)
    branch_in=$(jq -r '.branch // ""' "$_f" 2>/dev/null)

    is_ghost=0
    # ghost 特征 1：session_id="unknown"（远端 sync 来的）
    [[ "$sid" == "unknown" ]] && is_ghost=1
    # ghost 特征 2：worktree path 不存在 + 分支 0 commit ahead of main
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

行为：自动 rm ghost 文件 + 跳过；如果所有都是 ghost，dev_state="" → exit 0 普通对话。

### 3.3 修复 3 — stop-dev.sh 启用 P5/P6

`packages/engine/hooks/stop-dev.sh:76` 现在：
```bash
result=$(verify_dev_complete "$branch" "$worktree_path" "$main_repo" 2>/dev/null) || true
```

改为：
```bash
result=$(
    export VERIFY_DEPLOY_WORKFLOW=1
    export VERIFY_HEALTH_PROBE=1
    verify_dev_complete "$branch" "$worktree_path" "$main_repo" 2>/dev/null
) || true
```

后向兼容性：
- `BRAIN_HEALTH_URL` 默认 `http://localhost:5221/api/brain/health`，本机开发环境 Brain 未起 → P6 60×5s 超时 → block 反馈"health probe 超时" — 这正是想要的（强制 dev 环境也跑 Brain）
- 如果用户暂时不想跑 Brain → 设 `VERIFY_HEALTH_PROBE=0` env 在 shell 里 export，覆盖 stop-dev.sh 的默认（subshell `export` 覆盖被 caller env 覆盖，因为 stop-dev.sh 跑在子进程）

实际上 stop-dev.sh 是子进程，env 不被 caller env 覆盖。要让用户能 disable，加：
```bash
result=$(
    : "${VERIFY_DEPLOY_WORKFLOW:=1}"   # 默认 1，可被外部 export 0 覆盖
    : "${VERIFY_HEALTH_PROBE:=1}"
    export VERIFY_DEPLOY_WORKFLOW VERIFY_HEALTH_PROBE
    verify_dev_complete "$branch" "$worktree_path" "$main_repo" 2>/dev/null
) || true
```

`:=` 仅在变量未设时赋默认 — 给了 escape hatch。

### 3.4 修复 4 — integrity 元测试

新建 `packages/engine/tests/integrity/stop-hook-coverage.test.sh`：

```bash
#!/usr/bin/env bash
# stop-hook-coverage.test.sh — 元测试：stop hook 测试套有没有真被 CI 跑 + 配置真接通
set -uo pipefail
THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"

PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# === 1. 关键 .test.sh 在 CI workflow yaml 引用 ===
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

expect_in_ci 'verify-dev-complete\.test\.sh|tests/unit/\*\.test\.sh' "verify-dev-complete unit"
expect_in_ci 'stop-hook-7stage-flow|tests/integration/\*\.test\.sh' "stop-hook-7stage-flow integration"
expect_in_ci 'ralph-loop-mode|tests/integration/\*\.test\.sh' "ralph-loop-mode integration"
expect_in_ci 'dev-mode-tool-guard|tests/integration/\*\.test\.sh' "dev-mode-tool-guard integration"
expect_in_ci 'stop-hook-7stage-smoke|scripts/smoke/\*-smoke\.sh' "stop-hook-7stage-smoke"
expect_in_ci 'ralph-loop-smoke|scripts/smoke/\*-smoke\.sh' "ralph-loop-smoke"

# === 2. stop-dev.sh 调 verify_dev_complete ===
if grep -q 'verify_dev_complete' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 调用 verify_dev_complete"
else
    fail "stop-dev.sh 未调 verify_dev_complete"
fi

# === 3. stop-dev.sh 启用 P5/P6 ===
if grep -qE 'VERIFY_DEPLOY_WORKFLOW.*1|VERIFY_DEPLOY_WORKFLOW.*=1' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 启用 VERIFY_DEPLOY_WORKFLOW=1"
else
    fail "stop-dev.sh P5 disabled（功能死）"
fi
if grep -qE 'VERIFY_HEALTH_PROBE.*1|VERIFY_HEALTH_PROBE.*=1' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 启用 VERIFY_HEALTH_PROBE=1"
else
    fail "stop-dev.sh P6 disabled（功能死）"
fi

# === 4. stop-dev.sh ghost 过滤代码存在 ===
if grep -qE 'ghost|session_id.*unknown' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 含 ghost 过滤逻辑"
else
    fail "stop-dev.sh 无 ghost 过滤"
fi

# === 5. PreToolUse 拦截器配置存在（settings.json 不在 repo，跳过）===
if [[ -f "$REPO_ROOT/packages/engine/hooks/dev-mode-tool-guard.sh" ]]; then
    pass "dev-mode-tool-guard.sh 存在"
else
    fail "dev-mode-tool-guard.sh 缺失"
fi

echo ""
echo "=== integrity: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
```

接进修复 1 的 engine-tests-shell job，跟 unit/integration 一起跑。

### 3.5 修复 5 — CI 合成场景（real-env-smoke 扩展）

新建 `packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh`：

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

# 1. Brain 健康（前置条件）
if ! curl -fsS --max-time 5 "$BRAIN_URL" >/dev/null 2>&1; then
    echo "⚠️  Brain 未起，本测试需 docker compose Brain（real-env-smoke job 起）"
    exit 0  # CI 容错：本机无 Brain 时跳过
fi
pass "前置: Brain 健康"

# 2. mock dev-active + mock gh + mock learning + mock cleanup
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

# init git so worktree list 返第一行
(cd "$TMP_MAIN" && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init)
pass "mock 主仓库 + dev-active 就位"

# 3. mock gh 模拟 PR merged + deploy success
STUB=$(mktemp -d)
cat > "$STUB/gh" <<'STUB'
#!/usr/bin/env bash
json_field=""
for ((i=1; i<=$#; i++)); do
    [[ "${!i}" == "--json" ]] && json_field="${@:$((i+1)):1}"
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

# 4. 真跑 stop-dev.sh —— 含 P5 P6 真探针 Brain
export PATH="$STUB:$PATH"
export CLAUDE_HOOK_CWD="$TMP_MAIN"
output=$(bash "$TMP_MAIN/packages/engine/hooks/stop-dev.sh" 2>&1 || echo "EXIT=$?")
echo "stop-dev output: $output"

# 5. 验证 dev-active 被 rm（done 路径）
if [[ ! -f "$TMP_MAIN/.cecelia/dev-active-cp-test-real.json" ]]; then
    pass "done 路径 rm dev-active 成功（P5 P6 真链路通）"
else
    fail "dev-active 仍在（P5/P6 链路有断点）"
fi

# 清理
rm -rf "$TMP_MAIN" "$STUB"

echo ""
echo "=== stop-hook-e2e-real-brain: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
```

接 `.github/workflows/ci.yml` 的 `real-env-smoke` job（已起 docker compose Brain）。

## 4. 错误处理

- engine-tests-shell job：任一 .test.sh exit ≠ 0 → CI fail → block merge
- stop-dev.sh ghost 过滤：rm 失败时 set -uo pipefail 不退出（用 `rm -f`），continue 下一文件
- P5/P6 启用：`:=` 默认值给 escape hatch（外部 export 0 可禁用）
- integrity 元测试：fail 时报"哪个 .test.sh 没接 CI"
- real-brain 合成：Brain 未起时 exit 0（开发环境容错）

## 5. 测试策略

| 类型 | 文件 | 覆盖 |
|---|---|---|
| **Unit** | `tests/unit/verify-dev-complete.test.sh` 加 ghost 过滤 case | session_id=unknown + worktree 不存在 自动 rm |
| **Unit** | `tests/unit/stop-dev-ghost-filter.test.sh`（新建）| stop-dev.sh ghost 过滤纯函数测试 |
| **Integrity** | `tests/integrity/stop-hook-coverage.test.sh`（新建）| CI workflow 引用 + stop-dev.sh 配置接通 |
| **Integration** | `tests/integration/stop-hook-e2e-real-brain.test.sh`（新建）| 真 Brain + mock gh，全链路 done |
| **Trivial** | CI yaml diff（engine-tests-shell job） | bash -n + 1 次手跑通过即可 |

## 6. 关键文件清单

| 文件 | 改动 |
|---|---|
| `.github/workflows/ci.yml` | 加 engine-tests-shell job + ci-passed needs |
| `packages/engine/hooks/stop-dev.sh:38-46` | ghost 过滤逻辑 |
| `packages/engine/hooks/stop-dev.sh:76` | 启用 VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1 |
| `packages/engine/tests/unit/verify-dev-complete.test.sh` | 加 ghost 过滤 case 29-31 |
| `packages/engine/tests/unit/stop-dev-ghost-filter.test.sh` | 新建（stop-dev 直接测试）|
| `packages/engine/tests/integrity/stop-hook-coverage.test.sh` | 新建 |
| `packages/engine/tests/integration/stop-hook-e2e-real-brain.test.sh` | 新建 |
| 8 处版本文件 | 18.20.1 → 18.21.0 |

## 7. Out of Scope

- 不改 verify_dev_complete 决策树（PR #2766 已锁）
- 不改 PreToolUse 拦截器（拦更多 tool 留下个 PR）
- 不改 lint-test-pairing 逻辑（D 项调研验证粒度正常）

## 8. 完成定义

- engine-tests-shell job 跑通（unit + integration + smoke 全过）
- ci-passed 含 engine-tests-shell needs
- stop-dev.sh ghost 过滤 unit 3 case 通过
- integrity 元测试 7 case 全过
- real-brain 合成测试 5 PASS（Brain 健康场景）/ exit 0（无 Brain 容错）
- 8 处版本 18.21.0
- Learning 含 ### 根本原因 + ### 下次预防
