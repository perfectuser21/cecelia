# Harness E2E 路由修复（6 Bug）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 harness E2E 调用链中的 6 个断点，使 ZenithJoy Final E2E 真正在 GitHub Actions windows-latest 上执行。

**Architecture:** 两个独立 repo 的修改：Cecelia（Brain 逻辑 + workflow skills）+ ZenithJoy（agent 版本 + 分支合并）。Cecelia 改动走完整 CI 流程；ZenithJoy 修改为 [CONFIG] 类型，改完直接合并。

**Tech Stack:** Node.js / vitest / LangGraph / GitHub Actions / bash

---

## 文件变更清单

| 文件 | 操作 | 改动说明 |
|------|------|----------|
| `packages/brain/src/workflows/harness-initiative.graph.js` | Modify line 1402 | Bug 1: 加 payload.target_environment fallback |
| `packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js` | Modify | Bug 1: 追加 payload fallback 测试 case |
| `packages/workflows/skills/harness-contract-proposer/SKILL.md` | Modify line ~305 | Bug 3: 加 Playwright dryrun 变体 B |
| `packages/workflows/skills/harness-evaluator/SKILL.md` | Modify line ~507 | Bug 4: 加 Step B-2.6 windows_cloud artifact 下载 |
| `~/.claude/skills/walking-skeleton/SKILL.md` | Modify lines 341-372 | Bug 2: 加 target_environment 字段（本地直改）|
| `~/.claude/skills/harness-contract-proposer/SKILL.md` | Modify | Bug 3: 与 packages/ 版本保持同步 |
| `/Users/administrator/perfect21/zenithjoy/services/agent/package.json` | Modify | Bug 5: version 1.1.26 → 1.1.27 |

---

## Task 1：Bug 1 — 写 payload fallback 的 failing test

**Repo:** Cecelia（工作目录：`/Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs`）

**Files:**
- Modify: `packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js`

- [ ] **Step 1: 追加 failing test case**

在 `packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js` 文件末尾追加以下内容（在最后一个 `describe` 块结束后）：

```js
// ─── payload.target_environment fallback（Bug 1 修复验证）─────────────────────

describe('finalEvaluateDispatchNode — payload.target_environment fallback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readBrainResult).mockResolvedValue({ verdict: 'PASS' });
  });

  it('prdContent 无 target_environment 但 payload 有时，使用 payload 值', async () => {
    const capturedEnv = {};
    const mockExecutor = vi.fn().mockImplementation(async (opts) => {
      Object.assign(capturedEnv, opts.env || {});
      return { exit_code: 0, timed_out: false, stderr: '' };
    });

    const state = {
      final_e2e_verdict: null,
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: {
        id: 'task-payload-fallback',
        payload: {
          sprint_dir: 'sprints/run-004',
          target_environment: 'windows_cloud',  // payload 有，prdContent 没有
        },
      },
      taskPlan: { journey_type: 'user_facing' },
      prdContent: '# Sprint PRD\n\n（无 target_environment 行）',
      worktreePath: '/tmp/wt-zenithjoy',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(capturedEnv.TARGET_ENV).toBe('windows_cloud');
  });

  it('prdContent 和 payload 都无 target_environment 时，默认 local_api', async () => {
    const capturedEnv = {};
    const mockExecutor = vi.fn().mockImplementation(async (opts) => {
      Object.assign(capturedEnv, opts.env || {});
      return { exit_code: 0, timed_out: false, stderr: '' };
    });

    const state = {
      final_e2e_verdict: null,
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: {
        id: 'task-no-env',
        payload: { sprint_dir: 'sprints/run-005' },  // payload 无 target_environment
      },
      taskPlan: { journey_type: 'autonomous' },
      prdContent: '# Sprint PRD',  // prdContent 也无
      worktreePath: '/tmp/wt-cecelia',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(capturedEnv.TARGET_ENV).toBe('local_api');
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs
npx vitest run packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js --reporter=verbose 2>&1 | tail -20
```

预期：`payload fallback` 的第一个 test case FAIL（因为当前代码没有 payload fallback，`TARGET_ENV` 会是 `local_api` 而不是 `windows_cloud`）。第二个 case 应该已经 PASS（`local_api` 默认值）。

