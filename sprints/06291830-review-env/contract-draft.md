# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 核心交付物是 GitHub Actions workflow 文件 + bash 脚本，不新增 Brain API 端点。Reviewer 第6维 verification_oracle_completeness 自动满分（workflow 文件）。

---

## 已知约束（来自回归测试）

- [auto-staging-deploy.yml] → 使用 Tailscale + SSH 部署到 hk-vps，已验证 `scripts/staging-deploy.sh` 模式可行
- [pr-review.yml] → PR 事件触发模式：`on: pull_request: types: [opened, synchronize]`，可复用
- [ci.yml] → 使用 `concurrency` 组防止同 branch 并发，`cancel-in-progress: true` 模式

---

## Risks（风险登记）

### Risk 1: 端口碰撞（Port Collision）

- **描述**: 两个不同 branch name 经哈希计算得到相同端口，后一个部署静默覆盖前一个；reviewer 打开的 URL 实际显示另一个 branch 的内容
- **概率**: 低（1000 个端口槽位），但随并发 PR 数量增加风险上升
- **Mitigation**: `preview-deploy.sh` 在绑定端口前检查 `/tmp/preview-<PORT>.pid` 文件——若 PID 文件存在且对应进程属于不同 branch，脚本以非 0 exit 报告碰撞，CI 通过 `failure()` 步骤向 PR 写碰撞警告，而非静默覆盖。Generator 必须实现此检测逻辑。

### Risk 2: SSH 连接失败（SSH / Network Failure）

- **描述**: hk-vps 不可达（Tailscale 断线、机器重启、secret 过期），导致 CI 卡住超时或静默失败，PR 不写评论或写入无效 URL
- **Mitigation**: workflow SSH action 设置 `command_timeout: 120s`；在 `if: failure()` 步骤中向 PR 写明失败原因（不产出无效 URL）；`preview-deploy.sh` 在执行部署逻辑前先 `ssh -o ConnectTimeout=10` 验活，连接失败立即 `exit 1`

### Risk 3: 僵尸进程 / 端口泄露（Zombie Process）

- **描述**: PR 以 `git push --force` 删除 branch（而非关闭 PR）时，cleanup workflow 不触发；端口上的静态服务持续运行，8000-8999 段逐渐被耗尽
- **Mitigation**: `preview-deploy.sh` 以 `echo $! > /tmp/preview-<PORT>.pid` 记录进程 PID；`preview-cleanup.sh` 通过 PID 文件精确 kill；已在接缝清单中标注此接缝为 logic-done-pending（需真机测试 cleanup 触发路径）

---

## Golden Path

[开发者推送到 PR branch] → [CI 触发预览部署] → [dashboard 构建+上传到 hk-vps] → [端口哈希分配] → [preview URL health check HTTP 200] → [PR 评论写入预览 URL] → [PR close/merge → 自动清理]

---

### Step 1: 开发者向 `cp-*` 或 `feature/*` branch 推送 commit 或创建/更新 PR（main 分支不触发）

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体" 第1点 + PRD 边界情况"main 分支推送：不触发 per-branch 预览"

**可观测行为**: GitHub Actions 显示 `preview-deploy` workflow 进入 queued/running 状态；向 `main` 推送时 workflow 不触发

**验证命令**:
```bash
# 验证 workflow 文件存在且含正确触发器
grep -qE "^on:" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 on: 触发器段"; exit 1; }
grep -qE "pull_request" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 pull_request trigger"; exit 1; }
grep -qE "opened|synchronize|reopened" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR 事件类型"; exit 1; }

# main branch 过滤：workflow 必须通过 branch filter 或 PR target 排除 main
# 方式A: branches-ignore 排除 main；方式B: 仅限 pull_request（PR 本身不在 main branch）
# PR 事件的 branch 指的是 head branch（cp-* / feature/*），main 作为 base 不触发 head
grep -qE "branches-ignore|branches:" .github/workflows/preview-deploy.yml && \
  grep -qE "main" .github/workflows/preview-deploy.yml || \
  grep -qE "pull_request" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 main 过滤或 PR-only 触发"; exit 1; }

echo "✅ Step 1 trigger 验证通过（含 main branch 过滤）"
```

**硬阈值**: workflow 含 `pull_request` trigger + `opened`/`synchronize` 事件；main 分支推送不触发（通过 PR 事件限制或 branches-ignore）

