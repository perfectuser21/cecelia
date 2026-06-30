# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 核心交付物是 GitHub Actions workflow 文件 + bash 脚本，不新增 Brain API 端点。Reviewer 第6维 verification_oracle_completeness 自动满分（workflow 文件）。

---

## 已知约束（来自回归测试）

- [auto-staging-deploy.yml] → 使用 Tailscale + SSH 部署到 hk-vps，已验证 `scripts/staging-deploy.sh` 模式可行
- [pr-review.yml] → PR 事件触发模式：`on: pull_request: types: [opened, synchronize]`，可复用
- [ci.yml] → 使用 `concurrency` 组防止同 branch 并发，`cancel-in-progress: true` 模式

---

## Golden Path

[开发者推送到 PR branch] → [CI 触发预览部署] → [dashboard 构建+上传到 hk-vps] → [端口哈希分配] → [PR 评论写入预览 URL] → [PR close/merge → 自动清理]

---

### Step 1: 开发者向 `cp-*` 或 `feature/*` branch 推送 commit 或创建/更新 PR

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体" 第1点，直接定义触发场景

**可观测行为**: GitHub Actions 显示 `preview-deploy` workflow 进入 queued/running 状态，PR checks 列出该 workflow

**验证命令**:
```bash
# 验证 workflow 文件存在且含正确触发器
grep -A3 "^on:" .github/workflows/preview-deploy.yml | grep -qE "pull_request" || { echo "FAIL: 缺 pull_request trigger"; exit 1; }
grep "opened\|synchronize\|reopened" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR 事件类型"; exit 1; }
echo "✅ Step 1 trigger 验证通过"
```

**硬阈值**: workflow 文件含 `pull_request` trigger + `opened`/`synchronize` 事件类型

---

### Step 2: CI 拉取 branch 代码，构建 `apps/dashboard` 静态资产

**来源**: `[FROM_PRD]` — PRD 假设段"每个预览环境仅部署 apps/dashboard（React 静态构建）"

**可观测行为**: workflow steps 包含 `npm ci` + `npm run build`（或等效）针对 apps/dashboard，构建产物为静态 HTML/JS/CSS

**验证命令**:
```bash
# 验证 workflow 包含 dashboard build 步骤
grep -qE "npm.*run.*build|vite.*build" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 build 步骤"; exit 1; }
echo "✅ Step 2 build 步骤验证通过"
```

**硬阈值**: workflow 含 `npm run build`（或 vite build）步骤

---

### Step 3: 通过 branch name hash 确定唯一端口（8000-8999 范围）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：多个 PR 并发时必须各自独立端口，哈希确保幂等（同 branch 重复推送使用同一端口不冲突），防止端口随机选取导致 cleanup 无法定位目标

**可观测行为**: 给定任意 branch name，`preview-deploy.sh` 输出固定端口（幂等）且在 8000-8999 范围内

**验证命令**:
```bash
# 验证部署脚本存在且含端口计算逻辑
grep -qE "PORT|8[0-9]{3}" scripts/preview-deploy.sh || { echo "FAIL: 缺端口计算逻辑"; exit 1; }
# 验证端口范围约束（8000-8999）
grep -qE "8000|8999|% 1000" scripts/preview-deploy.sh || { echo "FAIL: 缺 8000-8999 范围定义"; exit 1; }
echo "✅ Step 3 端口计算逻辑验证通过"
```

**硬阈值**: `preview-deploy.sh` 含端口计算逻辑，范围约束 8000-8999

---

### Step 4: CI 通过 SSH 部署到 hk-vps，在分配端口启动静态文件服务器

**来源**: `[FROM_PRD]` — PRD 假设段"预览部署目标为 hk-vps，通过 SSH 部署 + 动态端口隔离"

**可观测行为**: workflow 包含 SSH 步骤（使用 `HK_VPS_SSH_KEY` secret 或等效），在远端启动 `npx serve` / `python3 -m http.server` 等静态服务

**验证命令**:
```bash
# 验证 workflow 含 SSH 步骤
grep -qE "ssh|appleboy/ssh-action|SSH" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 SSH 步骤"; exit 1; }
# 验证 secret 引用（HK_VPS 密钥）
grep -qE "HK_VPS|SSH_KEY|PREVIEW_SSH" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 SSH key secret 引用"; exit 1; }
echo "✅ Step 4 SSH 部署验证通过"
```

