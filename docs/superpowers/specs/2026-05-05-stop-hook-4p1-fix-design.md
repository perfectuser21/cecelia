# Stop Hook 4 个 P1 修复 — Design Spec

> 分支: cp-0505162710-stop-hook-4p1-fix
> 日期: 2026-05-05
> 前置: PR #2777 (4 P0) 已合
> Notion: https://www.notion.so/35753f413ec581d9b607f61e4e90ce0b
> 本 PR: 第 13 段 — P1 边缘 case + 测试基础设施完善

## 1. 背景

PR #2777 修了 4 个 P0，stop hook 主链路稳。Notion 第八章列了 4 个 P1 边缘问题，本 PR 一次性补完。

## 2. 4 个 P1

### P1-1 P5 engine-only PR not-applicable

**问题**：PR #2777 自己合并时撞上——engine-only PR 改 `packages/engine/**` 不动 `packages/brain/**`，brain-ci-deploy.yml 不触发，P5 永远等不到 deploy run，靠 BUG-4 mtime 30 分钟兜底。

**修法**：devloop-check.sh P5 加 paths 判断：

```bash
# 用 gh pr view --json files 看 PR 改动
brain_changed=$(gh pr view "$pr_number" --json files -q '[.files[].path] | map(select(startswith("packages/brain/"))) | length' 2>/dev/null || echo 0)
if [[ "$brain_changed" -eq 0 ]]; then
    # not applicable — engine/docs only PR 不需要 brain deploy
    echo "[P5] not applicable: PR #$pr_number 不触动 packages/brain/" >&2
    # 直接走 P6 / P7 / P0
else
    # 原 P5 逻辑：等 brain-ci-deploy.yml workflow conclusion=success
    ...
fi
```

### P1-2 devloop-classify.test.sh CI Linux 修

**问题**：CI Linux 4 case fail（"status=not-dev expected blocked"），从 PR #2770 拖到现在被 engine-tests-shell 显式列表排除。本地 macOS 全过。

**根因调研**：测试中 git init + commit 没设 `user.email/user.name`，CI Linux runner 默认无 git user → commit fail → branch 没创 → classify_session 看到主分支 → 返 not-dev。

**修法**：测试中所有 `git commit` 加 `-c user.email=t@t -c user.name=t` 显式（同 ralph-loop-mode 之前修法）。

### P1-3 engine-tests-shell 显式列表 → glob

**问题**：ci.yml 硬编码 7 个 .test.sh 路径，新加测试要手动加 ci.yml。容易漏。

**修法**：改 glob：

```yaml
# Before:
for t in \
    packages/engine/tests/integration/stop-hook-7stage-flow.test.sh \
    packages/engine/tests/integration/stop-dev-ghost-filter.test.sh \
    ...; do
# After:
for t in packages/engine/tests/integration/*.test.sh; do
```

加 integrity case 验证 ci.yml 用 glob 模式（grep `tests/integration/\*\.test\.sh`）。

### P1-4 跨机器 .claude/settings 安装 setup script

**问题**：BUG-3 修了 `.claude/settings.json` 进 repo，但远端 worker (西安/HK/Codex) clone 后 CC 是否真激活 PreToolUse hook 没验证机制。如果 CC 不识别 repo 级 settings，PreToolUse 失效但无人发现。

**修法（双重保险）**：

1. **`scripts/install-claude-settings.sh`** — 文档化设置，把 .claude/settings.json hook 配置 merge 到 `~/.claude/settings.json`（fallback for 不识别 repo 级 settings 的 CC 版本）
2. **integrity case L15** — grep `.claude/settings.json` 含 `dev-mode-tool-guard.sh` 文件名（确保 hook 真注册到正确 script）

## 3. 架构

### 3.1 P1-1 实现：devloop-check.sh P5 paths skip

定位 P5 deploy workflow 检查段（约 line 638-668），加前置 paths 判断：

```bash
if [[ "$verify_deploy" == "1" ]]; then
    # P1-1 (v18.22.1): engine-only / docs-only PR 不触发 brain-ci-deploy.yml
    local brain_changed
    brain_changed=$(gh pr view "$pr_number" --json files -q '[.files[].path] | map(select(startswith("packages/brain/"))) | length' 2>/dev/null || echo "0")
    if [[ "$brain_changed" =~ ^[0-9]+$ ]] && [[ "$brain_changed" -eq 0 ]]; then
        echo "[verify_dev_complete] P5 跳过：PR #$pr_number 不触动 packages/brain/，brain-ci-deploy.yml not applicable" >&2
        # 视为 P5 通过，进 P6 health probe
    else
        # 原 P5 逻辑：等 brain-ci-deploy.yml workflow conclusion=success
        local merge_sha deploy_run_id deploy_status deploy_conclusion
        merge_sha=$(...)
        ...
    fi
fi
```

### 3.2 P1-2 修法：devloop-classify git user

读 `tests/integration/devloop-classify.test.sh`，所有 `git commit` 加 `-c user.email=t@t -c user.name=t`。

