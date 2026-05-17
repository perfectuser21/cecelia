# Stop Hook 7 阶段后续完善 — Design Spec

> 分支: cp-0504230106-stop-hook-7stage-followup
> 日期: 2026-05-04
> 前置 PR: #2766 (cp-0504214049-stop-hook-redesign-7stage) — verify_dev_complete P1-P7 已合
> 本 PR: 后续完善（plan Task 3/5/6）

## 1. 背景

PR #2766 把 verify_dev_complete 重写为 P1-P7 状态机，21 unit case 全过（P5/P6 默认 disabled 兼容）。但 plan 里留 3 个 task 未完成：

- **Task 3**：28 unit case 完整扩 P3/P5/P6 mock（需重写 stub 区分 `--json` 字段）
- **Task 5**：cleanup.sh 解耦 deploy-local.sh（fire-and-forget 不可观测，重复 brain-ci-deploy.yml）
- **Task 6**：integration test 真链路 + smoke 真起 Brain probe

本 PR 完成它们。无新功能、无新 env flag、不动 P1-P7 决策树。

## 2. 设计目标

| Task | 目标 | 验证 |
|---|---|---|
| 3 | 7 个新 unit case (C22-C28) 覆盖 P3/P5/P6 全分支 | 28/28 PASS |
| 5 | cleanup.sh 删 deploy-local.sh 调用块 + 注释说明 | bash -n + 跑 cleanup 不报错 |
| 6 | integration mock gh+curl 5 case + smoke 真 Brain probe | 5+8 PASS |

## 3. 架构

### 3.1 Task 3 — 新 stub 设计

现有 stub `case "$1 $2"` 不区分 `--json` 字段。新 stub 解析参数：

```bash
make_smart_gh_stub() {
    local stub_dir="$1"
    cat > "$stub_dir/gh" <<'STUB'
#!/usr/bin/env bash
# 解析参数找 --json 字段
json_field=""
workflow_filter=""
run_id=""
for ((i=1; i<=$#; i++)); do
    case "${!i}" in
        --json) json_field="${@:$((i+1)):1}" ;;
        --workflow) workflow_filter="${@:$((i+1)):1}" ;;
    esac
done
[[ "$1 $2" == "run view" ]] && run_id="$3"

cmd="$1 $2"
case "$cmd" in
    "pr list") cat "${STUB_PR_LIST:-/dev/null}" 2>/dev/null || echo "" ;;
    "pr view") cat "${STUB_PR_VIEW:-/dev/null}" 2>/dev/null || echo "" ;;
    "run list")
        if [[ "$workflow_filter" == "brain-ci-deploy.yml" ]]; then
            cat "${STUB_DEPLOY_RUN:-/dev/null}" 2>/dev/null || echo ""
        else
            case "$json_field" in
                status) cat "${STUB_CI_STATUS:-/dev/null}" 2>/dev/null || echo "" ;;
                conclusion) cat "${STUB_CI_CONCLUSION:-/dev/null}" 2>/dev/null || echo "" ;;
                databaseId) cat "${STUB_CI_RUN_ID:-/dev/null}" 2>/dev/null || echo "" ;;
                *) echo "" ;;
            esac
        fi
        ;;
    "run view")
        case "$json_field" in
            jobs) cat "${STUB_RUN_JOBS:-/dev/null}" 2>/dev/null || echo "" ;;
            status) cat "${STUB_DEPLOY_STATUS:-/dev/null}" 2>/dev/null || echo "" ;;
            conclusion) cat "${STUB_DEPLOY_CONCLUSION:-/dev/null}" 2>/dev/null || echo "" ;;
            *) echo "" ;;
        esac
        ;;
esac
exit 0
STUB
    chmod +x "$stub_dir/gh"
}

# curl mock
make_curl_mock() {
    local stub_dir="$1"
    cat > "$stub_dir/curl" <<'STUB'
#!/usr/bin/env bash
[[ "${HEALTH_PROBE_MOCK:-fail}" == "ok" ]] && echo '{"status":"ok"}' && exit 0
exit 22
STUB
    chmod +x "$stub_dir/curl"
}
```

新 case (22-28) 用 STUB_* env var 设置每个字段返回值，按 plan 测试 P3/P5/P6 各分支。现有 21 case **保持原 stub 不动**（验证后向兼容性）。

### 3.2 Task 5 — cleanup.sh 解耦

读 `packages/engine/skills/dev/scripts/cleanup.sh:285-310`，删除 `setsid bash deploy-local.sh ... &` 调用块（约 17 行），替换为：

```bash
echo ""
echo "[3] 部署解耦说明..."
echo "   ${GREEN}[OK] deploy 由 .github/workflows/brain-ci-deploy.yml 自动触发${NC}"
echo "        verify_dev_complete P5 监听 workflow conclusion"
```

### 3.3 Task 6 — integration + smoke

**integration**：`packages/engine/tests/integration/stop-hook-7stage-flow.test.sh`

5 case 用 §3.1 smart stub + curl mock：
1. P1→P0 全过 done
2. P3 CI failure → blocked + 含 'CI 失败'
3. P5 deploy in_progress → blocked + 含 'brain-ci-deploy'
4. P6 health timeout → blocked + 含 'health probe' + '超时'
5. P7 Learning 缺 → blocked + 含 'Learning 文件不存在'

每个 case 设 `VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1` 启用 P5/P6。

**smoke**：`packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh`（替换 PR #2766 的骨架 exit 1）

