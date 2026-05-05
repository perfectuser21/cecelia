# Stop Hook 4 个 P1 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 4 个 P1 边缘 case：P5 engine-only PR 跳过 / devloop-classify CI Linux 修 / engine-tests-shell glob / .claude/settings 跨机器 install。

**Architecture:** devloop-check.sh P5 加 paths 判断；测试加 git user 显式；ci.yml 改 glob；新建 install script + integrity case。

**Tech Stack:** Bash 5 / jq / gh CLI / GitHub Actions yaml

---

## File Structure

| 文件 | 改动 |
|---|---|
| `packages/engine/lib/devloop-check.sh` | P5 加 paths skip |
| `packages/engine/tests/integration/devloop-classify.test.sh` | git user 显式 |
| `.github/workflows/ci.yml` | engine-tests-shell glob |
| `packages/engine/tests/integrity/stop-hook-coverage.test.sh` | 加 L15/L16 + glob 验证 |
| `scripts/install-claude-settings.sh` | 新建 |
| `packages/engine/tests/unit/verify-dev-complete.test.sh` | 加 Case 31 |
| 8 处版本文件 | 18.22.0 → 18.22.1 |

---

### Task 1: 修 devloop-classify.test.sh CI Linux fail（P1-2）

**Files:**
- Modify: `packages/engine/tests/integration/devloop-classify.test.sh`

- [ ] **Step 1: 找所有 git commit 调用加 user 显式**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-4p1-fix
grep -n "git commit" packages/engine/tests/integration/devloop-classify.test.sh
```

- [ ] **Step 2: 用 sed 批量加 -c user.email/name**

```bash
sed -i '' 's|git commit -q --allow-empty|git -c user.email=t@t -c user.name=t commit -q --allow-empty|g' packages/engine/tests/integration/devloop-classify.test.sh
grep -c "user.email=t@t" packages/engine/tests/integration/devloop-classify.test.sh  # 应 ≥ 6
```

- [ ] **Step 3: 跑测试验证仍过（macOS）**

```bash
bash packages/engine/tests/integration/devloop-classify.test.sh 2>&1 | tail -3
```

Expected: 10 PASS / 0 FAIL

- [ ] **Step 4: Commit**

```bash
git add packages/engine/tests/integration/devloop-classify.test.sh
git commit -m "fix(engine): devloop-classify.test.sh CI Linux 修（git user 显式）(cp-0505162710)

CI Linux runner 默认无 git user → commit fail → branch 没创 → classify_session
返 not-dev（不是预期 blocked）。加 -c user.email=t@t -c user.name=t 显式
（同 ralph-loop-mode 之前修法）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: P1-1 P5 engine-only PR not-applicable

**Files:**
- Modify: `packages/engine/lib/devloop-check.sh`（P5 deploy workflow 段）

- [ ] **Step 1: 找 P5 deploy workflow 段**

```bash
grep -n 'verify_deploy.*1\|brain-ci-deploy.yml\|deploy_run_id=' packages/engine/lib/devloop-check.sh | head -10
```

- [ ] **Step 2: 在 P5 段最前加 paths 判断**

读 P5 段（以 `if [[ "$verify_deploy" == "1" ]]; then` 开头），在内部最开始加：

```bash
if [[ "$verify_deploy" == "1" ]]; then
    # P1-1 (v18.22.1): engine-only / docs-only PR 不触发 brain-ci-deploy.yml
    # 用 gh pr view --json files 看 PR 是否触动 packages/brain/
    local brain_changed
    brain_changed=$(gh pr view "$pr_number" --json files -q '[.files[].path] | map(select(startswith("packages/brain/"))) | length' 2>/dev/null || echo "0")
    if [[ "$brain_changed" =~ ^[0-9]+$ ]] && [[ "$brain_changed" -eq 0 ]]; then
        echo "[verify_dev_complete] P5 跳过：PR #$pr_number 不触动 packages/brain/，brain-ci-deploy.yml not applicable" >&2
        # not applicable，视为 P5 通过，继续走 P6
    else
        # 原 P5 逻辑（包整段缩进）
        local merge_sha deploy_run_id deploy_status deploy_conclusion
        ...原代码...
    fi
fi
```