- [ ] **Step 3: commit failing test**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs
git add packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js
git commit -m "test(brain): add failing test for finalEvaluateDispatchNode payload.target_environment fallback"
```

---

## Task 2：Bug 1 — 实现 payload fallback 让测试通过

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:1402`

- [ ] **Step 1: 修改 targetEnv 读取逻辑**

在 `packages/brain/src/workflows/harness-initiative.graph.js` 第 1402 行，将：

```js
  const targetEnv = (state.prdContent || '').match(/^##\s*target_environment:\s*(\S+)/m)?.[1] || 'local_api';
```

替换为：

```js
  const targetEnv = (state.prdContent || '').match(/^##\s*target_environment:\s*(\S+)/m)?.[1]
    || state.task?.payload?.target_environment
    || 'local_api';
```

- [ ] **Step 2: 运行测试确认全部 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs
npx vitest run packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js --reporter=verbose 2>&1 | tail -20
```

预期：所有 test case PASS（包括新增的 payload fallback case）。

- [ ] **Step 3: commit**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(brain): finalEvaluateDispatchNode 加 payload.target_environment fallback

当 prdContent 无 ## target_environment 行时（planner 推断失败），
回退读取 state.task.payload.target_environment。
ZenithJoy sprint 必须在 payload 显式传 windows_cloud 才能路由正确。"
```

---

## Task 3：Bug 3 — contract-proposer 加 Playwright dryrun 变体 B

**Files:**
- Modify: `packages/workflows/skills/harness-contract-proposer/SKILL.md`

- [ ] **Step 1: 在 windows_cloud 模板末尾（第 304 行 `---` 之后）插入变体 B**

找到 `packages/workflows/skills/harness-contract-proposer/SKILL.md` 中的这段文字（约 line 304）：

```
Stop-Process -Id $Proc.Id -Force
Write-Host "✅ windows_cloud E2E 验证通过 version=$InstalledVersion"
```
之后紧跟的 ` ``` ` 和 `---`，在 `---` **后面**追加以下内容：

```markdown

#### windows_cloud 变体 B：Playwright dryrun（ZenithJoy publisher 验证）

> 适用：sprint 目标是验证 `publish-{platform}-{type}-dryrun.cjs` 在 GitHub Actions windows-latest 上执行，非安装包交付。
> 典型场景：`zj-douyin-article-agent-port`、任何 publisher dryrun sprint。

**E2E 验收步骤（写入 `sprints/.../e2e-verify.ps1`）**：

```powershell
# final-e2e 验证脚本 — ZenithJoy publisher dryrun（windows-latest）
param(
  [string]$Platform = "{platform}",            # e.g. douyin
  [string]$PublishType = "{type}",             # e.g. article
  [string]$QueueJson = "$PSScriptRoot\test-queue.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. 安装依赖
Set-Location "$PSScriptRoot\..\.."
npm ci --prefer-offline 2>&1 | Select-Object -Last 5
npx playwright install chromium 2>&1 | Select-Object -Last 5

# 2. 创建测试队列文件
$queue = @([PSCustomObject]@{
  title   = "测试文章标题"
  content = "测试正文内容，用于 dryrun 验证。"
  cover   = ""
})
$queue | ConvertTo-Json -Depth 5 | Out-File -FilePath $QueueJson -Encoding utf8

# 3. 执行 dryrun 脚本
$scriptPath = "services\agent\publishers\$Platform-publisher\publish-$Platform-$PublishType-dryrun.cjs"
$output = node $scriptPath $QueueJson 2>&1
$lastLine = ($output | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)

if (-not $lastLine) {
  Write-Error "FAIL: 脚本无 JSON 输出"
  exit 1
}

$result = $lastLine | ConvertFrom-Json
if (-not $result.ok -or -not $result.dryRun) {
  Write-Error "FAIL: ok=$($result.ok) dryRun=$($result.dryRun)"
  exit 1
}

Write-Host "✅ dryrun 验证通过: ok=$($result.ok) dryRun=$($result.dryRun)"
exit 0
```

**PASS 标准**：脚本 exit 0 + stdout JSON `ok:true, dryRun:true`  
**FAIL 标准**：exit 1 OR `ok:false` OR timeout 15min  
**GHA workflow**：`.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）

---
```

- [ ] **Step 2: 验证内容已写入**

```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('变体 B'))process.exit(1);console.log('✅ 变体 B 已存在')"
```

预期：`✅ 变体 B 已存在`

