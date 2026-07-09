# Handoff：并发撞车全天排查 + 三处修复 + 待办根因（会话终态）

task_id: unknown（跨多个子任务的会话级 handoff，非单一 Brain task）
verdict: PASS（本会话内已合并部分）+ 明确待办（API 层去重未做）

## 背景 / 最初目标

主理人在处理一个"补齐 task/issue 创建入口 journey_id 写入"的小改动任务时，发现同一个任务被 4 个独立并发 session 各自实现了一遍（4 个几乎相同的 PR）。追查过程中层层剥出一整天的并发/去重系统性问题，从"单次撞车"一路挖到"API 层完全没有去重护栏"这个更深的根因。

## 完成（本会话内，均已合并）

1. **journey_id 数据缺口修复**：`POST /tasks` 顶层 journey_id 合并进 payload、`issues` 表加 journey_id 列、warroom 全景图查询修复真实列。**PR #3661（cecelia，已合并）**。过程中发现并关闭了 3 个重复实现（#3658/#3659/#3660），第 4 个重复（#3662）在稍后的清理中一并关闭。

2. **`/dev` skill 加 Phase 2.5「GitHub 撞车检查」**：路径 A/B/C 动手写代码前，先 `gh pr list --search` 查有没有人已经在做同一件事；接近可合并就认领，stale/冲突/CI真失败就先关旧的再做。**PR #116（zenithjoy-skills，已合并）**。

3. **`/dev` skill 加 Phase 0「--task-id 立即 claim」**：起因是同一个 task（f30dace8，session resume 孤儿 worktree 自愈 bug）被人工 `/dev` 流程和 Brain tick 自动派发同时抢跑（各自开出 PR #3665 / #3663）。根因是 `POST /tasks` 建的任务默认 `queued`+`claimed_by=NULL`，Brain tick 每 2 分钟扫一次无主任务就抢；不是查重能防的问题（两边开始时都还没有 PR 可查），唯一防线是注册后立刻用现成的 `POST /tasks/:id/claim` 端点上锁。**PR #117（zenithjoy-skills，已合并）**。

4. **session resume 孤儿 worktree 自愈**：`scripts/claude-launch.sh` 原逻辑只判断目录是否存在就直接 cd 进去，不校验是否仍是主仓登记的合法 worktree。若 worktree 注册被意外摘除（目录残留），session 会被静默丢进不受 git 管理的空壳目录。新增 `_is_registered_worktree()` 校验 + 孤儿目录 mv 备份 + 按原分支存续情况重建。**PR #3665（cecelia，已合并）**。顺手修了一个挡住合并、跟本任务无关的主分支既有 CI lint 问题（中文标点炸弹 4 处 unbound variable 风险）。

5. **harness 自循环架构梳理**（纯调研，无代码改动）：确认 `/dev` 三条路径 A(Bug)/B(小改动)/C(Harness) 现状；`task_type=dev` 派发始终走 `/dev`（人工/无头行为一致）；`task_type=harness_initiative` 派发绕开 `/dev`，直接进 harness-controller；`harness_initiative` 唯一合法创建入口是 `/dev` 路径C 点火 curl（硬校验 `orchestrator=skill-relay`）；Brain 自主发起"全新工作"的 `planNextTask()`（架构设计/initiative_plan）链路经数据验证基本是死链（`architecture_design` 历史 0 条，`initiative_plan` 全部停在 4 月）；`line-strategist`（军师）skill 本体完整且设计正确（同 line 内可换 ability，跨 line 无权处理只登记），"军师终态续接"这条自循环此前只有设计文档没接线。

6. **PR3674 军师终态接线执行侧补丁**：调研过程中发现 PR #3674（Line 军师终态接线，另一并发 session 完成，已合并）只做完了任务创建侧（`line-strategist-dispatch.js` 正确建 `strategist_decision` 任务），**执行侧完全没接**——`executor.js` 的 `getSkillForTaskType()` 有自己独立的 `skillMap`（跟 `task-router.js` 的 `SKILL_WHITELIST` 是两张不同步的表），`strategist_decision` 未注册会 fallback 成 `/dev` 且拿不到 `journey_id`。新增 `_prepareStrategistDecisionPrompt`（仿 `_prepareHarnessReportPrompt` 模式 inline SKILL.md + 参数注入）+ `skillMap`/`_TASK_ROUTES` 补项 + `line-strategist` 加入 CI 快照同步清单。**PR #3684（cecelia，已合并）**。至此"军师自动续接"才算真正端到端可用。

7. **今天早上清理的重复 PR（本会话内）**：#3658/#3659/#3660/#3662（journey_id 任务）、#3663（孤儿 worktree 任务）——共 5 个，均已关闭并注明重复对象。

## 完成（主理人/其他并发 session，本会话末段发现并核实）

8. **relay watchdog 重复点火修复**：**PR #3638（今天早上）**，点火前从 GitHub 反查已有 PR。

9. **同一天下午又实锤 3 组新的重复**（不同任务类型，非 relay/harness sprint 路径）：
   - `nightly-real-machine-staging` 在 00:00/16:22/17:00 三个独立时刻分别点火，产出 #3679/#3677/#3680 三份完全不同实现（保留 #3680）
   - `skill-eval-4page` 在 16:22（两次）和 18:20 又点一次，#3676/#3675 与 #3683 前 4 个 commit 逐字节相同（保留 #3683）
   - `decomp-check合并` 在 16:22 同一分钟内被点两次火，#3672 基于旧 main 未 rebase 导致 diff 噪音掩盖了和 #3673 内容相同的事实（保留 #3673）
   - 已关闭 5 个冗余 PR：#3679/#3677/#3676/#3675/#3672，登记 **issue `655691d2`**（P1，In progress）追踪根因。