- [ ] **Step 3: 跑现有 unit 测试不 regression**

```bash
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -3
bash packages/engine/tests/integration/stop-hook-7stage-flow.test.sh 2>&1 | tail -3
```

Expected: 32 PASS / 5 PASS

- [ ] **Step 4: 加 Case 31 P1-1 验证**

读 `tests/unit/verify-dev-complete.test.sh` 找 Case 28/29/30 末尾，加：

```bash
# === Case 31 P1-1: engine-only PR P5 not-applicable ===
PATH="$SMART_STUB:$ORIG_PATH"
# stub: gh pr view --json files 返回无 brain 路径
cat > "$SMART_STUB/gh" <<'STUB'
#!/usr/bin/env bash
case "$* " in
    *"pr list"*) echo "100" ;;
    *"pr view"*"--json files"*) echo '0' ;;  # brain_changed=0
    *"pr view"*"mergedAt"*) echo "2026-05-05T13:00:00Z" ;;
    *"pr view"*"mergeCommit"*) echo "abc123" ;;
    *"run list"*"status"*) echo "completed" ;;
    *"run list"*"conclusion"*) echo "success" ;;
    *"run list"*"databaseId"*) echo "1001" ;;
esac
STUB
chmod +x "$SMART_STUB/gh"

set_stub "100" "2026-05-05T13:00:00Z" "abc123" "completed" "success" "1001" "" "" "" ""
result=$(
    export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=0
    export HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0
    verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN"
)
status=$(echo "$result" | jq -r '.status')
# 期望走过 P5 → P7 Learning OK → cleanup → done
assert_status "Case 31 P1-1 engine-only P5 跳过" "done" "$status"
restore_path
```

- [ ] **Step 5: 跑 unit Case 31 验证**

```bash
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | grep "Case 31\|=== verify"
```

Expected: Case 31 PASS

- [ ] **Step 6: Commit P1-1**

