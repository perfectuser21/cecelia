# Deploy Unify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `scripts/deploy.sh` 统一部署入口，自动检测 brain/dashboard 改动并按需调用现有部署脚本。

**Architecture:** 单个 shell 脚本，解析三个 flag（--brain-only / --dashboard-only / --skip-smoke），用 `git diff --name-only` 检测改动范围，顺序调用 brain-deploy.sh 和/或 rebuild-dashboard.sh，最后跑 smoke 验活。不修改任何现有脚本。

**Tech Stack:** bash, git, curl, node（仅解析 JSON version 字段）

---

### Task 1: 创建 scripts/deploy.sh

**Files:**
- Create: `scripts/deploy.sh`

- [ ] **Step 1: 写脚本**

```bash
cat > scripts/deploy.sh << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 参数解析 ─────────────────────────────────────────────────────────────────
BRAIN_ONLY=false
DASHBOARD_ONLY=false
SKIP_SMOKE=false

for arg in "$@"; do
    case $arg in
        --brain-only)     BRAIN_ONLY=true ;;
        --dashboard-only) DASHBOARD_ONLY=true ;;
        --skip-smoke)     SKIP_SMOKE=true ;;
        *)
            echo "Usage: $0 [--brain-only | --dashboard-only] [--skip-smoke]"
            exit 1
            ;;
    esac
done

if [[ "$BRAIN_ONLY" == true && "$DASHBOARD_ONLY" == true ]]; then
    echo "Error: --brain-only and --dashboard-only are mutually exclusive"
    exit 1
fi

# ── 改动检测 ─────────────────────────────────────────────────────────────────
detect_changes() {
    local path="$1"
    local changed=""
    if git rev-parse "origin/main" >/dev/null 2>&1; then
        changed=$(git diff --name-only "origin/main~1..origin/main" -- "$path" 2>/dev/null || true)
    fi
    if [[ -z "$changed" ]]; then
        changed=$(git diff --name-only "HEAD~1..HEAD" -- "$path" 2>/dev/null || true)
    fi
    [[ -n "$changed" ]]
}

BRAIN_CHANGED=false
DASHBOARD_CHANGED=false

if [[ "$DASHBOARD_ONLY" == false ]]; then
    detect_changes "packages/brain/" && BRAIN_CHANGED=true || true
fi
if [[ "$BRAIN_ONLY" == false ]]; then
    detect_changes "apps/dashboard/" && DASHBOARD_CHANGED=true || true
fi

[[ "$BRAIN_ONLY"     == true ]] && BRAIN_CHANGED=true
[[ "$DASHBOARD_ONLY" == true ]] && DASHBOARD_CHANGED=true

echo "=== Cecelia deploy ==="
echo "  brain changed:     $BRAIN_CHANGED"
echo "  dashboard changed: $DASHBOARD_CHANGED"
echo ""

if [[ "$BRAIN_CHANGED" == false && "$DASHBOARD_CHANGED" == false ]]; then
    echo "[skip] 无改动，跳过 rebuild，只跑 smoke 验活"
    echo ""
fi

# ── Brain 部署 ───────────────────────────────────────────────────────────────
if [[ "$BRAIN_CHANGED" == true ]]; then
    echo "--- Deploying Brain ---"
    bash "$SCRIPT_DIR/brain-deploy.sh" || {
        echo ""
        echo "[FAIL] brain-deploy.sh 失败，中止部署"
        exit 1
    }
    echo ""
fi

# ── Dashboard 构建 ──────────────────────────────────────────────────────────
if [[ "$DASHBOARD_CHANGED" == true ]]; then
    echo "--- Building Dashboard ---"
    bash "$SCRIPT_DIR/rebuild-dashboard.sh" || {
        echo ""
        echo "[FAIL] rebuild-dashboard.sh 失败"
        exit 1
    }
    echo ""
fi

# ── Smoke ────────────────────────────────────────────────────────────────────
if [[ "$SKIP_SMOKE" == true ]]; then
    echo "[skip-smoke] 跳过 smoke 检查"
    echo ""
    echo "=== Cecelia deployed ==="
    exit 0
fi

echo "--- Smoke ---"
BRAIN_VERSION=""
SMOKE_FAIL=false

if curl -sf --max-time 10 "http://localhost:5221/api/brain/version" >/tmp/cecelia-smoke-brain.json 2>/dev/null; then
    BRAIN_VERSION=$(node -e "try{console.log(require('/tmp/cecelia-smoke-brain.json').version||'ok')}catch(e){console.log('ok')}" 2>/dev/null || echo "ok")
    echo "  ✅ Brain: v${BRAIN_VERSION}"
else
    echo "  ❌ Brain smoke 失败 (localhost:5221/api/brain/version)"
    SMOKE_FAIL=true
fi

if curl -sf --max-time 10 "http://localhost:5211" >/dev/null 2>&1; then
    echo "  ✅ Dashboard: ok"
else
    echo "  ❌ Dashboard smoke 失败 (localhost:5211)"
    SMOKE_FAIL=true
fi

echo ""

if [[ "$SMOKE_FAIL" == true ]]; then
    echo "[FAIL] smoke 未全通过"
    exit 1
fi

echo "=== ✅ Cecelia deployed: brain=${BRAIN_VERSION} dashboard=ok ==="
SCRIPT
chmod +x scripts/deploy.sh
```

