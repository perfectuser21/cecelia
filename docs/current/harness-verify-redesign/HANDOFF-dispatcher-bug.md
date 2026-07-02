# HANDOFF — Harness dispatcher 死锁 bug（fabf6bd6）（2026-07-02）

> 新会话从这里接手。全部上下文自包含，不需要翻旧对话。

## 0. 一句话

修 Notion issue **fabf6bd6**：`harness_initiative` 任务 claim 成功后 graph 没真正跑起来，僵尸 `in_progress` 占死并发槽，还豁免 zombie-reaper 清理 → **永久死锁所有 headless harness 派发**，现在只能靠本机 interactive `/dev` 顶着，不能用 headless 并行。

这是 `docs/current/harness-verify-redesign/HANDOFF.md`（Brain 验证模型重构交接）里"下一步优先级"第 1 项，唯一没修的 bug（另一个"Brain 版本三处漂移"已在 PR #3498 + #3500 修完）。

## 1. 前情：为什么现在轮到这个 bug

`HANDOFF.md` 记录的 8 处 harness 修复地图（A1/A2/A3/B1/C1/D1/E1/E2）里，B1、E2 已合并；A1/A3 之后要做，但都依赖 P0 端点先补上。这两个都不阻塞——阻塞的是这条 dispatcher 死锁：只要它不修，**headless 派发用不了**，所有 harness 相关工作都被迫走本机人肉 `/dev`，效率很差，且没法验证 headless 链路本身是否正常。修完这个才能腾出手做 A1/A3。

## 2. 症状（Notion issue fabf6bd6 原文）

> 现象：POST `harness_initiative` 任务后 `status=in_progress`，`claimed_by=brain-tick-7`，但 `initiative_runs=0`、无进程、无 graph 日志、`updated_at` 冻结。
>
> 根因：dispatcher 原子 claim 成功后，graph 执行没有真正 kick off；这个僵尸 `in_progress` 占死 `MAX_CONCURRENT=2` 并发槽，而 `harness_initiative` 这类任务豁免 zombie-reaper（原意是怕长跑任务被误杀）→ 永久死锁全部 harness 派发。
>
> 旁证：运行中的 brain 有 schema drift（`consciousness-graph` 缺 `retry_count` 列 / `initiative_runs` 列不符预期），怀疑 staging brain 镜像没跟上最新代码。
>
> 同类历史坑：`docs/superpowers`（或 memory）里的 `harness-initiative-resume-checkpoint-bug`（resume 三陷阱：stale `claimed_by` / `deadline_at` 过期 / `contract-draft.md` git pull 丢失）——性质类似（claim 状态和实际执行状态脱节），修的时候可以对照。
>
> 复现记录：2026-07-01，task_id `bd7e251c` / `99c7fe0c`（可在 Brain DB 里查这两个任务的历史状态变迁）。
>
> 临时处置（不是修复）：`PATCH status=failed` 手动释放槽位。

**待修 3 点（issue 里明确列出的）：**
1. claim 后 spawn graph 失败，必须释放 claim 并标记 `failed`，不能停留在 `in_progress`
2. zombie-reaper 对"真卡死"的 harness 任务不应该无条件豁免（现在的豁免逻辑太粗，把"长跑中"和"卡死"混为一谈）
3. 重建 staging brain 镜像消除 schema drift（怀疑是根因的放大器，不一定是根本原因）

## 3. 第一步该做什么（这是 bug，走 /dev 路径 A）

**不要直接开始改代码。** 先走 `superpowers:systematic-debugging` 的 Phase 1（根因调查），这个 bug **目前还没有确认根因**，issue 里只是"疑似"（"疑 staging brain 镜像未跟上代码"是猜测，没验证）。

建议的调查顺序：

1. **先确认 dispatcher claim 之后 spawn 的代码路径**：
   - 找 `packages/brain/src/` 里处理 `harness_initiative` 任务类型的 dispatcher/tick 逻辑（关键词：`claim`、`harness_initiative`、`initiative_runs`、`MAX_CONCURRENT`）
   - 确认"claim 成功"和"spawn graph 进程/协程"之间是不是原子的——如果中间有 await/异步边界，那段代码抛错会不会被吞掉（没有 try/catch 释放 claim）
2. **复现**：本机能不能人为触发一次 claim 后 spawn 失败（比如给 graph 入口函数打断点/临时抛错），观察任务是否真的卡在 `in_progress` 且不被 zombie-reaper 清理
3. **验证 schema drift 猜测**：对比本机 brain 实际连的 DB schema（`\d consciousness-graph` / `\d initiative_runs`）与代码里 migration 定义的最新 schema，看 `retry_count` 列是否真的缺失——**这个可以先查，5 分钟内出结论，不要靠猜**
4. **查 zombie-reaper 豁免逻辑**：找豁免 `harness_initiative` 的那行代码，理解原本设计意图（怕长跑任务被杀），然后想清楚"怎么区分长跑 vs 真卡死"（比如：有没有心跳/进度更新时间戳可以用，而不是简单按 task_type 整体豁免）

