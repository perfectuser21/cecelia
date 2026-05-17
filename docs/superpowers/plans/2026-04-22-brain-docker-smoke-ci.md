# Brain Docker Infra CI + Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Brain Docker 化基础设施加 A+C 两层回归保护：CI 层自动 build/deps/config 3 步，本机 smoke 脚本 7 步覆盖 macOS 专属场景。

**Architecture:** `.github/workflows/ci.yml` 加一个 `docker-infra-smoke` job（ubuntu-latest，5 分钟内，只在 compose/Dockerfile/brain-docker-*.sh 改动时跑）；`scripts/brain-docker-smoke.sh` 是开发者本机工具，trap EXIT 自动回滚裸跑。

**Tech Stack:** GitHub Actions ubuntu-latest，docker buildx，docker compose v2，bash 4+，`dorny/paths-filter` 模式（仓库已有 paths detection）。

---

## File Structure

### 改

**`.github/workflows/ci.yml`**
- `changes` job 的 `outputs` 加 `compose`，detect step 加 `echo "compose=..." >> $GITHUB_OUTPUT`
- 新增 `docker-infra-smoke` job，挂在 changes 后
- `ci-passed` 的 `needs` + `check` 调用加 `docker-infra-smoke`

### 新建

**`scripts/brain-docker-smoke.sh`**
- 可执行，`bash`，`set +e`（让 step 独立 pass/fail）
- 7 step 子函数 + 主报告循环
- trap EXIT 兜底 `brain-docker-down.sh`

**`docs/learnings/cp-0422140001-brain-docker-smoke-ci.md`**（Ship 时写）

---

## Task 1: `.github/workflows/ci.yml` 加 `compose` 变更检测输出

**Files:**
- Modify: `.github/workflows/ci.yml` (changes job, 约 11-28 行)

- [ ] **Step 1.1: 改 changes.outputs**

在 `.github/workflows/ci.yml` 找到：
```yaml
  changes:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    outputs:
      brain: ${{ steps.detect.outputs.brain }}
      engine: ${{ steps.detect.outputs.engine }}
      workspace: ${{ steps.detect.outputs.workspace }}
```

改成：
```yaml
  changes:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    outputs:
      brain: ${{ steps.detect.outputs.brain }}
      engine: ${{ steps.detect.outputs.engine }}
      workspace: ${{ steps.detect.outputs.workspace }}
      compose: ${{ steps.detect.outputs.compose }}
```

- [ ] **Step 1.2: 改 detect 脚本**

在 detect step 里找到：
```yaml
          echo "workspace=$(echo "$CHANGED" | grep -qE '^apps/' && echo true || echo false)" >> $GITHUB_OUTPUT
```

后面追加一行：
```yaml
          echo "compose=$(echo "$CHANGED" | grep -qE '^(docker-compose\.yml|packages/brain/Dockerfile|scripts/brain-(docker-up|docker-down|build)\.sh)$' && echo true || echo false)" >> $GITHUB_OUTPUT
```

同时 `git rev-parse` 失败的 fallback 分支（第 20 行 `if ! git rev-parse` 下面）加一行（默认 true）：
```yaml
            echo "compose=true" >> $GITHUB_OUTPUT
```

- [ ] **Step 1.3: 校验 yaml 合法**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```
Expected: 无输出（yaml 合法）。

- [ ] **Step 1.4: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
git add .github/workflows/ci.yml
git commit -m "ci(changes): 新增 compose output 检测 docker 基础设施改动

docker-compose.yml / packages/brain/Dockerfile / scripts/brain-*.sh
改动时 outputs.compose=true，供 docker-infra-smoke job 做条件触发。

Task: 24951158-521e-4f32-a80a-14594c1ef478

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 加 `docker-infra-smoke` CI job

**Files:**
- Modify: `.github/workflows/ci.yml` (在 changes 和 secrets-scan 之间插新 job)

- [ ] **Step 2.1: 在 changes job 之后、其他 job 之前插入 docker-infra-smoke**

`.github/workflows/ci.yml` 找到 `changes` job 结束的位置（下一段是 `secrets-scan`），在两者之间插入：

```yaml
  # ─── Docker Infrastructure Smoke ──────────────────────────
  # 保护 Brain 容器化基础设施（compose / Dockerfile / up/down 脚本）
  # 只在相关文件改动时跑；3 步覆盖 Linux runner 能做的（镜像 build / deps / yaml 合法）
  # macOS 专属（host.docker.internal / launchd 双 scope）靠 scripts/brain-docker-smoke.sh 本机跑
  docker-infra-smoke:
    if: needs.changes.outputs.compose == 'true'
    needs: [changes]
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v4
      - name: Build cecelia-brain image
        run: |
          set -e
          docker build -f packages/brain/Dockerfile -t cecelia-brain:ci .
      - name: Verify key deps resolve inside image
        run: |
          set -e
          docker run --rm cecelia-brain:ci node -e "
            require('@langchain/langgraph');
            require('@langchain/langgraph-checkpoint-postgres');
            require('express');
            console.log('deps ok');
          "
      - name: Validate docker-compose.yml syntax
        run: |
          set -e
          # .env.docker 在 gitignore 里，CI 无此文件 → 建空占位
          : > .env.docker
          docker compose -f docker-compose.yml config > /dev/null
          echo "compose yaml ok"