- [ ] **Step 3: 同步 ~/.claude/skills/ 版本**

```bash
cp packages/workflows/skills/harness-contract-proposer/SKILL.md \
   ~/.claude/skills/harness-contract-proposer/SKILL.md
echo "✅ ~/.claude/skills/harness-contract-proposer/SKILL.md 已同步"
```

- [ ] **Step 4: commit**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs
git add packages/workflows/skills/harness-contract-proposer/SKILL.md
git commit -m "[CONFIG] fix(harness-contract-proposer): 加 windows_cloud 变体 B — Playwright dryrun

现有模板是安装包验证（下载 exe），ZenithJoy publisher dryrun sprint 需要的是
直接执行 node dryrun 脚本，两者完全不同。变体 B 专为 dryrun 场景设计。"
```

---

## Task 4：Bug 4 — evaluator 加 Step B-2.6 windows_cloud artifact 下载

**Files:**
- Modify: `packages/workflows/skills/harness-evaluator/SKILL.md`

- [ ] **Step 1: 在 Step B-2.5 结束后（`---` 与 `#### Step B-3:` 之间）插入 B-2.6**

在 `packages/workflows/skills/harness-evaluator/SKILL.md` 中找到 `Step B-2.5` 代码块的结尾（约 line 506，紧跟在 B-2.5 的 `---` 分隔符之后，B-3 之前），插入以下内容：

精确定位：在这行之前插入：
```
#### Step B-3: 判断结果
```

插入内容：