必须先做完 Phase 1（根因），拿到确定性证据，再进 Phase 2/3/4（写 failing test → 修复）。**不要一上来就写"释放 claim"的代码**——issue 里列的 3 点是症状描述里带的建议方向，不是确认过的修法，需要自己走一遍调查再定。

## 4. 关键 ground truth（复用上一任务验证过的经验，直接抄）

- **改代码只能走 `/dev`**（铁律，禁 Agent 直接改推）；Brain 改动前必须过 DevGate：
  ```bash
  node scripts/facts-check.mjs
  bash scripts/check-version-sync.sh
  ```
  这两个现在都是绿的（刚修完），如果又红了，说明这次改动引入了新的版本/文档不一致，顺手修掉。
- **Brain 生产容器经常没启动**：本机用 `docker compose up -d node-brain` 才能让 `localhost:5221` 有响应；只有 `cecelia-node-brain-staging`（review-env 用的）跑着不代表主 Brain 活着。每次新会话先 `curl -s localhost:5221/api/brain/context` 探活，000/连不上就先 `docker compose up -d node-brain`。
- **worktree 里 Bash cwd 每次调用重置回主仓库**，worktree 里操作每条命令都要 `cd <worktree> &&`。
- **worktree 里没有 node_modules**，跑 vitest 前先 `npm install --no-audit --no-fund`（根 workspace 一次装全，几秒钟）。
- **分支命名必须是 `cp-XXXXXXXX-task-name`**（8 或 10 位时间戳），CI 有 `branch-naming` job 硬卡，用 `cp-$(TZ=Asia/Shanghai date +%m%d%H%M)-xxx` 生成，不要手动瞎起短名字（踩过一次，浪费一轮 PR）。
- **push 会触发 pre-push hook 跑 quickcheck.sh**（typecheck+lint+test，可能 5-10 分钟），必须 `run_in_background: true` 起 push，否则会卡住 2 分钟 Bash 超时；起完之后等通知，不要 sleep 轮询。
- **`gh pr checks` 有时会混进同一 commit SHA 下其他（已关闭）PR 的旧 run**，如果看到不认识的 job（比如 `Cleanup Preview Environment`、来自另一个 run id 的 `ci-passed`），先用 `gh run list --branch <当前分支名> --json databaseId,name,status,conclusion,headSha` 确认真正属于当前 PR 的 run id，再过滤判断是否真的挡合并。
- **PR 合并流程**：开完 PR 后 hook 会强制要求立刻调用 `Skill({"skill":"engine-pr-watchdog"})` 阻塞轮询到合并，中途禁止 `ScheduleWakeup`、禁止后台执行轮询循环本身（push/rebase 除外可以 background）。
- **绝对不能在 main 分支 git add/commit**（哪怕是纯文档改动也要开分支）——这条踩过一次坑，切记。

## 5. 如何恢复（新会话第一条命令）

```bash
# 1. 探活 Brain，没反应就拉起来
curl -s --max-time 3 localhost:5221/api/brain/context | head -c 200 || docker compose -f /Users/administrator/perfect21/cecelia/docker-compose.yml up -d node-brain

# 2. 重新拉这个 bug 的最新状态（可能中途已被其他会话处理过）
curl -s "localhost:5221/api/brain/issues?limit=20" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for i in d.get('issues',[]):
    if 'fabf6bd6' in i['id']:
        print(i['status'], '-', i['title'])
"

# 3. 确认 DevGate 现状（应全绿，若红说明有别的改动漏了同步）
cd /Users/administrator/perfect21/cecelia && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh
```

然后按第 3 节的顺序走 `superpowers:systematic-debugging` Phase 1，不要跳过直接写修复代码。

## 6. 完成标志

- [ ] 根因确认（不是"疑似"，是"验证过"）
- [ ] 有一个能复现"claim 后卡死"场景的 failing test，先 commit
- [ ] 修复让 test 变绿：至少覆盖 issue 里的 3 点（释放 claim / zombie-reaper 精细化 / schema drift 消除，视根因调查结果调整范围）
- [ ] 本机真实跑一次 `harness_initiative` 任务，观察它不再卡死在 `in_progress`（proven-to-fire：故意制造一次 spawn 失败，看到它被正确标记 failed 并释放槽位）
- [ ] Notion issue fabf6bd6 状态改成 Closed，附 PR 链接
- [ ] `docs/current/harness-verify-redesign/HANDOFF.md` 第 5 节"下一步"更新，标记这个 bug 已修