```

- [ ] **Step 2.2: 校验 yaml 合法**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```
Expected: 无输出。

- [ ] **Step 2.3: 本机模拟 3 步（不用 GitHub runner，直接在本机 docker 验证）**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
# step a: build
docker build -f packages/brain/Dockerfile -t cecelia-brain:ci .
# step b: deps
docker run --rm cecelia-brain:ci node -e "require('@langchain/langgraph');require('@langchain/langgraph-checkpoint-postgres');require('express');console.log('ok')"
# step c: config
: > .env.docker
docker compose -f docker-compose.yml config > /dev/null && echo ok
```
Expected: 三步都输出 `ok` 或无错。

- [ ] **Step 2.4: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
git add .github/workflows/ci.yml
git commit -m "ci(docker-infra-smoke): 加 job 保护 Brain Docker 基础设施

条件触发：compose/Dockerfile/brain-docker-*.sh 改动时才跑。
3 步覆盖：
  1. docker build（捕获 Dockerfile 错 / monorepo workspaces npm ci 漏装）
  2. 关键 deps require 检查（@langchain/langgraph 等）
  3. docker compose config（yaml 语法 + 变量展开）

不覆盖：host.docker.internal / macOS 专属挂载 / launchctl（靠本机 smoke 脚本）

Task: 24951158-521e-4f32-a80a-14594c1ef478

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `ci-passed` aggregator 加 `docker-infra-smoke`

**Files:**
- Modify: `.github/workflows/ci.yml` (ci-passed job needs + check 调用)

- [ ] **Step 3.1: 改 needs**

在 `ci.yml` 找到：
```yaml
  ci-passed:
    if: always()
    needs: [secrets-scan, dep-audit, registry-lint, eslint, pr-size-check, branch-naming, engine-tests, brain-unit, brain-unit-all, brain-diff-coverage, brain-integration, workspace-build, workspace-test, e2e-smoke, dod-behavior-dynamic, harness-dod-integrity, harness-contract-lint]
```

在 needs 数组里添加 `docker-infra-smoke`：
```yaml
    needs: [secrets-scan, dep-audit, registry-lint, eslint, pr-size-check, branch-naming, engine-tests, brain-unit, brain-unit-all, brain-diff-coverage, brain-integration, workspace-build, workspace-test, e2e-smoke, dod-behavior-dynamic, harness-dod-integrity, harness-contract-lint, docker-infra-smoke]
```

- [ ] **Step 3.2: 改 check 调用**

找到 `check "harness-contract-lint"` 那一行，下面加一行：

```yaml
          check "harness-contract-lint" "${{ needs.harness-contract-lint.result }}"
          check "docker-infra-smoke"    "${{ needs.docker-infra-smoke.result }}"
```

注意：`docker-infra-smoke` 是条件触发的（compose 没改时 skip），check 函数已经能处理 skip（`"skipped" ) echo "⏭️  $n (skipped)"`），skip 不算 fail。

- [ ] **Step 3.3: 校验 yaml 合法**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```
Expected: 无输出。

- [ ] **Step 3.4: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
git add .github/workflows/ci.yml
git commit -m "ci(ci-passed): 聚合 docker-infra-smoke 进最终门禁

needs 数组加 docker-infra-smoke。
check 函数已能处理 skipped（条件触发的 job 在 compose 未改动时 skip）。

Task: 24951158-521e-4f32-a80a-14594c1ef478

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 写 `scripts/brain-docker-smoke.sh`

**Files:**
- Create: `scripts/brain-docker-smoke.sh`

- [ ] **Step 4.1: 写脚本**

Create `scripts/brain-docker-smoke.sh`:

```bash
#!/usr/bin/env bash
# Brain Docker 基础设施本机 smoke 测试
# 用法：改 docker-compose.yml / packages/brain/Dockerfile / brain-docker-*.sh 前
#       跑一次确认当前 main 的 Docker 化链路完整能用
#
# 输出：7 步各自 pass/fail + 总结。任一 step fail 退 1。
# 副作用：trap EXIT 兜底 brain-docker-down.sh，保证现场不残留。

set +e  # 让每 step 独立判 pass/fail，最后统一退出码

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

declare -a RESULTS
declare -a NAMES

record() {
  NAMES+=("$1")
  RESULTS+=("$2")  # PASS | FAIL
  printf "  [%s] %s\n" "$([ "$2" = "PASS" ] && echo '✓' || echo '✗')" "$1"
}

cleanup_on_exit() {
  echo ""
  echo "=== 清理：回滚到裸跑 Brain（幂等）==="
  bash "$ROOT_DIR/scripts/brain-docker-down.sh" 2>&1 | tail -3 || true
}
trap cleanup_on_exit EXIT

echo "=== Brain Docker 基础设施 Smoke ==="
echo "开始: $(date '+%H:%M:%S')"
echo ""

# ── Step 1: docker build ──
echo "→ Step 1: docker build"
if docker build -f packages/brain/Dockerfile -t cecelia-brain:smoke-ci . > /tmp/smoke-step1.log 2>&1; then
  record "Step 1: docker build" PASS
else
  record "Step 1: docker build" FAIL
  tail -20 /tmp/smoke-step1.log
fi

# ── Step 2: 依赖解析 ──
echo "→ Step 2: node require 关键 deps"
if docker run --rm cecelia-brain:smoke-ci node -e "require('@langchain/langgraph');require('@langchain/langgraph-checkpoint-postgres');require('express');console.log('ok')" > /tmp/smoke-step2.log 2>&1; then
  record "Step 2: deps resolved" PASS
else
  record "Step 2: deps resolved" FAIL
  tail -10 /tmp/smoke-step2.log
fi

# ── Step 3: compose config ──
echo "→ Step 3: docker compose config"
# 建空 .env.docker（如已有则保留；smoke 不破坏现场）
[ -f .env.docker ] || : > .env.docker
if docker compose -f docker-compose.yml config > /tmp/smoke-step3.log 2>&1; then
  record "Step 3: compose config" PASS
else
  record "Step 3: compose config" FAIL
  tail -10 /tmp/smoke-step3.log
fi

# ── Step 4: brain-docker-up 切换（Mac 专属）──
echo "→ Step 4: brain-docker-up.sh（切换裸跑 → 容器）"
if bash scripts/brain-docker-up.sh > /tmp/smoke-step4.log 2>&1; then
  record "Step 4: brain-docker-up" PASS
else
  record "Step 4: brain-docker-up" FAIL
  tail -20 /tmp/smoke-step4.log
fi

# ── Step 5: HTTP 健康 ──
echo "→ Step 5: curl 5221 健康"
if curl -fs http://localhost:5221/api/brain/tick/status > /tmp/smoke-step5.log 2>&1 && grep -q '"enabled":true' /tmp/smoke-step5.log; then
  record "Step 5: HTTP 5221 healthy" PASS
else
  record "Step 5: HTTP 5221 healthy" FAIL
  tail -10 /tmp/smoke-step5.log
fi

# ── Step 6: 容器内 docker CLI + host.docker.internal 通 ──
echo "→ Step 6: 容器内 docker CLI + host.docker.internal"
if docker exec cecelia-node-brain sh -c 'docker ps --format "{{.Names}}" | grep -q cecelia-node-brain && nc -zv host.docker.internal 5432' > /tmp/smoke-step6.log 2>&1; then
  record "Step 6: container docker + host.docker.internal" PASS
else
  record "Step 6: container docker + host.docker.internal" FAIL
  tail -10 /tmp/smoke-step6.log
fi

# ── Step 7: 自愈（kill -TERM 1 → Docker auto-restart）──
echo "→ Step 7: 自愈（kill -TERM PID 1，15s 内恢复 healthy）"
BEFORE_START=$(docker inspect -f '{{.State.StartedAt}}' cecelia-node-brain 2>/dev/null || echo "")
docker exec cecelia-node-brain kill -TERM 1 2>/dev/null || true
sleep 15
AFTER_START=$(docker inspect -f '{{.State.StartedAt}}' cecelia-node-brain 2>/dev/null || echo "")
STATUS=$(docker inspect -f '{{.State.Health.Status}}' cecelia-node-brain 2>/dev/null || echo "missing")
if [ "$BEFORE_START" != "$AFTER_START" ] && [ "$STATUS" = "healthy" ]; then
  record "Step 7: auto-restart" PASS
else
  record "Step 7: auto-restart" FAIL
  echo "  Before: $BEFORE_START"
  echo "  After:  $AFTER_START"
  echo "  Status: $STATUS"
fi

# ── 总结 ──
echo ""
echo "=== Smoke Summary ==="
PASS_COUNT=0
FAIL_COUNT=0
for i in "${!NAMES[@]}"; do
  if [ "${RESULTS[$i]}" = "PASS" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done
echo "Total: ${PASS_COUNT}/${#NAMES[@]} PASSED"
echo "结束: $(date '+%H:%M:%S')"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
```