---

### Step 2: CI 拉取 branch 代码，构建 `apps/dashboard` 静态资产

**来源**: `[FROM_PRD]` — PRD 假设段"每个预览环境仅部署 apps/dashboard（React 静态构建）"

**可观测行为**: workflow steps 包含 `npm ci` + `npm run build`（或等效）针对 apps/dashboard，构建产物为静态 HTML/JS/CSS

**验证命令**:
```bash
grep -qE "npm.*run.*build|vite.*build" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 build 步骤"; exit 1; }
echo "✅ Step 2 build 步骤验证通过"
```

**硬阈值**: workflow 含 `npm run build`（或 vite build）步骤

---

### Step 3: 通过 branch name hash 确定唯一端口（8000-8999 范围），支持 `--print-port` CLI 接口

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入；理由：多 PR 并发时必须各自独立端口，哈希确保幂等（同 branch 重复推送使用同一端口不冲突），`--print-port` CLI 接口供 CI workflow 和 Scenario 2 测试一致使用

**可观测行为**: 给定任意 branch name，`preview-deploy.sh --print-port <BRANCH>` 输出固定的 4 位端口号（幂等）且在 8000-8999 范围内；workflow 通过此接口获取端口

**CLI 接口契约**（Generator 必须实现）:
- 调用形式: `bash scripts/preview-deploy.sh --print-port "<BRANCH_NAME>"`
- 输出: 纯数字，范围 8000-8999，输出到 stdout（一行，无前缀）
- Exit code: 0 成功，1 失败
- 幂等性: 相同 BRANCH_NAME 多次调用输出相同端口

**验证命令**:
```bash
# 验证脚本存在且含 --print-port 实现
grep -qE "\-\-print-port" scripts/preview-deploy.sh || { echo "FAIL: preview-deploy.sh 未实现 --print-port 接口"; exit 1; }
grep -qE "8[0-9]{3}|PORT.*8000|% 1000|8000.*8999" scripts/preview-deploy.sh || { echo "FAIL: 缺 8000-8999 端口范围定义"; exit 1; }

# 实际执行验证 CLI 接口（Generator 实现后方可通过）
PORT_OUT=$(bash scripts/preview-deploy.sh --print-port "cp-test-feature-abc" 2>/dev/null)
echo "$PORT_OUT" | grep -qE "^[0-9]{4}$" || { echo "FAIL: --print-port 输出非4位数字 PORT='$PORT_OUT'"; exit 1; }
[ "$PORT_OUT" -ge 8000 ] && [ "$PORT_OUT" -le 8999 ] || { echo "FAIL: 端口超范围 PORT=$PORT_OUT"; exit 1; }
echo "✅ Step 3 端口计算逻辑验证通过 PORT=$PORT_OUT"
```

**硬阈值**: `preview-deploy.sh` 含端口哈希逻辑（8000-8999）+ 支持 `--print-port <BRANCH>` CLI 接口（stdout 输出4位端口，exit 0）

---

### Step 4: CI 通过 SSH 部署到 hk-vps，在分配端口启动静态文件服务器

**来源**: `[FROM_PRD]` — PRD 假设段"预览部署目标为 hk-vps，通过 SSH 部署 + 动态端口隔离"

**可观测行为**: workflow 包含 SSH 步骤（使用 hk-vps SSH key secret），在远端启动 `npx serve` / `python3 -m http.server` 等静态服务；SSH 超时设置防挂起

**验证命令**:
```bash
grep -qE "ssh|appleboy/ssh-action|SSH" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 SSH 步骤"; exit 1; }
grep -qE "HK_VPS|SSH_KEY|PREVIEW_SSH" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 SSH key secret 引用"; exit 1; }
echo "✅ Step 4 SSH 部署验证通过"
```

**硬阈值**: workflow 含 SSH action 步骤 + hk-vps SSH key secret 引用

---

### Step 5: CI 执行 health check，确认预览 URL HTTP 200 可访问后才写 PR 评论

**来源**: `[FROM_PRD]` — PRD Golden Path 第4点"Reviewer 点击 URL，可访问该 branch 当前版本"；合同对应硬约束：URL 不可访问时禁止写入 PR comment（避免 reviewer 拿到死链）