10. **本会话核实 issue 655691d2 的根因**（纯调研，无代码改动）：
    - `recurring.js` 的 `checkRecurringTasks()` **有**正确 dedup（查 `recurring_task_id` 是否已有 queued/in_progress），且 `recurring_tasks` 表里查无这 3 组任务的记录——**这条链路没有参与本次重复**。
    - "nightly" 只是被构建物的名字，不是任务本身的调度周期——00:00/16:22/17:00 三次性质完全一样，都是普通一次性 `task_type=dev` 手动/AI注册，没有哪次是"正常"的。
    - **真正根因**：`packages/brain/src/routes/task-tasks.js` 的 `POST /` 路由（给外部 agent/人工注册任务用的入口）**全程没有任何去重逻辑**，直接 `INSERT INTO tasks`。对比同代码库 `actions.js` 的 `createTask()`（L107-118）有精确 title+goal_id/project_id 匹配去重，这个路由是完全裸露的。三组重复的 task 文案彼此不完全一致，连"精确字符串匹配"式的 dedup 都可能拦不住，需要更宽松的匹配（时间窗口内 + 语义/模糊匹配，或至少同 payload.feature_id/journey_id + 近期窗口）。

## 没做（下一步，主理人已拍板要做）

**给 `packages/brain/src/routes/task-tasks.js` 的 `POST /tasks` 路由加服务端去重护栏**，参考 `actions.js` `createTask()` 已验证的模式：
- 建任务前查是否存在语义相近（至少同 title 精确匹配，理想情况下更宽松）+ `status IN ('queued','in_progress')` 的任务，命中则拒绝/返回已有任务而非重新 INSERT
- 这是比今天已修的两处（`/dev` skill 的 Phase 0 claim + Phase 2.5 GitHub 检查）更底层的防线——那两处是 skill 层面的客户端纪律，只有调用方老实走 `/dev` 流程才生效；这一处要下沉到 API 本身，不管谁调用（人工/外部 agent/自动化脚本/绕过 skill 直接 curl）都拦得住
- **尚未开始实现**，本 handoff 之后应立即走 `/dev` 路径 B（小改动）落地

## 数据源

- Brain issue：`655691d2-df1f-413f-a760-5cce0f4dd097`（根因追踪，P1，In progress）
- decisions：
  - `58bc5df1`（session resume 孤儿 worktree 自愈方案）
  - `ead993dd`（executor.js strategist_decision 执行侧接线方案）
- PR（本会话内）：
  - cecelia #3661（journey_id 写入）
  - cecelia #3665（孤儿 worktree 自愈）
  - cecelia #3684（strategist_decision 执行侧接线）
  - zenithjoy-skills #116（Phase 2.5 撞车检查）
  - zenithjoy-skills #117（Phase 0 claim）
- PR（其他并发 session，今天内已合并，与本会话调研相关）：
  - cecelia #3667（T2 ability_id 全链接线）
  - cecelia #3674（T3 Line 军师终态接线）
  - cecelia #3638（relay watchdog 重复点火修复）
  - cecelia #3680/#3683/#3673（3组重复中各自保留的最终版本）
- 关键文件：
  - `packages/brain/src/routes/task-tasks.js`（下一步要改的文件，POST / 路由无 dedup）
  - `packages/brain/src/actions.js`（`createTask()` L107-118，已有 dedup 模式可参考）
  - `packages/brain/src/recurring.js`（对照组，dedup 做对了的例子）
  - `scripts/claude-launch.sh`（孤儿 worktree 自愈已修）
  - `packages/brain/src/executor.js`（strategist_decision 路由已修）
  - `/Users/administrator/perfect21/zenithjoy-skills/dev/SKILL.md`（Phase 0 + Phase 2.5 已加，注意 `zenithjoy-skills-dist` 快照需要单独刷新，`~/.claude-account1/skills/dev` 走的是 dist 快照不是 SSOT 实时内容——本会话期间 dist 未刷新，`/dev` 调用拿到的是旧版本，手动补做了 Phase 0 的 claim 动作）
  - `/Users/administrator/perfect21/zenithjoy-skills/line-strategist/SKILL.md`（军师 skill 本体，设计已核实正确）

## 产物

- 已提交的 issue/decisions 见上方数据源
- 本 handoff 文件路径：`docs/handoffs/202607092210-concurrency-audit-and-fixes.md`

## 已知遗留问题（供下一个大脑参考，不阻塞下一步）

- `zenithjoy-skills-dist` 快照落后于 SSOT（两次 skill 改动都要求手动刷新 dist + Brain 重启 `_skillCache` 才能生效，本会话未做这一步，纯交互式 `/dev` 调用暂时还在用旧版本）
- PM 拆解链路（`proposal.js`/`planner.js`/`intent.js`/`decomposition-checker.js` 等）没传 `ability_id` 的 task，journey_id 仍救不了，需要另立任务处理 project→journey 映射链路（今天早上 journey_id 修复的已知残留缺口）
- 共享主仓 `/Users/administrator/perfect21/cecelia` 今天两次被其他并发 session 直接当工作区使用（未走独立 worktree），留下未清理的残留改动，撞见我本人正常的 `git checkout main`/`git worktree add` 操作导致中止（安全失败，无数据丢失，但值得关注这类"绕开 worktree 直接改主仓"的行为是否普遍存在）