- [ ] **Step 4.2: 赋可执行**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
chmod +x scripts/brain-docker-smoke.sh
```

- [ ] **Step 4.3: bash -n 语法检查**

Run:
```bash
bash -n /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci/scripts/brain-docker-smoke.sh && echo "✅ 语法 OK"
```
Expected: 输出 `✅ 语法 OK`。

- [ ] **Step 4.4: 本机真跑一次 smoke（切换 Brain → 容器 → 回滚，~2 分钟）**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
bash scripts/brain-docker-smoke.sh
```

Expected: 输出类似：
```
=== Brain Docker 基础设施 Smoke ===
→ Step 1: docker build
  [✓] Step 1: docker build
→ Step 2: node require 关键 deps
  [✓] Step 2: deps resolved
... 共 7 行 [✓]
Total: 7/7 PASSED
```

如果真跑出 fail，读对应 /tmp/smoke-stepN.log 诊断。

- [ ] **Step 4.5: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
git add scripts/brain-docker-smoke.sh
git commit -m "feat(scripts): brain-docker-smoke.sh 本机 7 步 smoke

改 compose/Dockerfile/brain-docker-*.sh 前跑一次，覆盖 macOS 专属:
  1. docker build
  2. node require @langchain/langgraph 等 deps
  3. docker compose config
  4. brain-docker-up.sh（launchctl 双 scope + docker up）
  5. curl localhost:5221 健康
  6. 容器内 docker CLI + nc host.docker.internal:5432
  7. kill -TERM 1 自愈（Docker auto-restart）

trap EXIT → brain-docker-down.sh 保证脚本失败也回滚到裸跑。
总报告末尾 exit 1/0。

Task: 24951158-521e-4f32-a80a-14594c1ef478

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 写 DoD + Learning

**Files:**
- Modify: `.dod`
- Create: `docs/learnings/cp-0422140001-brain-docker-smoke-ci.md`

- [ ] **Step 5.1: 覆盖 .dod**

写 `.dod`（可能有别分支残留）：

```markdown
# DoD — cp-0422140001-brain-docker-smoke-ci

## Artifact

- [x] [ARTIFACT] `.github/workflows/ci.yml` 有 docker-infra-smoke job + changes.compose output
  - Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('docker-infra-smoke:'))process.exit(1);if(!c.includes('compose: '))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] ci-passed job needs 含 docker-infra-smoke
  - Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const m=c.match(/ci-passed:[\\s\\S]*?needs:\\s*\\[([^\\]]+)\\]/);if(!m||!m[1].includes('docker-infra-smoke'))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] scripts/brain-docker-smoke.sh 存在且可执行
  - Test: manual:node -e "const fs=require('fs');const s=fs.statSync('scripts/brain-docker-smoke.sh');if(!(s.mode & 0o111))process.exit(1);const c=fs.readFileSync('scripts/brain-docker-smoke.sh','utf8');if(!c.includes('trap cleanup_on_exit EXIT'))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] 设计 + Learning 已提交
  - Test: manual:node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-22-brain-docker-smoke-ci-design.md');require('fs').accessSync('docs/learnings/cp-0422140001-brain-docker-smoke-ci.md')"

## Behavior

- [x] [BEHAVIOR] yaml 语法合法
  - Test: manual:python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"

- [x] [BEHAVIOR] smoke 脚本 bash -n 语法通过
  - Test: manual:bash -c "bash -n scripts/brain-docker-smoke.sh"
```

- [ ] **Step 5.2: 写 Learning**

Create `docs/learnings/cp-0422140001-brain-docker-smoke-ci.md`:

```markdown
# Brain Docker Infra CI + Smoke（2026-04-22）

## 做了什么

给 PR #2523 落地的 Brain Docker 化基础设施加两层回归保护：
1. CI 新增 `docker-infra-smoke` job（ubuntu-latest）：build + deps require + compose config 3 步，条件触发（仅在 compose/Dockerfile/brain-docker-*.sh 改动时跑）
2. 本机 `scripts/brain-docker-smoke.sh` 脚本：开发者改基础设施前手动跑，7 步覆盖 macOS 专属（launchd 双 scope / host.docker.internal / 绝对路径挂载 / 自愈）

`ci-passed` aggregator 新 job 挂进去，skip 不算 fail（条件触发合理）。

### 根本原因

PR #2523 落地后，Brain Docker infrastructure 只有 yaml/bash -n 层的语法保护。如果有人改 Dockerfile 或 docker-compose.yml 或 up/down 脚本，CI 不会发现镜像 build 失败 / 容器起不来 / 依赖缺失这类实质回归。要到 Mac 本机手动切换才暴露，调试成本高。

### 下次预防

- [ ] 引入 Docker 化服务的 PR，必须同时加 CI build smoke（不要依赖"人工本机验证"）
- [ ] CI job 条件触发用 paths-filter 方式（Linux runner 跑，不要 Mac runner，代价太高）
- [ ] macOS 专属的 infra（host.docker.internal / launchd / 绝对路径），用本机 smoke 脚本补 CI 覆盖不了的
- [ ] 本机 smoke 脚本必须 `trap EXIT` 兜底回滚，防止脚本失败留残留

## 技术要点

- `docker build -f packages/brain/Dockerfile .` 要从 repo root 做 context（monorepo workspaces 的 hoisted deps 依赖）
- `docker compose config` 不需要真的起容器，只做 yaml 解析 + 变量展开，CI 轻量可用
- `needs.changes.outputs.compose == 'true'` 条件触发，skip 时 ci-passed 的 check 函数视为非 failure
- `trap cleanup_on_exit EXIT` 即使脚本挂了、ctrl+C 中断了，都能运行 `brain-docker-down.sh` 回滚裸跑
- CI runner 上的 `docker compose config` 对空 `.env.docker` 兼容（compose 里所有变量都有 `${VAR:-default}` fallback）

## 冒烟验证

```bash
# 1. 本机 smoke 7 步全过
bash scripts/brain-docker-smoke.sh
# Expected: "Total: 7/7 PASSED"

# 2. CI 上 docker-infra-smoke job（PR 合入后）应绿
# 因为本 PR 动了 compose-相关文件监测脚本，触发条件满足

# 3. 反向测试（可选，不入主流程）：在 feature branch 上故意破坏
#    Dockerfile（删 USER root 那行），推 PR，CI docker-infra-smoke 应变红
```
```

- [ ] **Step 5.3: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-docker-smoke-ci
git add .dod docs/learnings/cp-0422140001-brain-docker-smoke-ci.md
git commit -m "docs: DoD + Learning for brain-docker-smoke-ci

Task: 24951158-521e-4f32-a80a-14594c1ef478

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

### Spec 覆盖检查

- SC-001 (docker-infra-smoke job) → Task 2 Step 2.1 实现
- SC-002 (changes.compose output) → Task 1 Step 1.1-1.2 实现
- SC-003 (ci-passed needs docker-infra-smoke) → Task 3 Step 3.1-3.2 实现
- SC-004 (brain-docker-smoke.sh 7 步) → Task 4 Step 4.1 实现
- SC-005 (本 PR 触发新 job 跑绿) → PR push 后自动验证
- SC-006 (反向测试 Dockerfile 破坏) → 可选，Learning 里描述了，不入主任务

### Placeholder 扫描

无 TBD/TODO。所有 yaml diff 和 bash 代码块都是完整可执行内容。

### 命名一致性

- `docker-infra-smoke` job 名 / `ci-passed` needs / `check "docker-infra-smoke"` 调用三处一致
- `compose` output 在 changes.outputs + detect step 一致
- `scripts/brain-docker-smoke.sh` 路径在 DoD / Learning / README 引用一致
- `cecelia-brain:smoke-ci` vs `cecelia-brain:ci` — CI 用 `:ci`，本机 smoke 用 `:smoke-ci`，刻意区分避免冲突（本机 OrbStack 已有 `cecelia-brain:latest` 生产镜像）
