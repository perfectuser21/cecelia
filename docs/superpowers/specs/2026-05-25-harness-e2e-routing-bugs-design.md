# Design: Harness E2E 路由缺失修复（6 Bug 批量）

**日期**：2026-05-25  
**分支**：cp-0525070400-fix-harness-e2e-routing-bugs  
**优先级**：P1  

---

## 问题根因

ZenithJoy 所有 Harness sprint 的 Final E2E 从未在 Windows 环境执行。调用链：

```
walking-skeleton 点火
  → Brain harness_initiative 任务
    → finalEvaluateDispatchNode（读 prdContent.target_environment）
      → evaluator agent（TARGET_ENV 注入）
        → evaluator SKILL windows_cloud case（gh workflow run）
          → GitHub Actions windows-latest
```

链路中有 4 处断口（Bug 1-4）+ ZenithJoy Agent install pack 过期（Bug 5）+ 修复 PR 未合并（Bug 6）。

---

## Bug 列表与修复方案

### Bug 1：finalEvaluateDispatchNode 未读取 payload.target_environment

**文件**：`packages/brain/src/workflows/harness-initiative.graph.js`，line 1402  
**类型**：Cecelia PR（`fix:`）

**现状**：`targetEnv` 只从 `prdContent` 正则匹配读取，planner 未能推断时默认 `local_api`。

**修改**：
```js
// 前
const targetEnv = (state.prdContent || '').match(/^##\s*target_environment:\s*(\S+)/m)?.[1] || 'local_api';

// 后
const targetEnv = (state.prdContent || '').match(/^##\s*target_environment:\s*(\S+)/m)?.[1]
  || state.task?.payload?.target_environment
  || 'local_api';
```

**测试**：追加到 `packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js`：
- 新 case：`prdContent: null` + `payload.target_environment: 'windows_cloud'` → `capturedEnv.TARGET_ENV === 'windows_cloud'`

> 注：PRD 指向 `finalE2eNode`（line 1171）是错误的，该函数是死代码（未被 `buildHarnessFullGraph` 注册）。正确修改点是 `finalEvaluateDispatchNode`。

---

### Bug 2：walking-skeleton 点火 payload 缺 target_environment 字段

**文件**：`~/.claude/skills/walking-skeleton/SKILL.md`（本地 skill，不在 Cecelia git）  
**类型**：本地 skill 更新

参数表格（line 341 区域）加一行：
```markdown
| `target_environment` | **上下文推断** | ZenithJoy → `windows_cloud`；Cecelia web/Dashboard → `mac_web`；Cecelia Brain/API → `local_api` |
```

curl payload（line 365 区域）加一行：
```json
"target_environment": "<windows_cloud|mac_web|local_api|linux_server>"
```

---

### Bug 3：contract-proposer windows_cloud 模板不适合 dryrun 场景

**文件**：`packages/workflows/skills/harness-contract-proposer/SKILL.md` + `~/.claude/skills/harness-contract-proposer/SKILL.md`  
**类型**：Cecelia PR（`[CONFIG]`）

现有模板是"下载 .exe → 静默安装"，不适合 ZenithJoy publisher dryrun 验证。

在现有模板（`target_environment = windows_cloud`，line ~304）之后追加：