```bash
#!/usr/bin/env bash
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BRAIN_HEALTH_URL="${BRAIN_HEALTH_URL:-http://localhost:5221/api/brain/health}"

# 1. devloop-check.sh syntax + verify_dev_complete export
bash -n "$REPO_ROOT/packages/engine/lib/devloop-check.sh" && pass "Step 1: devloop-check.sh syntax OK" || fail "Step 1: syntax fail"

# 2. verify_dev_complete 函数存在
source "$REPO_ROOT/packages/engine/lib/devloop-check.sh"
type verify_dev_complete &>/dev/null && pass "Step 2: verify_dev_complete loaded" || fail "Step 2: not loaded"

# 3. P1 反馈（无 PR）
result=$(verify_dev_complete "smoke-test-branch-nonexistent" "/tmp/wt" "/tmp/main" 2>/dev/null || echo "")
echo "$result" | grep -q '"status":"blocked"' && pass "Step 3: P1 blocked OK" || fail "Step 3: 反馈异常 ($result)"

# 4. health endpoint 真探针（如本机 Brain 在跑）
if curl -fsS --max-time 3 "$BRAIN_HEALTH_URL" >/dev/null 2>&1; then
    pass "Step 4: 本机 Brain 健康（200 OK）"

    # 5. P6 真 health probe (max_retries=2 加速)
    HEALTH_PROBE_MAX_RETRIES=2 HEALTH_PROBE_INTERVAL=1 \
    BRAIN_HEALTH_URL="$BRAIN_HEALTH_URL" \
    VERIFY_HEALTH_PROBE=1 \
    result=$(verify_dev_complete "smoke-test-fake-branch" "/tmp/wt" "/tmp/main" 2>/dev/null || echo "")
    # 期望走 P1 (PR 不存在)，但 health probe 路径不抛 fatal
    echo "$result" | grep -q '"status":"blocked"' && pass "Step 5: P6 真链路不抛 fatal" || fail "Step 5: 异常 ($result)"
else
    echo "⚠️  本机 Brain 未起，跳过 Step 4-5（CI real-env-smoke job 会真起）"
    pass "Step 4: skip (Brain 未起)"
    pass "Step 5: skip (Brain 未起)"
fi

# 6. P6 dead URL 超时（必跑）
HEALTH_PROBE_MAX_RETRIES=2 HEALTH_PROBE_INTERVAL=0 \
BRAIN_HEALTH_URL="http://localhost:9999/dead" \
VERIFY_HEALTH_PROBE=1 \
result=$(verify_dev_complete "smoke-test-fake-branch-2" "/tmp/wt" "/tmp/main" 2>/dev/null || echo "")
echo "$result" | grep -q '"status":"blocked"' && pass "Step 6: P6 dead URL 不挂死" || fail "Step 6: 异常"

# 7. Env flag 默认 disabled 验证
result=$(VERIFY_HEALTH_PROBE=0 verify_dev_complete "smoke-test-fake-branch-3" "/tmp/wt" "/tmp/main" 2>/dev/null || echo "")
echo "$result" | grep -q '"status":"blocked"' && pass "Step 7: Env flag default disabled" || fail "Step 7: 异常"

# 8. 三态出口协议
echo "" | bash "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" >/dev/null 2>&1
exit_code=$?
[[ $exit_code -eq 0 ]] && pass "Step 8: stop-dev.sh exit 0 (.cecelia 不存在路径)" || fail "Step 8: exit=$exit_code"

echo ""
echo "=== stop-hook-7stage smoke: $PASS PASS / $FAIL FAIL ==="
[[ $FAIL -eq 0 ]] || exit 1
```

## 4. 错误处理

stub 限制：`STUB_*` env var 未设置时 cat /dev/null → 输出空。verify_dev_complete 在空输出时按 fallback 决策（P1 PR 未创建 / P2 unknown CI status / P5 deploy 未触发）— 这是预期行为。

## 5. 测试策略

按 Cecelia 测试金字塔：

| 测试类型 | 文件 | 覆盖 |
|---|---|---|
| **Unit** | `packages/engine/tests/unit/verify-dev-complete.test.sh` | 21 现有 + 7 新 = 28 case，P3/P5/P6 全分支 |
| **Integration** | `packages/engine/tests/integration/stop-hook-7stage-flow.test.sh`（新建） | 5 case mock gh+curl 验证状态机切换 |
| **Smoke** | `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh`（替换骨架） | 8 case 真起本机 Brain 跑 health probe |
| **Trivial** | cleanup.sh 改动是删 17 行 + 加注释 — bash -n 验证 + 跑一次看 exit 0 即可 | — |

不写新 E2E（PR #2766 已加场景 13/14/15 骨架，本 PR 不动 E2E）。

## 6. 关键文件清单

| 文件 | 改动 |
|---|---|
| `packages/engine/tests/unit/verify-dev-complete.test.sh` | 加 7 case (C22-C28) + smart stub helper |
| `packages/engine/skills/dev/scripts/cleanup.sh:285-310` | 删 deploy-local.sh 调用块 |
| `packages/engine/tests/integration/stop-hook-7stage-flow.test.sh` | 新建 5 case |
| `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh` | 替换 PR #2766 的骨架 exit 1 → 8 case 真链路 |
| 8 处版本文件 | bump 18.20.0 → 18.20.1 |

## 7. Out of Scope

- 不动 verify_dev_complete 决策树（PR #2766 已锁）
- 不动 stop-dev.sh / dev-mode-tool-guard.sh
- 不引入新 env flag
- 不做 E2E 场景实施（PR #2766 留的骨架）

## 8. 完成定义

- 28 unit case 全过
- 5 integration case 全过
- smoke 8 step 全过（本机 Brain 不通时 skip Step 4-5 仍 exit 0）
- cleanup.sh 跑无 deploy-local 残留 + bash -n OK
- engine 8 处版本 18.20.1
- Learning 含 ### 根本原因 + ### 下次预防
