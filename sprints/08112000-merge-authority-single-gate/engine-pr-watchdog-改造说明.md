# 通道 3 改造说明 — engine-pr-watchdog 先问归属再 auto-merge

> 本文件为**产出物**（本 PR 不修改 zenithjoy-skills 仓库）。供后续在 zenithjoy-skills 单独实施。
> 在其改造前，本 sprint 的 `harness-judge` required check 即可兜住通道 3：即使 watchdog 误启
> `gh pr merge --auto`，GitHub 也会因 harness-owned PR 的 harness-judge check 非 success 而排队不合并。

## 现状（事故根因）

`zenithjoy-skills/engine-pr-watchdog/SKILL.md:105`：

```bash
gh pr merge "$PR_NUMBER" --repo "$REPO" --auto --squash
```

对**任何 CI 转绿的 PR** 启用 GitHub 原生 auto-merge，**不读标题、不查 harness 裁决**。
2026-08-10 实证：PR #4759（run 5f74a795，hop 9 judge FAIL、决策链无 merge_pr 动作）仍被合并。

## 改造要求

在执行 `gh pr merge ... --auto` **之前**先向 Brain 求证归属：

```bash
# 伪代码（zenithjoy-skills 实施时按其 shell 风格落地）
OWNED=$(curl -s -m 5 "${BRAIN_URL}/api/brain/harness/pr-ownership?branch=${HEAD_BRANCH}" \
          | jq -r '.owned // empty' 2>/dev/null)
if [ "$OWNED" = "true" ] || [ -z "$OWNED" ]; then
  # harness-owned 或 Brain 异常(fail-closed) → 不启用 auto-merge，只轮询等待 kernel 自行合并
  echo "SKIP auto-merge: harness-owned or brain-unreachable (fail-closed)"
else
  gh pr merge "$PR_NUMBER" --repo "$REPO" --auto --squash
fi
```

**硬规则**（与本 sprint 通道 1 一致）：
- 归属只凭 Brain `pr-ownership` 端点（读 `initiative_runs.pr_url`/`pr_branch`，kernel 写入），禁用标题/分支正则。
- fail-closed：Brain 不可达/超时/5xx/非法 JSON → 按 harness-owned 处理，不启用 auto-merge。
- 有限超时（`curl -m <秒>`）。

## 所需 Brain 端点契约（本 PR 已实现）

`GET /api/brain/harness/pr-ownership?branch=<head_ref>[&pr_url=<url>]`

响应（HTTP 200）：
```json
{"owned": true, "run_id": "<uuid|null>", "pr_url": "<string|null>", "matched_by": "pr_url|branch|null"}
```
- `owned=true` ⇔ 存在 `orchestrator_version='v2'` 且认领该 PR 的 initiative_run。
- 缺 `branch` 与 `pr_url` → HTTP 400 `{"error": "..."}`。
- 端点只读、幂等；watchdog 侧对任何非 200 一律按 `owned=true` fail-closed。
