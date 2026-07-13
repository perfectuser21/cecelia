# Fix：skill-relay spawn 成功误标 task completed（ok 语义错配）+ 区段A 双 spawn 排雷

日期：2026-07-07 ｜ Issue：df107724（P1）｜ Task：e588ba5a ｜ Decision：e44edbfc

## 根因

`spawnSkillRelaySession` spawn 成功返回 `{ok:true, mode:'skill-relay', ...}`（harness-skill-relay.js:161），唯一生产调用方 executor.js:3285-3291 按 LangGraph 时代语义消费（`ok===null`→留 in_progress / truthy→completed / falsy→failed）→ 每个 relay 任务 spawn+1s 被假标 completed → harness-relay-watchdog house-keeping（task 终态→run 行收敛）把在跑 session 的 run 行标 done → relay 保护网（死后重点火、PR 核验）全失效。生产实证：task a3d61486（2026-07-07 09:05 spawn，09:05:23 completed，09:08 run 被 housekeep，容器全程在跑）。

## 修复范围（一个 PR，两处代码 + 测试）

### 1. executor.js harness_initiative 分支（根因修复）
`result.ok && result.mode === 'skill-relay'` → 打日志（session detached 在跑，完成态由 harness-report 回写）+ 不调 updateTaskStatus。`ok===null` / `ok:false` / LangGraph else-if 分支一字不动（兄弟测试 executor-harness-initiative-status-writeback.test.js 有 2000 字符窗口的代码形状断言，新分支插入位置注意余量，现余量约 1400 字符）。

### 2. harness-watchdog.js resumeStalledHarnessDrivers 区段A/B（回归排雷，Research Subagent REJECT→APPROVE 的必要条件）
留 in_progress 后，区段A（stale 20min 判定）对 relay 必然误判：relay 不写 driver_heartbeat_at、不更新 initiative_runs.updated_at（进度 PATCH 不 SET、无 trigger）、不写 initiative_run_events；planner 棒 >20min 是常态 → 活 session 被翻回 queued → dispatcher 重 claim → spawnSkillRelaySession 无 docker ps 去重守卫 → 同 worktree 双 relay session。
修法：区段A/B 的 SQL 加 `AND t.payload->>'orchestrator' IS DISTINCT FROM 'skill-relay'`（对齐 harness-initiative-patrol.js:195 的 v2 排除先例）。

## 备选已否决

- 改 spawnSkillRelaySession 返回 ok:null：watchdog 重点火路径（harness-relay-watchdog.js:151 `if (r?.ok)`）会误报 spawn 失败；ok:null 在 router 语义中另有含义（already_running skip）。
- 只改 watchdog housekeeping 不信 completed：治标，假 completed 状态仍在。

## 正常完成闭环（修后依赖，已验证存在）

harness-report Step 1 PATCH task completed（SKILL.md，失败必须 DONE_WITH_CONCERNS）；双保险：relay-watchdog 发现容器消失且 PR MERGED → 直接标 completed（harness-relay-watchdog.js:111-114）。

## 测试策略（integration 档，vitest，永久回归）

沿用 harness-initiative-executor-writeback.test.js 现有模式（模块级 vi.mock 工厂 + vi.resetModules + beforeEach 动态 import executor；updateTaskStatus 经 vi.mock('../task-updater.js') 转发）：
1. **新增（先写、先跑红）**：relay spawn 成功（vi.mock harness-skill-relay 返回 {ok:true, mode:'skill-relay', containerId}，task 带 payload.orchestrator='skill-relay'）→ 断言 dispatch 返回 success:true 且 mockUpdateTaskStatus 未以 'completed' 或 'failed' 被调用
2. **既有行为守护**：relay spawn 失败 {ok:false, mode:'skill-relay', error} → failed 照旧
3. **区段A 排除测试**：resumeStalledHarnessDrivers 注入 fake pool，断言对 payload.orchestrator='skill-relay' 的 stale 任务不翻 queued（非 relay 任务照翻，守护既有行为）
哨兵定性：纯逻辑接缝，CI test 即可；proven-to-fire = commit-1 亲眼跑红。

## 非目标（已登记跟踪，不进本 PR）

- deadline 逾期 task 级兜底缺口（scanStuckHarness 不扫 relay 中间态 phase 且从不回写 task → 逾期 relay 任务永卡 in_progress 占并发 cap）→ Notion Issue 另行登记（P2）
- spawn 失败回 queued（P2-9）、区段A对 relay 的"正确"stale 检测（活性信号接入）→ 属 builder sprint a3d61486 及二期范围

## 风险

- 与在跑 builder sprint a3d61486（改 harness-skill-relay.js）不同文件，无冲突；merge 先后由 rebase 解决
- 部署后生效需 brain-deploy 重建镜像（memory：容器跑镜像层快照）