### 3.3 P1-3 ci.yml glob 改写

修改 `.github/workflows/ci.yml` engine-tests-shell job：

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

### 3.4 P1-4 setup script + integrity

`scripts/install-claude-settings.sh`：

```bash
#!/usr/bin/env bash
# install-claude-settings.sh — fallback 把 repo 级 .claude/settings.json 的 hook
# 配置 merge 到用户级 ~/.claude/settings.json（CC 不识别 repo settings 的兜底）
set -uo pipefail
REPO_SETTINGS="$(cd "$(dirname "$0")/.." && pwd)/.claude/settings.json"
USER_SETTINGS="${HOME}/.claude/settings.json"

[[ -f "$REPO_SETTINGS" ]] || { echo "❌ $REPO_SETTINGS 不存在"; exit 1; }
mkdir -p "$(dirname "$USER_SETTINGS")"

if [[ ! -f "$USER_SETTINGS" ]]; then
    cp "$REPO_SETTINGS" "$USER_SETTINGS"
    echo "✅ 已安装 $USER_SETTINGS"
else
    # merge：用户已有 settings.json 时只补 PreToolUse 部分
    if ! command -v jq &>/dev/null; then
        echo "❌ jq 不可用，无法 merge。手动编辑 $USER_SETTINGS"
        exit 1
    fi
    jq -s '.[0] * .[1]' "$USER_SETTINGS" "$REPO_SETTINGS" > "$USER_SETTINGS.new"
    mv "$USER_SETTINGS.new" "$USER_SETTINGS"
    echo "✅ 已 merge $REPO_SETTINGS → $USER_SETTINGS"
fi
```

integrity case：

```bash
# L15: .claude/settings.json 含 dev-mode-tool-guard.sh 引用
if [[ -f "$REPO_ROOT/.claude/settings.json" ]] && \
   grep -q 'dev-mode-tool-guard\.sh' "$REPO_ROOT/.claude/settings.json"; then
    pass "L15: settings.json 引用 dev-mode-tool-guard.sh"
else
    fail "L15: settings.json 未引用 dev-mode-tool-guard.sh"
fi

# L16: install-claude-settings.sh 存在
[[ -f "$REPO_ROOT/scripts/install-claude-settings.sh" ]] && \
    pass "L16: install-claude-settings.sh 存在（跨机器 setup fallback）" || \
    fail "L16: install script 缺"
```

## 4. 错误处理

- P1-1：gh pr view 失败 → brain_changed="0" 走 not-applicable 路径（fail-open，避免 stop hook 卡住）
- P1-2：git -c user.email/name 失败概率极低（CI 标准 git 都支持）
- P1-3：glob 无匹配时 for loop 不进入（bash 默认行为，无需特殊处理）
- P1-4：jq 缺失时 install script 报错退出（用户可手动编辑）

## 5. 测试策略

| 类型 | 文件 | 覆盖 |
|---|---|---|
| **Unit** | `tests/unit/verify-dev-complete.test.sh` 加 Case 31 | P1-1 engine-only PR not-applicable 反馈不含"等 brain-ci-deploy"|
| **Integration** | `tests/integration/devloop-classify.test.sh` 修 git user | P1-2 CI Linux 全过 |
| **Integrity** | `tests/integrity/stop-hook-coverage.test.sh` 加 L15/L16 + glob 验证 | P1-3 + P1-4 |
| **Smoke** | 不动（已有 9 step 覆盖核心）| — |
| **Trivial** | install-claude-settings.sh 手跑一次验证 idempotent | bash -n + 手动 |

## 6. 关键文件清单

| 文件 | 改动 |
|---|---|
| `packages/engine/lib/devloop-check.sh` | P1-1 P5 paths skip |
| `packages/engine/tests/integration/devloop-classify.test.sh` | P1-2 git user 显式 |
| `.github/workflows/ci.yml` | P1-3 engine-tests-shell glob |
| `packages/engine/tests/integrity/stop-hook-coverage.test.sh` | 加 L15/L16 + glob 验证 |
| `scripts/install-claude-settings.sh` | 新建（P1-4） |
| `packages/engine/tests/unit/verify-dev-complete.test.sh` | 加 Case 31 P1-1 |
| 8 处版本文件 | 18.22.0 → 18.22.1（patch）|
| `docs/learnings/cp-0505162710-stop-hook-4p1-fix.md` | Learning |

## 7. Out of Scope

- 不改 stop-dev.sh / 7 阶段决策树（PR #2777 锁定）
- 不动 PreToolUse hook 实现（dev-mode-tool-guard.sh）
- 不改 4 P0 修复
- 不引入新 env flag

## 8. 完成定义

- 31 unit case + integration 全过（含 devloop-classify CI Linux 通过）
- integrity 17 case 全过（L15/L16 grep 验证）
- engine-tests-shell job 用 glob 模式（CI yaml diff）
- install-claude-settings.sh 存在 + idempotent
- engine 8 处版本 18.22.1
- Learning 含 ### 根本原因 + ### 下次预防