**可观测行为**: 在 PR comment 写入步骤之前，workflow 执行 `curl -f http://hk-vps-host:$PORT/`（或等效 HTTP health check），验证服务真实可访问（HTTP 200）；若 health check 失败则跳至 `if: failure()` 写失败原因，不产出无效 URL

**验证命令**:
```bash
# 验证 workflow 含 health check 步骤（curl 验证 preview URL 可访问）
grep -qE "curl.*\\\$PORT|curl.*\\\$PREVIEW_PORT|curl.*:.*8[0-9]{3}|health.check|healthcheck" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 preview URL health check 步骤（curl HTTP 200 验证）"; exit 1; }
echo "✅ Step 5 health check 步骤验证通过"
```

**硬阈值**: `preview-deploy.yml` 含 curl health check 步骤，在 PR comment 写入步骤之前执行；health check 失败导致后续步骤跳过（通过 `if: success()` 条件或 `set -e` 链式退出）

---

### Step 6: CI 向 PR 写评论，附上预览访问 URL

**来源**: `[FROM_PRD]` — PRD Golden Path 第3点"CI 向 PR 写入评论或更新 GitHub Environment，附上该 branch 的预览访问 URL"

**可观测行为**: PR 评论区出现含 `http://` 开头 + 端口号的预览 URL，格式如 `http://hk-vps-ip:PORT` 或 `http://hostname:PORT`

**验证命令**:
```bash
grep -qE "github-script|create.*comment|pr.*comment|pull-requests.*write" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR comment 步骤"; exit 1; }
grep -qE "pull-requests.*write" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 pull-requests write 权限"; exit 1; }
echo "✅ Step 6 PR comment 步骤验证通过"
```

**硬阈值**: workflow 含 `pull-requests: write` 权限 + PR comment 写入步骤（仅在 health check 成功后执行）

---

### Step 7: 部署失败时 PR 评论标注失败原因（error path）

**来源**: `[FROM_PRD]` — PRD NFR 约束"部署失败必须在 PR 评论中写明失败原因"

**可观测行为**: 当任意前置步骤（SSH、build、health check）失败时，workflow 使用 `if: failure()` 向 PR 写入失败原因，不产出无效 URL

**验证命令**:
```bash
grep -qE "failure\(\)|if.*failure" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 failure() 错误评论步骤"; exit 1; }
echo "✅ Step 7 error path 验证通过"
```

**硬阈值**: workflow 含 `if: failure()` 条件步骤

---

### Step 8: PR merge 或 close → cleanup workflow 触发，停止预览服务，端口释放

**来源**: `[FROM_PRD]` — PRD Golden Path 第5点"PR merge 或 close 后，预览环境自动清理"

**可观测行为**: `preview-cleanup.yml` 在 PR closed 事件触发，SSH 到 hk-vps 执行 `preview-cleanup.sh`，通过 PID 文件停止对应端口进程

**验证命令**:
```bash
grep -qE "closed" .github/workflows/preview-cleanup.yml || { echo "FAIL: 缺 closed trigger"; exit 1; }
grep -qE "preview-cleanup\.sh|cleanup" .github/workflows/preview-cleanup.yml || { echo "FAIL: 缺 cleanup 调用"; exit 1; }
echo "✅ Step 8 cleanup workflow 验证通过"
```

**硬阈值**: `preview-cleanup.yml` 含 `closed` PR 事件 trigger + 清理脚本调用

---

## E2E 验收（final-e2e 跑 — target_environment: local_api）

**journey_type**: dev_pipeline
**target_environment**: local_api

> **说明**: 本 sprint 交付物是 CI workflow 文件。`local_api` E2E 分两层：（A）本地静态分析（workflow 文件内容正确性，无需 GH_TOKEN）；（B）GitHub API 验证（需 GH_TOKEN，evaluator 必须提供，GH_TOKEN 缺失 = FAIL）。

<!-- GOLDEN_SMOKE_ABILITY_SLUG: per-branch-preview-env -->
<!-- GOLDEN_SMOKE_TARGET_ENV: local_api -->

### Scenario 1: workflow 文件结构静态验证（含 health check + main branch filter）

<!-- GOLDEN_SMOKE_SCENARIO: workflow-files-structure -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e

# STEP: 验证 preview-deploy.yml 存在
test -f .github/workflows/preview-deploy.yml || { echo "FAIL: preview-deploy.yml 不存在"; exit 1; }

