# 通道 3 改造说明：engine-pr-watchdog 先问归属再 auto-merge

> 交付物（PRD 范围限定第 4 条）。本 PR **不修改** zenithjoy-skills 源（不在 WORKSPACE_REPOSITORIES）；此文档供后续在 zenithjoy-skills 仓单独实施。在其落地前，本 sprint 引入的 `harness-judge` required check 即可兜住通道 3。

## 现状（漏洞）

`zenithjoy-skills/engine-pr-watchdog/SKILL.md:105`：

```bash
gh pr merge "$PR_NUMBER" --repo "$REPO" --auto --squash
```

对**任何 CI 转绿的 PR** 启用 GitHub 原生 auto-merge，**不读标题、不查 harness 裁决**。GitHub `--auto` 只等 required checks，与 kernel mergeGate 无耦合。实证：PR #4759（run 5f74a795，hop 9 judge=FAIL，决策链无 merge_pr）仍被强合——裁判说不放行，代码被 merge。

## 改造要求

在执行 `gh pr merge ... --auto` **之前**，先向 Brain 归属端点求证；harness-owned 则**不启用 auto-merge**，只轮询等待 kernel 自行合并。

```bash
# 改造后（伪代码，插在 gh pr merge --auto 之前）
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
resp=$(curl -sS --max-time 5 -w $'\n%{http_code}' \
  "$BRAIN_URL/api/brain/harness/pr-ownership?pr_number=$PR_NUMBER" 2>/dev/null) || resp=""
code=$(printf '%s' "$resp" | tail -n1)
body=$(printf '%s' "$resp" | sed '$d')
owned=$(printf '%s' "$body" | jq -r '.owned' 2>/dev/null || echo "")

# fail-closed：求证失败/超时/非 200/非法 JSON/owned 缺失 → 当 harness-owned 处理
if [ "$code" != "200" ] || { [ "$owned" != "true" ] && [ "$owned" != "false" ]; }; then
  echo "watchdog: 归属求证失败，fail-closed 视为 harness-owned，不启用 auto-merge，轮询等 kernel"
  owned="true"
fi

if [ "$owned" = "true" ]; then
  echo "watchdog: harness-owned PR #$PR_NUMBER，交 kernel mergeGate，仅轮询不 auto-merge"
  # 轮询 PR 状态直到 merged/closed，不调 gh pr merge --auto
else
  gh pr merge "$PR_NUMBER" --repo "$REPO" --auto --squash   # 手动 /dev PR 照旧
fi
```

## 所需 Brain 端点契约（本 PR 已交付）

`GET /api/brain/harness/pr-ownership?pr_number=<int>`

- 200 owned：`{"owned":true,"run_id":"<uuid>","pr_number":<int>,"reason":"matched initiative_runs.pr_url"}`
- 200 not_owned：`{"owned":false,"run_id":null,"pr_number":<int>,"reason":"no initiative_runs.pr_url matches"}`
- 400：`{"error":"pr_number must be a positive integer"}`
- 归属只凭 `initiative_runs.pr_url` 精确匹配 `/pull/<pr_number>` 结尾；不看标题/分支名。
- fail-closed 语义由**调用方**（脚本/watchdog）实现，端点本身如实回答。

## 兜底关系

通道 3 改造落地前，`harness-judge` required status check（本 PR：kernel mergeGate 全过才置 success，harness-owned PR 默认 pending）会让 GitHub `--auto` 排队等待，物理挡住绕过——这是三条通道自然收敛到同一裁决闸的关键，无需逐个改调用方即可先止血。
