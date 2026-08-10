# 通道 3 改造说明 — engine-pr-watchdog 合并前先问归属

> 本文件是**产出物**（供后续在 `zenithjoy-skills` 仓库单独实施），本 PR **不修改** engine-pr-watchdog
> 本体（其源不在本 workspace）。在其改造落地前，本 sprint 引入的 `harness-judge` required check
> 已能兜住它——见文末「过渡期兜底」。

## 背景：为什么必须改通道 3

系统有三条互不知晓的 PR 合并通道，通道 3 是其中**此前未被识别、最严重**的一条：

`zenithjoy-skills/engine-pr-watchdog/SKILL.md:105`：

```bash
gh pr merge "$PR_NUMBER" --repo "$REPO" --auto --squash
```

它对**任何 CI 转绿的 PR** 启用 GitHub 原生 auto-merge，**不读标题、不查 harness 裁决**。
GitHub `--auto` 只等 required checks，与 harness kernel 的 mergeGate 无任何耦合。

实证绕过：PR #4759（分支 `cp-08101246-643b5302`，标题 `feat(harness): preview-reaper ...`）——
该标题被通道 1 正确 SKIP，其 run `5f74a795` 决策链中**不存在 merge_pr 动作**（kernel 从未合并它），
且 hop 9 `verdict:judge` 明确 **FAIL**（gear=hotfix 不产 sprint 测试，contract_tests=0 机械闸判死）。
该 PR 仍于 2026-08-10T08:42:52Z 被合并——**裁判说不放行，代码还是被 merge 了**。

任何「改判据」的方案对通道 3 都无效：它根本不看任何归属标记。

## 改造要求（在 zenithjoy-skills 仓库实施）

engine-pr-watchdog 在对某 PR 执行 `gh pr merge ... --auto` **之前**，必须先向 Brain 归属端点求证：

1. 取 PR head 分支名 `HEAD_BRANCH`（`gh pr view "$PR_NUMBER" --json headRefName -q .headRefName`）。
2. 求证归属：
   ```bash
   BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
   OWNED=$(curl -sS --max-time "${BRAIN_TIMEOUT:-8}" \
     "${BRAIN_URL}/api/brain/harness/pr-ownership?branch=${HEAD_BRANCH}" 2>/dev/null \
     | jq -r 'if (.owned|type)=="boolean" then (.owned|tostring) else "__err__" end' 2>/dev/null || echo "__err__")
   ```
3. 分支处理（与 should-auto-merge.sh 同一 fail-closed 语义）：
   - `OWNED=true`（harness-owned）→ **不启用 auto-merge**，只轮询等待 kernel 自行合并（kernel
     mergeGate 全过后置 `harness-judge=success` 并 merge）。
   - `OWNED=false`（非 harness 的手动 /dev PR）→ 照旧 `gh pr merge ... --auto`。
   - `OWNED=__err__`（Brain 不可达 / 超时 / 5xx / 非法 JSON）→ **fail-closed**：不启用 auto-merge，
     只轮询等待（宁可暂缓，绝不放行未裁决的 PR）。
4. `curl` 必须显式带 `--max-time`（Brain 挂起时防 watchdog 无限死等）。

## 所需 Brain 端点契约（本 PR 已实现，供通道 3 直接调用）

`GET /api/brain/harness/pr-ownership`

- Query（`branch` 与 `pr_url` 至少给一个）：
  - `pr_url`（可选，优先判据，精确匹配 `initiative_runs.pr_url`）
  - `branch`（可选，匹配 `tasks.payload->>'pr_branch'` 或 `pr_url LIKE %branch%`）
- 200：`{ "owned": bool, "run_id": uuid|null, "pr_url": string|null, "matched_by": "pr_url"|"branch"|null }`
  - `owned`：是否存在 `orchestrator_version='v2'` 的 initiative_run 认领此 PR（**只凭 kernel 写入
    的记录，非标题/分支正则**）。
- 400：`{ "error": "branch 或 pr_url 至少提供一个" }`
- 归属判定只读，无写路径；fail-closed 由**调用方**负责（端点异常返回 500，调用方按 owned 处理）。

## 过渡期兜底（本 PR 已生效，无需等通道 3 改造）

即使 engine-pr-watchdog 尚未改造、仍对 harness-owned PR 误启 `--auto`：harness-owned PR 上的
`harness-judge` required check 默认非 success（kernel 仅在 mergeGate 全过后置 success），GitHub 原生
`--auto` 只会**排队等待该 check**，不会强合。三条通道因此自然收敛到同一个闸——这正是本 sprint
「引入 required check 让 harness-owned PR 在裁判放行前物理上不可合并」的设计目的。