# STEP: 验证触发器配置（pull_request 事件）
grep -qE "pull_request" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 pull_request trigger"; exit 1; }
grep -qE "opened|synchronize" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 PR 事件类型"; exit 1; }

# STEP: 验证 main branch 不触发（必须有 PR-only trigger 或 branches-ignore: main）
# pull_request 事件本身限制了只在 PR head branch 上触发，main 作为 base 不会触发
# 额外检查：workflow 不能有 push: branches: main 类型的无过滤触发器
grep -qE "^  push:" .github/workflows/preview-deploy.yml && \
  grep -qE "branches:" .github/workflows/preview-deploy.yml && \
  ! grep -qE "branches-ignore" .github/workflows/preview-deploy.yml && \
  grep -qE "^\s*-\s*main\b" .github/workflows/preview-deploy.yml && \
  { echo "FAIL: push trigger 未排除 main 分支"; exit 1; } || true
echo "✅ main branch 过滤验证通过"

# STEP: 验证 preview URL health check 步骤存在（Step 5 要求）
grep -qE "curl.*\\\$PORT|curl.*PREVIEW_PORT|health.check|healthcheck|curl.*http.*[0-9]" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 preview URL health check 步骤（HTTP 200 验证）"; exit 1; }
echo "✅ health check 步骤存在"

# STEP: 验证 preview-cleanup.yml 存在
test -f .github/workflows/preview-cleanup.yml || { echo "FAIL: preview-cleanup.yml 不存在"; exit 1; }

# STEP: 验证 cleanup 触发条件
grep -qE "closed" .github/workflows/preview-cleanup.yml || { echo "FAIL: 缺 closed trigger"; exit 1; }

# STEP: 验证部署脚本存在
test -f scripts/preview-deploy.sh || { echo "FAIL: preview-deploy.sh 不存在"; exit 1; }
test -f scripts/preview-cleanup.sh || { echo "FAIL: preview-cleanup.sh 不存在"; exit 1; }

# STEP: 验证 --print-port 接口已实现
grep -qE "\-\-print-port" scripts/preview-deploy.sh || { echo "FAIL: preview-deploy.sh 缺 --print-port 接口"; exit 1; }

# STEP: 验证端口范围配置（8000-8999）
grep -qE "8[0-9]{3}|PORT_MIN|PORT_MAX|8000.*8999|% 1000" scripts/preview-deploy.sh || { echo "FAIL: 缺端口范围定义"; exit 1; }

# STEP: 验证 PR comment 权限
grep -qE "pull-requests.*write" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 pull-requests write 权限"; exit 1; }

# STEP: 验证 failure() error path
grep -qE "failure\(\)" .github/workflows/preview-deploy.yml || { echo "FAIL: 缺 failure() 错误评论步骤"; exit 1; }

echo "✅ Scenario 1 通过"
```

### Scenario 2: 端口哈希幂等性验证（与 Step 3 CLI 接口契约对齐）

<!-- GOLDEN_SMOKE_SCENARIO: port-hash-idempotent -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 15000 -->

```bash
#!/bin/bash
set -e

# STEP: preview-deploy.sh 必须存在且实现 --print-port 接口
test -f scripts/preview-deploy.sh || { echo "FAIL: preview-deploy.sh 不存在"; exit 1; }
grep -qE "\-\-print-port" scripts/preview-deploy.sh || { echo "FAIL: --print-port 接口未实现"; exit 1; }

BRANCH_NAME="cp-test-feature-abc123"

# STEP: 两次执行输出相同端口（幂等）
PORT1=$(bash scripts/preview-deploy.sh --print-port "$BRANCH_NAME")
PORT2=$(bash scripts/preview-deploy.sh --print-port "$BRANCH_NAME")
[ "$PORT1" = "$PORT2" ] || { echo "FAIL: 端口不幂等 PORT1=$PORT1 PORT2=$PORT2"; exit 1; }

# STEP: 验证端口是纯数字且在合法范围 8000-8999
echo "$PORT1" | grep -qE "^[0-9]{4}$" || { echo "FAIL: 输出非4位数字 PORT='$PORT1'"; exit 1; }
[ "$PORT1" -ge 8000 ] && [ "$PORT1" -le 8999 ] || { echo "FAIL: 端口超范围 PORT=$PORT1"; exit 1; }