**硬阈值**: workflow 含 SSH action 步骤 + hk-vps SSH key secret 引用

---

### Step 5: CI 向 PR 写评论，附上预览访问 URL

**来源**: `[FROM_PRD]` — PRD Golden Path 第3点"CI 向 PR 写入评论或更新 GitHub Environment，附上该 branch 的预览访问 URL"

**可观测行为**: PR 评论区出现含 `http://` 开头 + 端口号的预览 URL，格式如 `http://hk-vps-ip:PORT` 或 `http://hostname:PORT`

**验证命令**:
```bash
# 验证 workflow 含 PR comment 步骤
grep -qE "github-script|create.*comment|pr.*comment|pull-requests.*write" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR comment 步骤"; exit 1; }
# 验证 workflow 有 pull-requests: write 权限
grep -qE "pull-requests.*write" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 pull-requests write 权限"; exit 1; }
echo "✅ Step 5 PR comment 步骤验证通过"
```

**硬阈值**: workflow 含 `pull-requests: write` 权限 + PR comment 写入步骤

---

### Step 6: 部署失败时 PR 评论标注失败原因（error path）

**来源**: `[FROM_PRD]` — PRD NFR 约束"部署失败必须在 PR 评论中写明失败原因"

**可观测行为**: 当 deploy 步骤失败时，workflow 使用 `if: failure()` 条件步骤向 PR 写入失败原因评论，不产出无效 URL

**验证命令**:
```bash
# 验证 workflow 含 failure() 条件的评论步骤
grep -qE "failure\(\)|if.*failure" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 failure() 错误评论步骤"; exit 1; }
echo "✅ Step 6 error path 验证通过"
```

**硬阈值**: workflow 含 `if: failure()` 条件步骤用于写入失败原因

---

### Step 7: PR merge 或 close → cleanup workflow 触发，停止预览服务，端口释放

**来源**: `[FROM_PRD]` — PRD Golden Path 第5点"PR merge 或 close 后，预览环境自动清理"

**可观测行为**: `preview-cleanup.yml` 在 PR closed 事件触发，SSH 到 hk-vps 执行 `preview-cleanup.sh`，停止对应端口进程

**验证命令**:
```bash
# 验证 cleanup workflow 存在且含 closed 触发
grep -qE "closed" .github/workflows/preview-cleanup.yml || { echo "FAIL: 缺 closed trigger"; exit 1; }
grep -qE "preview-cleanup\.sh|cleanup" .github/workflows/preview-cleanup.yml || { echo "FAIL: 缺 cleanup 调用"; exit 1; }
echo "✅ Step 7 cleanup workflow 验证通过"
```

**硬阈值**: `preview-cleanup.yml` 含 `closed` PR 事件 trigger + 清理脚本调用

---

## E2E 验收（final-e2e 跑 — target_environment: local_api）

**journey_type**: dev_pipeline
**target_environment**: local_api

> **选模板规则**: target_environment=local_api → curl + 本地脚本执行。E2E 通过 GitHub CLI (`gh`) 调用 GitHub API，触发真实 workflow，验证 PR comment 写入情况。evaluator 在 macOS/Linux 本机执行，需要 `GH_TOKEN` 环境变量（已有 repo secrets 权限的 PAT）。

<!-- GOLDEN_SMOKE_ABILITY_SLUG: per-branch-preview-env -->
<!-- GOLDEN_SMOKE_TARGET_ENV: local_api -->

### Scenario 1: workflow 文件结构静态验证

<!-- GOLDEN_SMOKE_SCENARIO: workflow-files-structure -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e

# STEP: 验证 preview-deploy.yml 存在
test -f .github/workflows/preview-deploy.yml || { echo "FAIL: preview-deploy.yml 不存在"; exit 1; }

# STEP: 验证触发器配置
grep -qE "pull_request" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 pull_request trigger"; exit 1; }
grep -qE "opened|synchronize" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR 事件类型"; exit 1; }

# STEP: 验证 preview-cleanup.yml 存在
test -f .github/workflows/preview-cleanup.yml || { echo "FAIL: preview-cleanup.yml 不存在"; exit 1; }

# STEP: 验证 cleanup 触发条件
grep -qE "closed" .github/workflows/preview-cleanup.yml || { echo "FAIL: 缺 closed trigger"; exit 1; }