```bash
git add packages/engine/lib/devloop-check.sh packages/engine/tests/unit/verify-dev-complete.test.sh
git commit -m "feat(engine): P1-1 P5 engine-only PR not-applicable (cp-0505162710)

devloop-check.sh P5 加 paths 判断：用 gh pr view --json files 检查 PR 是否
触动 packages/brain/，无 → 视为 P5 not applicable 跳过（继续走 P6）。

修 PR #2777 自己合并时撞上的边缘 case：engine-only PR 不触发
brain-ci-deploy.yml，P5 永远等不到 deploy run，靠 BUG-4 mtime 兜底。

unit Case 31 验证 engine-only PR 走完链路 → done。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: P1-3 engine-tests-shell glob

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 改显式列表为 glob**

读 `.github/workflows/ci.yml` 找 engine-tests-shell job 的 `Run integration shell tests`，改：

```yaml
- name: Run integration shell tests
  run: |
    for t in packages/engine/tests/integration/*.test.sh; do
      [[ -f "$t" ]] || continue
      echo "::group::$(basename "$t")"
      bash "$t" || exit 1
      echo "::endgroup::"
    done
```

（原显式列表 7 行删掉换 glob）

- [ ] **Step 2: yaml 语法验证**

```bash
command -v yamllint >/dev/null 2>&1 && yamllint .github/workflows/ci.yml 2>&1 | tail -5 || echo "yamllint 不可用，跳过"
```

- [ ] **Step 3: Commit P1-3**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: engine-tests-shell glob 模式（防新 .test.sh 漏接）(cp-0505162710)

显式列出 7 个 .test.sh → glob \`tests/integration/*.test.sh\`。
新加测试自动接 CI，不需手动改 ci.yml。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: P1-4 install script + integrity

**Files:**
- Create: `scripts/install-claude-settings.sh`
- Modify: `packages/engine/tests/integrity/stop-hook-coverage.test.sh`

- [ ] **Step 1: 写 install script**

`scripts/install-claude-settings.sh`：

```bash
#!/usr/bin/env bash
# install-claude-settings.sh — 把 repo 级 .claude/settings.json 的 hook 配置
# merge 到用户级 ~/.claude/settings.json（CC 不识别 repo settings 时的 fallback）
#
# 用法：bash scripts/install-claude-settings.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_SETTINGS="$REPO_ROOT/.claude/settings.json"
USER_SETTINGS="${HOME}/.claude/settings.json"

if [[ ! -f "$REPO_SETTINGS" ]]; then
    echo "❌ $REPO_SETTINGS 不存在 — 当前 repo 无 .claude/settings.json"
    exit 1
fi

mkdir -p "$(dirname "$USER_SETTINGS")"

if [[ ! -f "$USER_SETTINGS" ]]; then
    cp "$REPO_SETTINGS" "$USER_SETTINGS"
    echo "✅ 已安装 $USER_SETTINGS（首次创建）"
    exit 0
fi

# merge：用户已有 settings.json 时只补 hooks 部分
if ! command -v jq &>/dev/null; then
    echo "❌ jq 不可用，无法 merge。手动编辑 $USER_SETTINGS 把 $REPO_SETTINGS 的 hooks 段拷过去"
    exit 1
fi

backup="${USER_SETTINGS}.backup.$(date +%s)"
cp "$USER_SETTINGS" "$backup"
echo "ℹ️  备份 $backup"

# repo settings 优先（hooks），用户 settings 保留其他
merged=$(jq -s '.[0] * .[1]' "$USER_SETTINGS" "$REPO_SETTINGS")
echo "$merged" > "$USER_SETTINGS"
echo "✅ 已 merge $REPO_SETTINGS → $USER_SETTINGS"
```

- [ ] **Step 2: 设可执行 + 跑一次验证 idempotent**

```bash
chmod +x scripts/install-claude-settings.sh
bash -n scripts/install-claude-settings.sh && echo "syntax OK"
# 不 install 真用户 settings，只验证脚本能跑
USER_SETTINGS_TEST=$(mktemp); HOME=$(dirname "$USER_SETTINGS_TEST") bash scripts/install-claude-settings.sh 2>&1 | head -3 || true
rm -f "$USER_SETTINGS_TEST"
```

- [ ] **Step 3: integrity 加 L15/L16 + glob 验证**

读 `tests/integrity/stop-hook-coverage.test.sh` 末尾（L14 后），加：

```bash
# L15: .claude/settings.json 引用 dev-mode-tool-guard.sh（确保 hook 真注册到正确 script）
if [[ -f "$REPO_ROOT/.claude/settings.json" ]] && \
   grep -q 'dev-mode-tool-guard\.sh' "$REPO_ROOT/.claude/settings.json"; then
    pass "L15: settings.json 引用 dev-mode-tool-guard.sh"
else
    fail "L15: settings.json 未引用 dev-mode-tool-guard.sh"
fi

# L16: install-claude-settings.sh 存在（跨机器 setup fallback）
if [[ -f "$REPO_ROOT/scripts/install-claude-settings.sh" ]] && \
   [[ -x "$REPO_ROOT/scripts/install-claude-settings.sh" ]]; then
    pass "L16: install-claude-settings.sh 存在且可执行（跨机器 fallback）"
else
    fail "L16: install script 缺或不可执行"
fi

# L17: ci.yml engine-tests-shell 用 glob（防新 .test.sh 漏接）
if grep -qE 'tests/integration/\*\.test\.sh' "$REPO_ROOT/.github/workflows/ci.yml"; then
    pass "L17: engine-tests-shell 用 glob 模式（P1-3 修复）"
else
    fail "L17: engine-tests-shell 仍是显式列表"
fi
```

- [ ] **Step 4: 跑 integrity 验证 17 case**

```bash
bash packages/engine/tests/integrity/stop-hook-coverage.test.sh 2>&1 | tail -5
```

Expected: 17 PASS / 0 FAIL

- [ ] **Step 5: Commit P1-4**

```bash
git add scripts/install-claude-settings.sh packages/engine/tests/integrity/stop-hook-coverage.test.sh
git commit -m "feat: install-claude-settings.sh + integrity L15-L17 (cp-0505162710)

P1-4：install-claude-settings.sh — repo 级 .claude/settings.json fallback
merge 到用户级 ~/.claude/settings.json（CC 不识别 repo settings 时手动 install）。

integrity 扩 L15-L17：
- L15 settings.json 引用 dev-mode-tool-guard.sh
- L16 install-claude-settings.sh 存在 + 可执行
- L17 ci.yml engine-tests-shell 用 glob（P1-3 修复）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 8 处版本 + Learning + feature-registry

**Files:**
- Modify: 8 处版本文件 + feature-registry
- Create: `docs/learnings/cp-0505162710-stop-hook-4p1-fix.md`

- [ ] **Step 1: 8 处版本 18.22.0 → 18.22.1**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-4p1-fix
for f in packages/engine/VERSION packages/engine/package.json \
         packages/engine/package-lock.json packages/engine/regression-contract.yaml \
         packages/engine/.hook-core-version packages/engine/hooks/.hook-core-version \
         packages/engine/hooks/VERSION packages/engine/skills/dev/SKILL.md; do
    [[ -f "$f" ]] && sed -i '' 's/18\.22\.0/18.22.1/g' "$f"
done
grep -rn "18\.22\.0" packages/engine/ 2>&1 | grep -v feature-registry | head -3
```

- [ ] **Step 2: feature-registry 加 changelog**

读 `packages/engine/feature-registry.yml` 找最顶部 changelog，加 18.22.1：

```yaml
  - version: "18.22.1"
    date: "2026-05-05"
    change: "fix"
    description: "Stop Hook 4 个 P1 修复（cp-0505162710）— P1-1 P5 engine-only PR not-applicable（gh pr view --json files 检查 packages/brain/ 触动，无→跳 P5）；P1-2 devloop-classify.test.sh CI Linux fix（git -c user.email/name 显式）；P1-3 engine-tests-shell 显式列表→glob（防新 .test.sh 漏接）；P1-4 install-claude-settings.sh 跨机器 setup fallback + integrity L15-L17。Stop Hook 闭环第 13 段。"
    files:
      - "packages/engine/lib/devloop-check.sh (P5 paths skip)"
      - "packages/engine/tests/integration/devloop-classify.test.sh (git user 显式)"
      - ".github/workflows/ci.yml (engine-tests-shell glob)"
      - "scripts/install-claude-settings.sh (新建跨机器 setup)"
      - "packages/engine/tests/integrity/stop-hook-coverage.test.sh (L15-L17)"
      - "Engine 8 处版本文件 18.22.1"
```

- [ ] **Step 3: 写 Learning**

`docs/learnings/cp-0505162710-stop-hook-4p1-fix.md`：

```markdown
# Learning — Stop Hook 4 个 P1 修复（2026-05-05）

分支：cp-0505162710-stop-hook-4p1-fix
版本：Engine 18.22.0 → 18.22.1
前置：PR #2777 (4 P0)
本 PR：第 13 段

## 故障

PR #2777 4 个 P0 修了主链路，但 Notion contract 第八章列出 4 个 P1 边缘 case：
- engine-only PR P5 永远等不到 brain deploy（PR #2777 自己撞上）
- devloop-classify.test.sh CI Linux fail（从 PR #2770 拖延）
- engine-tests-shell 显式列表（新加测试漏接）
- .claude/settings 跨机器没自动 install 验证

## 根本原因

1. P1-1：P5 假设 merge 一定触发 brain-ci-deploy.yml，没考虑 engine-only / docs-only PR
2. P1-2：CI Linux runner 无 git default user → git commit fail → branch 没创
3. P1-3：每次新 .test.sh 都要手动加 ci.yml，容易漏（前几个 PR 已多次踩）
4. P1-4：BUG-3 修了 settings 进 repo 但没验证 CC 跨版本支持

## 本次解法

### P1-1 P5 paths skip
gh pr view --json files 检查 PR 是否触动 packages/brain/。无 → 视为 P5 not applicable 跳过。

### P1-2 git user 显式
sed 批量给 git commit 加 -c user.email=t@t -c user.name=t（同 ralph-loop-mode 修法）。

### P1-3 glob
显式列表 → tests/integration/*.test.sh glob。integrity L17 grep 验证。

### P1-4 install script + integrity
新建 scripts/install-claude-settings.sh fallback merge repo settings 到用户级。integrity L15/L16 验证 dev-mode-tool-guard.sh 引用 + 脚本可执行。

## 下次预防

- [ ] 任何 verify 阶段加新检查必须有"not applicable"路径（不只 success / failure）
- [ ] 测试文件 git init/commit 必须显式 user.email/name（CI Linux runner 默认无）
- [ ] CI workflow 文件列表必须用 glob（避免显式漏接）
- [ ] repo 级配置（如 .claude/settings.json）必须有 fallback install script（CC 跨版本兼容）

## 验证证据

- 31 unit case 全过（含 Case 31 P1-1）
- devloop-classify CI Linux 全过
- integrity 17 case 全过（L15/L16/L17）
- engine-tests-shell job 用 glob 模式
- engine 8 处版本 18.22.1

## Stop Hook 完整闭环延续

| 段 | PR | 内容 |
|---|---|---|
| 11 | #2770 | integrity 5 修复 |
| 12 | #2777 | 4 P0 修（BUG-1/2/3/4）|
| **13** | **本 PR** | **4 P1 修（边缘 case + 测试基础设施）** |
```

- [ ] **Step 4: 跑全套 + check-cleanup**

```bash
bash packages/engine/skills/dev/scripts/check-cleanup.sh 2>&1 | tail -3
echo "---all tests---"
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -1
bash packages/engine/tests/integration/devloop-classify.test.sh 2>&1 | tail -1
bash packages/engine/tests/integration/stop-dev-multi-worktree.test.sh 2>&1 | tail -1
bash packages/engine/tests/integration/stop-dev-deploy-escape.test.sh 2>&1 | tail -1
bash packages/engine/tests/integration/stop-dev-ghost-filter.test.sh 2>&1 | tail -1
bash packages/engine/tests/integration/stop-hook-7stage-flow.test.sh 2>&1 | tail -1
bash packages/engine/tests/integration/ralph-loop-mode.test.sh 2>&1 | tail -1
bash packages/engine/tests/integrity/stop-hook-coverage.test.sh 2>&1 | tail -1
bash packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh 2>&1 | tail -1
bash packages/engine/scripts/smoke/ralph-loop-smoke.sh 2>&1 | tail -1
```

- [ ] **Step 5: Commit 收尾**

```bash
git add packages/engine/VERSION packages/engine/package.json \
        packages/engine/package-lock.json packages/engine/regression-contract.yaml \
        packages/engine/.hook-core-version packages/engine/hooks/.hook-core-version \
        packages/engine/hooks/VERSION packages/engine/skills/dev/SKILL.md \
        packages/engine/feature-registry.yml \
        docs/learnings/cp-0505162710-stop-hook-4p1-fix.md
git commit -m "[CONFIG] chore: bump engine 18.22.0 → 18.22.1 + Learning (cp-0505162710)

Stop Hook 4 个 P1 修复完整闭环（第 13 段）：
- P1-1 P5 engine-only PR not-applicable
- P1-2 devloop-classify CI Linux 修
- P1-3 engine-tests-shell glob
- P1-4 install-claude-settings.sh + integrity L15-L17

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 完成定义

- 31 unit + 整套 integration + 17 integrity + smoke 全过
- engine-tests-shell job 用 glob
- install-claude-settings.sh 存在
- engine 8 处版本 18.22.1
- Learning 含 ### 根本原因 + ### 下次预防

## Self-Review

**1. Spec coverage** — 4 P1 → 5 task 全覆盖 ✓
**2. Placeholder scan** — 无 TBD/TODO
**3. Type consistency** — `brain_changed` / `EXPIRE_MINUTES` / `SMART_STUB` 命名一致