```markdown
#### Step B-2.6: windows_cloud artifact 下载 + 视觉验证

```bash
if [[ "$TARGET_ENV" == "windows_cloud" ]]; then
  REPO="${GITHUB_REPO:-perfectuser21/zenithjoy-workspace}"
  WORKFLOW="${WINDOWS_CLOUD_WORKFLOW:-e2e-windows.yml}"

  # 获取最新 run ID（触发后等 10s 再查，避免拿到上一次 run）
  RUN_ID=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" \
    --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)

  if [[ -n "$RUN_ID" ]]; then
    # 下载 screenshots artifact（GHA workflow 需上传 artifact name="screenshots"）
    mkdir -p /tmp/windows-cloud-screenshots
    gh run download "$RUN_ID" \
      --repo "$REPO" \
      --name "screenshots" \
      --dir /tmp/windows-cloud-screenshots 2>/dev/null || true

    # evaluator 必须用 Read tool 读取每张 PNG，对照 DoD [BEHAVIOR:E2E] 逐一视觉确认：
    # - 截图是否展示了期望的界面元素？
    # - 操作结果是否与 DoD 描述一致？
    # 如有截图与期望不符 → 输出 FAIL，feedback 说明哪张图有问题
    ls /tmp/windows-cloud-screenshots/*.png 2>/dev/null | head -20
  fi

  SCREENSHOTS_JSON="[]"
fi
```

---

```

- [ ] **Step 2: 验证内容已写入**

```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('B-2.6'))process.exit(1);console.log('✅ B-2.6 已存在')"
```

预期：`✅ B-2.6 已存在`

- [ ] **Step 3: commit**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs
git add packages/workflows/skills/harness-evaluator/SKILL.md
git commit -m "[CONFIG] fix(harness-evaluator): 加 B-2.6 — windows_cloud artifact 下载 + 视觉验证

evaluator 在 windows_cloud 跑完后没有下载 GHA artifact，无法进行截图视觉验证。
B-2.6 在 B-2.5（mac_web 截图）平级位置处理 windows_cloud 的 artifact。"
```

---

## Task 5：Bug 2 — walking-skeleton SKILL.md 加 target_environment 字段

**Files:**
- Modify: `~/.claude/skills/walking-skeleton/SKILL.md`（本地直改，不进 Cecelia git）

- [ ] **Step 1: 在参数表格中加 target_environment 行**

在 `~/.claude/skills/walking-skeleton/SKILL.md` 中找到参数表格（约 line 341-347）：

```markdown
| `base_repo` | **上下文推断** | ZenithJoy 话题 → zenithjoy 路径；Cecelia 话题 → cecelia 路径；推断不出才问 |
```

在这行**之后**追加：

```markdown
| `target_environment` | **上下文推断** | ZenithJoy → `windows_cloud`；Cecelia web/Dashboard → `mac_web`；Cecelia Brain/API → `local_api` |
```

- [ ] **Step 2: 在 curl payload 中加 target_environment 字段**

找到 curl 命令的 payload 部分（约 line 364-373）：

```json
      \"base_repo\": \"<repo_path_if_not_cecelia>\"
```

在这行**之后**追加（注意 JSON 逗号在上一行末尾）：

改前：
```
      \"base_repo\": \"<repo_path_if_not_cecelia>\"
```

改后：
```
      \"base_repo\": \"<repo_path_if_not_cecelia>\",
      \"target_environment\": \"<windows_cloud|mac_web|local_api|linux_server>\"
```

- [ ] **Step 3: 验证文件已更新**

```bash
node -e "const c=require('fs').readFileSync(process.env.HOME+'/.claude/skills/walking-skeleton/SKILL.md','utf8');if(!c.includes('target_environment'))process.exit(1);console.log('✅ target_environment 字段已加入')"
```

预期：`✅ target_environment 字段已加入`

> 注：此文件不在 Cecelia git 中，直接应用，不需要 commit。

---

## Task 6：Bug 5 — ZenithJoy Agent 版本 bump 1.1.26 → 1.1.27

**Repo:** ZenithJoy（`/Users/administrator/perfect21/zenithjoy`）

**Files:**
- Modify: `services/agent/package.json`

- [ ] **Step 1: 修改版本号**

在 `/Users/administrator/perfect21/zenithjoy/services/agent/package.json` 中，将：

```json
  "version": "1.1.26",
```

改为：

```json
  "version": "1.1.27",
```

- [ ] **Step 2: 验证版本**

```bash
node -e "const v=require('/Users/administrator/perfect21/zenithjoy/services/agent/package.json').version;if(v!=='1.1.27')process.exit(1);console.log('✅ version='+v)"
```

预期：`✅ version=1.1.27`

- [ ] **Step 3: commit（在 ZenithJoy 的当前分支 cp-20260525-article-dryrun-fix 上）**

```bash
cd /Users/administrator/perfect21/zenithjoy
git add services/agent/package.json
git commit -m "fix(agent): bump version 1.1.26 → 1.1.27（含 article dryrun 脚本）

v1.1.26 install pack 从未打包（dist-installpack/ 仅有 v1.1.25）。
article dryrun 脚本是 v1.1.26 版本发布后才加入的，需要 v1.1.27 重打包。
实际 pack build（bash scripts/build-install-pack.sh）在 DoD 手动验证步骤执行。"
```

---

## Task 7：Bug 6 — 创建并合并 ZenithJoy PR

**Repo:** ZenithJoy（`/Users/administrator/perfect21/zenithjoy`）

- [ ] **Step 1: 检查 ZenithJoy 当前分支状态**

```bash
cd /Users/administrator/perfect21/zenithjoy && git status --short && git log --oneline -5
```

预期：分支 `cp-20260525-article-dryrun-fix`，最新 commit 包含 Task 6 的 version bump。

- [ ] **Step 2: 创建 PR**

```bash
cd /Users/administrator/perfect21/zenithjoy
gh pr create \
  --title "[CONFIG] fix(agent): article dryrun 修复 + version 1.1.27" \
  --base main \
  --body "$(cat <<'EOF'
## Summary

- 登录检测改用 DOM 内容检查（`扫码登录`/`验证码登录` 文字），防止 SPA 不跳 URL 漏检
- Step 1.5：从文章列表页导航到编辑器（点"写文章"或跳 `/create` URL）
- headless 模式：cookie/profile 改 `headless: true`（SSH 无 GUI 环境）
- Chromium binary 动态回退：`headless-shell.exe` → `chrome.exe`
- version bump 1.1.26 → 1.1.27（含 article dryrun 脚本的首次打包）

## Test plan
- [ ] verify: `services/agent/package.json` version === 1.1.27
- [ ] manual: `bash scripts/build-install-pack.sh` 在 Mac 上生成 v1.1.27 pack（DoD 手动步骤）
- [ ] manual: 确认 `dist-installpack/zenithjoy-agent-v1.1.27/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs` 存在

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: 合并 PR**

ZenithJoy 的 `[CONFIG]` PR 无需等完整 CI（CI 配置仅对 `feat:` 类型运行完整测试）。

```bash
cd /Users/administrator/perfect21/zenithjoy
gh pr merge --squash --auto
```

若 `--auto` 不可用（仓库未开启 auto-merge），直接 squash merge：

```bash
gh pr merge --squash
```

---

## Task 8：Cecelia PR — 最终 push + PR

**Repo:** Cecelia（工作目录：`/Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs`）

- [ ] **Step 1: 写 Learning 文件**

在 worktree 中创建 `docs/learnings/cp-0525070400-fix-harness-e2e-routing-bugs.md`：

```markdown
# Learning: Harness E2E 路由修复（6 Bug 批量）

**分支**: cp-0525070400-fix-harness-e2e-routing-bugs  
**日期**: 2026-05-25

### 根本原因

1. `finalEvaluateDispatchNode` 只从 prdContent 读 `target_environment`，payload 的显式值被忽略
2. walking-skeleton 点火 curl 从不传 `target_environment`，planner 推断失败就回退 local_api
3. contract-proposer 的 windows_cloud 模板只有"安装包验证"，没有 dryrun 脚本执行变体
4. evaluator 的 windows_cloud 分支不下载 GHA artifact，无视觉验证
5. ZenithJoy v1.1.26 install pack 从未打包（新脚本在打包之后才加入）
6. ZenithJoy article dryrun 修复分支未合并

### 下次预防

- [ ] 每次新增 target_environment 值时，同步检查 planner/proposer/evaluator/Brain 四处都有处理
- [ ] payload 显式字段永远比 prdContent 正则解析更可靠，优先 payload fallback
- [ ] windows_cloud sprint 首次创建时，先确认 e2e-windows.yml workflow 存在 + screenshots artifact 上传
- [ ] version bump 和 pack build 应在同一个 PR，不要只 bump 不 build
```

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs
git add docs/learnings/cp-0525070400-fix-harness-e2e-routing-bugs.md
git commit -m "docs: add learning for harness E2E routing bug fixes"
```

- [ ] **Step 2: push 分支**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs
git push -u origin cp-0525070400-fix-harness-e2e-routing-bugs
```

- [ ] **Step 3: 创建 PR**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs
gh pr create \
  --title "fix(brain): harness E2E 路由修复 — payload fallback + skill 变体 B + B-2.6" \
  --body "$(cat <<'EOF'
## Summary

- **Bug 1**: `finalEvaluateDispatchNode` 加 `state.task.payload.target_environment` fallback，确保 ZenithJoy sprint 即使 planner 推断失败也能路由到 windows_cloud
- **Bug 3**: harness-contract-proposer 加 `windows_cloud 变体 B`（Playwright dryrun），区别于现有的安装包验证模板
- **Bug 4**: harness-evaluator 加 Step B-2.6，在 windows_cloud 跑完后下载 GHA artifact + Read PNG 视觉验证

## DoD

- [x] `[BEHAVIOR]` test: `harness-initiative-windows-cloud-env.test.js` 新增 payload fallback 测试
- [x] `[ARTIFACT]` proposer 变体 B 内容：`manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('变体 B'))process.exit(1)"`
- [x] `[ARTIFACT]` evaluator B-2.6 内容：`manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('B-2.6'))process.exit(1)"`

## Test plan
- [ ] `npx vitest run packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js` 全 PASS
- [ ] 新增 payload fallback test case 验证 `windows_cloud` 正确注入 TARGET_ENV

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: 等 CI 完成**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-e2e-routing-bugs
gh pr checks --watch
```

预期：所有 CI jobs PASS。

---

## DoD 总汇

| Bug | DoD 条目 | 验证命令 |
|-----|----------|----------|
| Bug 1 | `[BEHAVIOR]` tests/ | `npx vitest run packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js` |
| Bug 2 | `[ARTIFACT]` walking-skeleton 本地 | `node -e "if(!require('fs').readFileSync(process.env.HOME+'/.claude/skills/walking-skeleton/SKILL.md','utf8').includes('target_environment'))process.exit(1)"` |
| Bug 3 | `[ARTIFACT]` proposer 变体 B | `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('变体 B'))process.exit(1)"` |
| Bug 4 | `[ARTIFACT]` evaluator B-2.6 | `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('B-2.6'))process.exit(1)"` |
| Bug 5 | `[ARTIFACT]` version 1.1.27 | `manual:node -e "const v=require('./services/agent/package.json').version;if(v!=='1.1.27')process.exit(1)"` |
| Bug 6 | git log | ZenithJoy main 包含 article dryrun commits |