```markdown
#### windows_cloud 变体 B：Playwright dryrun（ZenithJoy publisher 验证）

> 适用：sprint 目标是验证 `publish-{platform}-{type}-dryrun.cjs` 在 GHA 上跑通，而非安装包交付

E2E 验收步骤：
1. `npm ci && npx playwright install chromium`
2. 创建测试 queue.json（含标题/正文/封面字段）
3. `node publish-{platform}-{type}-dryrun.cjs <queue.json>`
4. stdout 最后一行 JSON 含 `"ok":true, "dryRun":true`
5. `screenshots/*.png` 上传 GHA artifact（截图证据）

PASS 标准：exit 0 + stdout ok:true  
FAIL 标准：exit 1 OR ok:false OR timeout 15min  
GHA workflow 引用：`.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）
```

**DoD 验证**：`manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('变体 B'))process.exit(1)"`

---

### Bug 4：evaluator 无 windows_cloud artifact 下载步骤

**文件**：`packages/workflows/skills/harness-evaluator/SKILL.md`，在 Step B-2.5 之后（line ~504）  
**类型**：Cecelia PR（`[CONFIG]`）

追加 Step B-2.6：

```bash
#### Step B-2.6: windows_cloud artifact 下载 + 视觉验证

if [[ "$TARGET_ENV" == "windows_cloud" ]]; then
  REPO="${GITHUB_REPO:-perfectuser21/zenithjoy-workspace}"
  WORKFLOW="${WINDOWS_CLOUD_WORKFLOW:-e2e-windows.yml}"
  RUN_ID=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" \
    --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)
  if [[ -n "$RUN_ID" ]]; then
    mkdir -p /tmp/windows-cloud-screenshots
    gh run download "$RUN_ID" --repo "$REPO" \
      --name "screenshots" \
      --dir /tmp/windows-cloud-screenshots 2>/dev/null || true
    # evaluator 用 Read tool 读每张 PNG，对照 DoD [BEHAVIOR:E2E] 视觉确认
    ls /tmp/windows-cloud-screenshots/*.png 2>/dev/null | head -20
  fi
fi
```

**DoD 验证**：`manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('B-2.6'))process.exit(1)"`

---

### Bug 5：ZenithJoy Agent v1.1.26 pack 从未构建，缺 article dryrun 脚本

**文件**：`/Users/administrator/perfect21/zenithjoy/services/agent/package.json`  
**类型**：ZenithJoy PR（`fix:`）

- 将版本 `1.1.26` 升到 `1.1.27`
- `build-install-pack.sh` 已包含 `publishers/` 复制（PR #442 已加）
- 实际打包：`bash scripts/build-install-pack.sh`（需在 Mac 上运行，本次 PR 仅做 version bump）

---

### Bug 6：ZenithJoy 分支 cp-20260525-article-dryrun-fix 需建 PR 并合并

**操作**：
```bash
cd /Users/administrator/perfect21/zenithjoy
gh pr create --title "[CONFIG] fix(agent): article dryrun 4 fixes" --base main
gh pr merge --squash --auto
```

包含修复：登录检测（DOM 内容）、Step 1.5 编辑器导航、headless 模式、Chromium binary 回退。

---

## PR 结构

| PR | Repo | 分支 | 包含 Bug |
|----|------|------|----------|
| Cecelia PR | cecelia | cp-0525070400-fix-harness-e2e-routing-bugs | Bug 1, 3, 4 |
| Walking-skeleton | 本地直改 | 无 commit | Bug 2 |
| ZenithJoy PR | zenithjoy | cp-20260525-article-dryrun-fix | Bug 5, 6 |

---

## 测试策略

| Bug | 测试类型 | 方法 |
|-----|----------|------|
| Bug 1 | Unit test | 追加到 `harness-initiative-windows-cloud-env.test.js`，验证 payload fallback |
| Bug 2 | Manual | 点火一个 ZenithJoy sprint，确认 curl 请求体含 `target_environment` |
| Bug 3 | DoD node check | `manual:node -e "...includes('变体 B')..."` |
| Bug 4 | DoD node check | `manual:node -e "...includes('B-2.6')..."` |
| Bug 5 | DoD node check | `manual:node -e "...version === '1.1.27'..."` |
| Bug 6 | git log | `git log --oneline main | grep 'article dryrun'` |

---

## 文件变更清单

### Cecelia worktree
- `packages/brain/src/workflows/harness-initiative.graph.js`（line 1402）
- `packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js`（新增 test case）
- `packages/workflows/skills/harness-contract-proposer/SKILL.md`（Bug 3 变体 B）
- `packages/workflows/skills/harness-evaluator/SKILL.md`（Bug 4 Step B-2.6）

### 本地直改（不进 Cecelia git）
- `~/.claude/skills/walking-skeleton/SKILL.md`（Bug 2）
- `~/.claude/skills/harness-contract-proposer/SKILL.md`（与 packages/ 保持同步）

### ZenithJoy worktree
- `services/agent/package.json`（version bump）