# STEP: 验证部署脚本存在
test -f scripts/preview-deploy.sh || { echo "FAIL: preview-deploy.sh 不存在"; exit 1; }
test -f scripts/preview-cleanup.sh || { echo "FAIL: preview-cleanup.sh 不存在"; exit 1; }

# STEP: 验证端口范围配置（8000-8999）
grep -qE "8[0-9]{3}|PORT_MIN|PORT_MAX" scripts/preview-deploy.sh || { echo "FAIL: 缺端口范围定义"; exit 1; }

# STEP: 验证 PR comment 权限
grep -qE "pull-requests.*write" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 pull-requests write 权限"; exit 1; }

echo "✅ Scenario 1 通过"
```

### Scenario 2: 端口哈希幂等性验证

<!-- GOLDEN_SMOKE_SCENARIO: port-hash-idempotent -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 15000 -->

```bash
#!/bin/bash
set -e

# STEP: 提取端口计算逻辑并验证幂等性
# preview-deploy.sh 必须能以 BRANCH_NAME 参数模式输出端口
test -f scripts/preview-deploy.sh || { echo "FAIL: preview-deploy.sh 不存在"; exit 1; }

BRANCH_NAME="cp-test-feature-abc123"

# STEP: 两次执行输出相同端口（幂等）
PORT1=$(bash scripts/preview-deploy.sh --print-port "$BRANCH_NAME" 2>/dev/null || echo "0")
PORT2=$(bash scripts/preview-deploy.sh --print-port "$BRANCH_NAME" 2>/dev/null || echo "0")
[ "$PORT1" = "$PORT2" ] || { echo "FAIL: 端口不幂等 PORT1=$PORT1 PORT2=$PORT2"; exit 1; }

# STEP: 验证端口在合法范围 8000-8999
[ "$PORT1" -ge 8000 ] && [ "$PORT1" -le 8999 ] || { echo "FAIL: 端口超范围 PORT=$PORT1"; exit 1; }

# STEP: 不同 branch 产生不同端口
PORT3=$(bash scripts/preview-deploy.sh --print-port "feature/other-branch" 2>/dev/null || echo "0")
[ "$PORT1" != "$PORT3" ] || { echo "WARN: 不同 branch 产生相同端口（哈希碰撞，允许但需注意）"; }

echo "✅ Scenario 2 通过 PORT=$PORT1"
```

### Scenario 3: GitHub API 验证 workflow 配置合法性

<!-- GOLDEN_SMOKE_SCENARIO: github-api-workflow-validation -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e

# 前提：GH_TOKEN 已设置（repo Actions workflow 读取权限）
# 注意：此 scenario 在 golden-smoke regression CI 中跳过（需要 GH_TOKEN + 联网）
# 本地 evaluator 执行时需设置 GH_TOKEN

[ -n "${GH_TOKEN:-}" ] || { echo "SKIP: GH_TOKEN 未设置，跳过 GitHub API 验证"; exit 0; }

REPO="perfectuser21/cecelia"

# STEP: 验证 preview-deploy.yml 已推送到远端（通过 GitHub API）
STATUS=$(curl -sf -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$REPO/contents/.github/workflows/preview-deploy.yml" \
  -w "%{http_code}" -o /dev/null 2>/dev/null || echo "000")
[ "$STATUS" = "200" ] || { echo "FAIL: preview-deploy.yml 未在远端 GitHub 仓库 status=$STATUS"; exit 1; }

# STEP: 验证 preview-cleanup.yml 已推送
STATUS=$(curl -sf -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$REPO/contents/.github/workflows/preview-cleanup.yml" \
  -w "%{http_code}" -o /dev/null 2>/dev/null || echo "000")
[ "$STATUS" = "200" ] || { echo "FAIL: preview-cleanup.yml 未在远端 GitHub 仓库 status=$STATUS"; exit 1; }

echo "✅ Scenario 3 通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| preview-deploy.yml 存在且触发正确 | `tests/preview-env.test.ts` | workflow 文件存在 + trigger 配置 | → 文件不存在 → FAIL |
| preview-cleanup.yml 存在且触发正确 | `tests/preview-env.test.ts` | cleanup 文件存在 + closed trigger | → 文件不存在 → FAIL |
| scripts 存在且含端口逻辑 | `tests/preview-env.test.ts` | deploy.sh + cleanup.sh 存在 + 端口范围 | → 文件不存在 → FAIL |
| 端口范围约束 | `tests/preview-env.test.ts` | 8000-8999 范围定义 | → grep 不匹配 → FAIL |