- [ ] **Step 2: 验证语法**

```bash
bash -n scripts/deploy.sh
```
Expected: 无输出（无语法错误）

- [ ] **Step 3: 冒烟测试 —— 无参数、无改动场景**

```bash
# 在 worktree 根目录
bash scripts/deploy.sh --skip-smoke
```
Expected 输出含：
```
=== Cecelia deploy ===
  brain changed:     false
  dashboard changed: false
[skip] 无改动，跳过 rebuild，只跑 smoke 验活
[skip-smoke] 跳过 smoke 检查
=== Cecelia deployed ===
```

- [ ] **Step 4: 冒烟测试 —— --brain-only**

```bash
bash scripts/deploy.sh --brain-only --skip-smoke 2>&1 | head -5
```
Expected 输出含：
```
  brain changed:     true
  dashboard changed: false
--- Deploying Brain ---
```
（brain-deploy.sh 真正执行需要 Docker，此处只验证分支逻辑，可 Ctrl-C 中断）

- [ ] **Step 5: 冒烟测试 —— --dashboard-only**

```bash
bash scripts/deploy.sh --dashboard-only --skip-smoke 2>&1 | head -5
```
Expected 输出含：
```
  brain changed:     false
  dashboard changed: true
--- Building Dashboard ---
```

- [ ] **Step 6: 互斥 flag 验证**

```bash
bash scripts/deploy.sh --brain-only --dashboard-only 2>&1; echo "exit: $?"
```
Expected：
```
Error: --brain-only and --dashboard-only are mutually exclusive
exit: 1
```

- [ ] **Step 7: commit**

```bash
cd /Users/administrator/worktrees/cecelia/deploy-unify
git add scripts/deploy.sh
git commit -m "feat(scripts): deploy.sh 统一部署入口 — 自动检测 brain/dashboard 改动"
```

---

### Task 2: 写 Learning + PR

- [ ] **Step 1: 写 Learning**

```bash
cat > docs/learnings/cp-0628224907-deploy-unify.md << 'EOF'
# deploy.sh 统一部署入口

### 背景
Cecelia 有 6+ 个分散的部署脚本，每次 deploy 要记住改了什么跑哪个。

### 解决方案
新增 `scripts/deploy.sh` 作为统一入口：
- 自动 `git diff` 检测 brain/dashboard 是否有改动
- 无改动 → 只跑 smoke，不 rebuild（幂等）
- 支持 `--brain-only` / `--dashboard-only` / `--skip-smoke` flag
- brain 失败 → exit 1，不继续 dashboard

### 根本原因
无统一入口导致认知负担，且容易漏跑某一侧的 rebuild。

### 下次预防
- [ ] post-merge-deploy.sh / staging-deploy.sh 不动，接口不变
- [ ] 新增 deploy 场景优先扩展 deploy.sh flag，而非新建脚本
EOF
```

- [ ] **Step 2: commit learning**

```bash
git add docs/learnings/cp-0628224907-deploy-unify.md
git commit -m "docs(learnings): deploy.sh 统一入口设计记录"
```

- [ ] **Step 3: push + PR**

```bash
git push -u origin cp-0628224907-deploy-unify
gh pr create \
  --title "feat(scripts): deploy.sh 统一部署入口" \
  --body "$(cat <<'EOF'
## Summary
- 新增 \`scripts/deploy.sh\` 统一入口，替代手动选择多个部署脚本
- 自动检测 \`packages/brain/\` 和 \`apps/dashboard/\` 是否有 git diff 改动
- 支持 \`--brain-only\` / \`--dashboard-only\` / \`--skip-smoke\`
- 无改动时只跑 smoke 验活（幂等）
- 不修改任何现有脚本接口

## Test plan
- [ ] \`bash scripts/deploy.sh --skip-smoke\` 无改动时跳过 rebuild
- [ ] \`bash scripts/deploy.sh --brain-only --skip-smoke\` 只触发 brain 分支
- [ ] \`bash scripts/deploy.sh --dashboard-only --skip-smoke\` 只触发 dashboard 分支
- [ ] \`--brain-only --dashboard-only\` 同时传报错 exit 1

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
