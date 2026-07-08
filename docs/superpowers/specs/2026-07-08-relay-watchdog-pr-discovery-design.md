# relay watchdog PR 发现护栏 — 设计

## 问题
relay session（harness-controller）不回写 pr_url；watchdog 判死=容器消失；既有 "PR 已 MERGED 则收敛" 护栏（harness-relay-watchdog.js L113-143）只读 DB 三处 pr_url——全空则失明，直接走重点火。新 session 全新分支从头跑 → 同任务重复产出多个 PR（5d090237 实证：5 attempt / 4 个重复 open PR / 烧 5h 额度后 attempt_cap 熔断）。

## 修法（单点，最小改动）
在 `resumeStalledRelayRuns` headless 分支、容器消失且 `effectivePrUrl` 为空时，新增 GitHub 侧 PR 发现 `_discoverPrFromGithub(task, short, execFn)`：

1. **解析 repo**：`task.payload.base_repo` 匹配 `^https://github\.com/([^/]+/[^/]+?)(\.git)?/?$` → `owner/repo`；缺失或不匹配 → 返回 null（走原逻辑）。
2. **查 PR**：`gh pr list --repo <owner/repo> --state all --limit 50 --json headRefName,url,state`，JS 侧过滤 `headRefName.includes(short)`（short = task id 前 8 位无连字符；实证分支规约 `cp-*-ws-<short>` / `cp-*-<short>`）。
3. **裁决优先级**：
   - 命中 **MERGED** → 复用既有收敛路径：run 标 done + task 标 completed + 计 `out.mergedPr`；并回写 pr_url 到 run 行（留痕）。
   - 否则命中 **OPEN**（取第一条，gh 默认新→旧）→ 回写 pr_url 到该 initiative 未终态 v2 run 行 + `tasks.pr_url`，**跳过本轮重点火**（后续 scan 由既有 pr_url→MERGED 护栏接管）。
   - 只有 CLOSED 或无命中 → 返回 null，走原逻辑（attempt cap → 重点火）。
4. **gh 失败** → 保守跳过本轮（与既有 L138-142 catch 行为一致：宁可延迟恢复，不盲目重点火）。

## 不做的事（YAGNI）
- 不改 harness-controller skill（回写 pr_url / 接续已有分支属阶段二，另任务）
- 不接 orchestrator_heartbeat_at（当前 watchdog 判死不读它；接心跳属重构，另议）
- 不改 headed 分支（tmux 判死机制不同）

## 测试（mock pool + execFn + spawnFn 注入，无真实 DB/gh）
`packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js`：
1. 容器消失 + DB 无 pr_url + gh 返回含 short 的 OPEN PR → spawnFn 不被调 + run/tasks 回写 pr_url
2. gh 返回含 short 的 MERGED PR → run 标 done + task 标 completed，不重点火
3. gh 无匹配分支 → spawnFn 被调（原行为不回归）
4. base_repo 缺失/非 github URL → 不调 gh list，spawnFn 被调（原行为）
5. gh list 抛错 → 不重点火、不标 failed（保守跳过）

## 安全性论证
- 退化安全：发现失败/无命中 → 行为与今日完全一致
- 误收敛不可能：MERGED 裁决用 gh 真值，与既有 L121-137 同一真相源
- 误挂起有限：OPEN PR 命中后不再重点火——下轮 scan 走既有 pr_url 护栏（`gh pr view`）：MERGED → 收敛为 done；**OPEN → 本次修复已改为显式 continue 跳过重点火**（终审 Critical 修复前旧语义是落穿走重点火，导致跨轮重复点火出重复 PR）；CLOSED（工作被否决）→ 落穿走原逻辑允许重跑

## 版本
brain patch bump（1.243.x → +1），四处同步（check-version-sync.sh）。
