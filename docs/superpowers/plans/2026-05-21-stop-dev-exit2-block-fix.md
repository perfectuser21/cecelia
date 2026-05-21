# Stop Hook exit 2 修复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `stop-dev.sh` 在 DECISION=block 时错误返回 exit 0（应为 exit 2），导致 Claude Code 无法 block 的 v24 回归 bug。

**Architecture:** 单文件修改。stop-dev.sh 末尾 if/else 块按 DECISION 分支发出正确 exit code：block→exit 2，release→exit 0。同时补一个集成测试验证 exit code 行为。

**Tech Stack:** bash, 现有集成测试框架（stop-dev-deploy-escape.test.sh 模式）

---

## 文件变更清单

- Modify: `packages/engine/hooks/stop-dev.sh`（第 198-206 行，末尾 if/else/exit 块）
- Create: `packages/engine/tests/integration/stop-dev-exit-code.test.sh`（新集成测试）

---

### Task 1：写失败测试 — 验证 exit code 行为

**Files:**
- Create: `packages/engine/tests/integration/stop-dev-exit-code.test.sh`

- [ ] **Step 1: 写失败测试文件**

```bash
cat > packages/engine/tests/integration/stop-dev-exit-code.test.sh << 'EOF'
#!/usr/bin/env bash
# stop-dev-exit-code.test.sh — 验证 stop-dev.sh 在 block/release 时的 exit code
# 修复 v24 回归：exit 0 被硬编码，block 时应为 exit 2
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STOP_HOOK="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

build_main() {
    local TMP=$(mktemp -d)
    (cd "$TMP" && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init)
    mkdir -p "$TMP/.cecelia/lights"
    echo "$TMP"
}

inject_classify_mock() {
    local repo="$1" status="$2"
    mkdir -p "$repo/packages/engine/lib"
    cat > "$repo/packages/engine/lib/devloop-check.sh" <<MOCK
#!/usr/bin/env bash
classify_session() { echo "{\"status\":\"${status}\",\"reason\":\"mock-${status}\",\"action\":\"mock action\"}"; return 0; }
log_hook_decision() { :; }
MOCK
}

SESSION="testsid1-full-uuid"
SID="${SESSION:0:8}"

# T-exit-block: block 路径必须 exit 2
TMP=$(build_main)
LIGHT="$TMP/.cecelia/lights/${SID}-cp-test.live"
echo "{\"session_id\":\"$SESSION\",\"branch\":\"cp-test\",\"guardian_pid\":99999}" > "$LIGHT"
inject_classify_mock "$TMP" "blocked"
CLAUDE_HOOK_CWD="$TMP" CLAUDE_HOOK_SESSION_ID="$SESSION" bash "$STOP_HOOK" </dev/null >/dev/null 2>&1
exit_code=$?
if [[ "$exit_code" == "2" ]]; then
    pass "T-exit-block: block 路径 exit code = 2"
else
    fail "T-exit-block: block 路径 exit code = $exit_code（期望 2）"
fi
rm -rf "$TMP"

# T-exit-release: release 路径必须 exit 0（无灯 → all_dark → release）
TMP=$(build_main)
CLAUDE_HOOK_CWD="$TMP" CLAUDE_HOOK_SESSION_ID="$SESSION" bash "$STOP_HOOK" </dev/null >/dev/null 2>&1
exit_code=$?
if [[ "$exit_code" == "0" ]]; then
    pass "T-exit-release: release 路径 exit code = 0"
else
    fail "T-exit-release: release 路径 exit code = $exit_code（期望 0）"
fi
rm -rf "$TMP"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
EOF
chmod +x packages/engine/tests/integration/stop-dev-exit-code.test.sh
```

- [ ] **Step 2: 运行测试，确认 T-exit-block 失败**

```bash
bash packages/engine/tests/integration/stop-dev-exit-code.test.sh
```

期望输出：
```
❌ T-exit-block: block 路径 exit code = 0（期望 2）
✅ T-exit-release: release 路径 exit code = 0
Results: 1 passed, 1 failed
```

- [ ] **Step 3: commit 失败测试**

```bash
git add packages/engine/tests/integration/stop-dev-exit-code.test.sh
git commit -m "test(engine): stop-dev-exit-code 失败测试 — block 时应 exit 2"
```

---

### Task 2：修复 stop-dev.sh exit code

**Files:**
- Modify: `packages/engine/hooks/stop-dev.sh`（第 198-206 行）

- [ ] **Step 1: 确认当前代码（定位目标行）**

```bash
tail -12 packages/engine/hooks/stop-dev.sh
```

期望看到：
```bash
if [[ "$DECISION" == "block" ]]; then
    jq -n --arg r "$BLOCK_REASON" '{"decision":"block","reason":$r}'
else
    echo "{\"reason_code\":\"${REASON_CODE:-release}\"}" >&2
fi

exit 0
```

- [ ] **Step 2: 应用修复**

编辑 `packages/engine/hooks/stop-dev.sh`，将末尾的 if/else/exit 块改为：