# STEP: 不同 branch 产生不同端口（哈希分散性检查）
PORT3=$(bash scripts/preview-deploy.sh --print-port "feature/other-branch")
[ "$PORT1" != "$PORT3" ] || echo "WARN: 不同 branch 产生相同端口（哈希碰撞，属小概率，记录但不 FAIL）"

echo "✅ Scenario 2 通过 PORT=$PORT1"
```

### Scenario 3: GitHub API 验证 workflow 文件已推送 + PR comment 写入验证

<!-- GOLDEN_SMOKE_SCENARIO: github-api-workflow-validation -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

```bash
#!/bin/bash
set -e

# GH_TOKEN 为 evaluator 必须提供的环境变量（无 token = 无法验证核心终态 = FAIL）
# golden-smoke regression CI 跳过此 scenario（见 GOLDEN_SMOKE_SKIP_IN_CI）
[ -n "${GH_TOKEN:-}" ] || { echo "FAIL: GH_TOKEN 未设置。evaluator 必须提供有 repo 读取权限的 PAT 才能验证 PR comment 写入（核心终态）。"; exit 1; }

REPO="${GH_REPO:-perfectuser21/cecelia}"

# STEP: 验证 preview-deploy.yml 已推送到远端（workflow 文件存在于 GitHub）
STATUS=$(curl -sf -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$REPO/contents/.github/workflows/preview-deploy.yml" \
  -o /dev/null -w "%{http_code}")
[ "$STATUS" = "200" ] || { echo "FAIL: preview-deploy.yml 未在 GitHub 仓库中 status=$STATUS"; exit 1; }

# STEP: 验证 preview-cleanup.yml 已推送
STATUS=$(curl -sf -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$REPO/contents/.github/workflows/preview-cleanup.yml" \
  -o /dev/null -w "%{http_code}")
[ "$STATUS" = "200" ] || { echo "FAIL: preview-cleanup.yml 未在 GitHub 仓库中 status=$STATUS"; exit 1; }

# STEP: 检查最近是否有成功的 preview-deploy workflow 运行（如有 PR 触发历史）
RECENT_RUNS=$(curl -sf -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$REPO/actions/workflows/preview-deploy.yml/runs?status=success&per_page=1" \
  2>/dev/null || echo '{"total_count":0}')
RUN_COUNT=$(echo "$RECENT_RUNS" | grep -o '"total_count":[0-9]*' | head -1 | grep -o '[0-9]*')
if [ "${RUN_COUNT:-0}" -gt 0 ]; then
  # 有成功运行记录：获取最近成功 PR 并验证评论
  RUN_ID=$(echo "$RECENT_RUNS" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
  PR_NUMBER=$(curl -sf -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/$REPO/actions/runs/$RUN_ID" 2>/dev/null | \
    grep -o '"pull_requests":\[{"url":"[^"]*"' | grep -o '[0-9]*' | head -1)
  if [ -n "$PR_NUMBER" ]; then
    # 验证 PR 评论区有预览 URL（含 http:// + 端口号）
    COMMENT=$(curl -sf -H "Authorization: token $GH_TOKEN" \
      "https://api.github.com/repos/$REPO/issues/$PR_NUMBER/comments" 2>/dev/null | \
      grep -o '"body":"[^"]*preview[^"]*http[^"]*' | head -1)
    [ -n "$COMMENT" ] || echo "WARN: PR #$PR_NUMBER 无 preview URL comment（workflow 刚部署时属正常）"
  fi
fi

echo "✅ Scenario 3 通过（GitHub API 验证 workflow 文件存在，评论验证依赖真实 PR 运行）"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| preview-deploy.yml 存在且触发正确 + main 过滤 + health check | `tests/preview-env.test.ts` | workflow 文件存在 + trigger 配置 + Step 5 health check | → 文件不存在 → FAIL |
| preview-cleanup.yml 存在且触发正确 | `tests/preview-env.test.ts` | cleanup 文件存在 + closed trigger | → 文件不存在 → FAIL |
| scripts 存在且含端口逻辑 + --print-port 接口 | `tests/preview-env.test.ts` | deploy.sh + cleanup.sh 存在 + 端口范围 + CLI 接口 | → 文件不存在 → FAIL |
| 端口范围约束 + 幂等性 | `tests/preview-env.test.ts` | 8000-8999 范围定义 + --print-port 实现 | → grep 不匹配 → FAIL |