```bash
if [[ "$DECISION" == "block" ]]; then
    jq -n --arg r "$BLOCK_REASON" '{"decision":"block","reason":$r}'
    exit 2
else
    # release：stdout 不输出任何内容（Claude Code Stop hook schema 不接受 "release"）
    # 诊断信息写 stderr 供测试验证
    echo "{\"reason_code\":\"${REASON_CODE:-release}\"}" >&2
    exit 0
fi
```

删除 else 块后面的独立 `exit 0` 行（已移入 else 内）。

- [ ] **Step 3: 运行测试，确认全部通过**

```bash
bash packages/engine/tests/integration/stop-dev-exit-code.test.sh
```

期望输出：
```
✅ T-exit-block: block 路径 exit code = 2
✅ T-exit-release: release 路径 exit code = 0
Results: 2 passed, 0 failed
```

- [ ] **Step 4: 跑现有集成测试，确认无回归**

```bash
bash packages/engine/tests/integration/stop-dev-deploy-escape.test.sh
```

期望：所有 Case pass。

- [ ] **Step 5: 更新 stop-dev.sh 版本注释**

在 stop-dev.sh 头部注释区添加一行：
```bash
# v24.0.1 修复：block 路径改为 exit 2（v24.0.0 单一出口重构遗漏）
```

- [ ] **Step 6: commit 修复**

```bash
git add packages/engine/hooks/stop-dev.sh
git commit -m "fix(engine): stop-dev.sh block 路径改为 exit 2 — 修复 v24 回归导致 CI 等待 X0"
```

---

### Task 3：Engine 版本 bump + Learning

**Files:**
- Modify: `packages/engine/package.json`
- Modify: `packages/engine/package-lock.json`（通过 npm install 自动）
- Modify: `packages/engine/VERSION`
- Modify: `packages/engine/.hook-core-version`
- Modify: `packages/engine/regression-contract.yaml`
- Create: `docs/learnings/cp-0521130824-fix-stop-dev-exit2-block.md`

- [ ] **Step 1: 查当前版本**

```bash
cat packages/engine/VERSION
```

- [ ] **Step 2: bump patch 版本（5 文件）**

假设当前版本为 `X.Y.Z`，新版本为 `X.Y.(Z+1)`：

```bash
NEW_VER=$(cat packages/engine/VERSION | awk -F. '{print $1"."$2"."$3+1}')
echo "$NEW_VER" > packages/engine/VERSION
echo "$NEW_VER" > packages/engine/.hook-core-version

# package.json version 字段
sed -i '' "s/\"version\": \".*\"/\"version\": \"$NEW_VER\"/" packages/engine/package.json

# regression-contract.yaml engine_version 字段
sed -i '' "s/engine_version: .*/engine_version: \"$NEW_VER\"/" packages/engine/regression-contract.yaml

# package-lock.json（重新 install 更新）
cd packages/engine && npm install --package-lock-only 2>/dev/null; cd ../..
```

- [ ] **Step 3: 更新 feature-registry.yml**

在 `packages/engine/feature-registry.yml` 的 changelog 区添加条目：

```yaml
- version: X.Y.(Z+1)
  date: "2026-05-21"
  type: fix
  description: "stop-dev.sh block 路径改为 exit 2，修复 v24 回归导致 PR 提交后立即 X0"
```

然后运行 path views 生成：
```bash
bash packages/engine/scripts/generate-path-views.sh
```

- [ ] **Step 4: 写 Learning 文件**

```bash
cat > docs/learnings/cp-0521130824-fix-stop-dev-exit2-block.md << 'EOF'
# Learning: stop-dev.sh exit 2 修复

**分支**: cp-0521130824-fix-stop-dev-exit2-block  
**日期**: 2026-05-21

### 根本原因

v24 引入"单一出口纪律"重构，将所有散点 exit 收拢到文件末尾一个 `exit 0`。
该重构将 block 分支原有的 `exit 2` 也改成了 `exit 0`，
导致 stop.sh 路由永远 fall-through（case 0|99），
Claude Code 永远收不到 exit 2 的 block 信号，每次 stop hook 都放行。

**现象**：PR 提交后 CI 开始跑，stop hook 应 block 等 CI，但实际立即 X0 退出，用户必须手动等待。

### 下次预防

- [ ] 任何"单一出口重构"前，必须检查每个分支的 exit code 语义是否不同
- [ ] block/release 路径的 exit code 是 stop.sh 路由的唯一信号，修改时必须对照 stop.sh case 表
- [ ] 新增 `stop-dev-exit-code.test.sh` 集成测试防止同类回归
- [ ] 对比其他 hook（stop-architect.sh / stop-decomp.sh）确认一致性
EOF
```

- [ ] **Step 5: commit 版本 + Learning**

```bash
git add packages/engine/package.json packages/engine/package-lock.json \
    packages/engine/VERSION packages/engine/.hook-core-version \
    packages/engine/regression-contract.yaml \
    packages/engine/feature-registry.yml \
    docs/learnings/cp-0521130824-fix-stop-dev-exit2-block.md
git commit -m "[CONFIG] fix(engine): stop-dev exit 2 block fix — Engine v$(cat packages/engine/VERSION)"
```
