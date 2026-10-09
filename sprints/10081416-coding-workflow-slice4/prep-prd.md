# 小改动 PrepPRD：coding workflow 第四刀——Brain 任务自动派到 coding 链（显式开关）

- Brain 任务：0ce1bef8-be4a-4715-a333-32f99436fe30
- 决策：896fb590（coding 走 Commander + workflow）
- GP-Anchor: none(infra)

## 目标

Brain 里一条任务只要显式打上开关，执行机就会自动认领、在干净 worktree 里跑完整 coding 链（intent→spec→build→verify→chain_check→publish→report），开 PR，并回写 Brain。**不改任何现有任务的路由**。

## 开关与避坑

| 约定 | 原因 |
|---|---|
| 任务 `task_type: "data"` + `payload.coding_workflow: true` + `payload.headed_manual: "true"` | dev 类会被 Work Router 改成 harness_initiative，进 kernel 流水线；harness_initiative 认领 40 分钟无 initiative_runs 会被看门狗判卡死；data + headed_manual 不被 tick 派发 |
| `payload.repo` 缺省 cecelia | 第一版只支持 cecelia 仓 |

## 改什么（packages/brain/scripts/coding-workflow/runner/）

### run-once.mjs（每次调用处理至多一条任务）

1. **单实例锁**：`~/.cecelia/coding-workflow-runner.lock`（mkdir 锁 + pid，持锁进程已死则回收）；拿不到锁直接退出 0（上一轮还在跑属正常）。
2. **找任务**：`GET {BRAIN}/api/brain/tasks?status=queued&limit=500`，筛 `payload.coding_workflow === true` 且未被认领，取最早创建的一条；没有就退出 0。
3. **认领**：`POST /api/brain/tasks/:id/claim`（claimer `coding-workflow-runner@<hostname>`），409 换下一条；随后 `PATCH status=in_progress`。
4. **准备 worktree**：`git -C <repo> fetch origin main`；分支 `cp-<MMDDHHmm>-cw-<task前8>`；路径 `<WORKTREE_BASE>/cw-<task前8>`；`git worktree add -b <branch> <path> origin/main`；写 `.dev-mode.<branch>` 与 `.dev-lock.<branch>`（满足本机全局 pre-commit 钩子，gp_anchor 取 `payload.gp_anchor` 缺省 `none(infra)`）；在 worktree **根目录** `npm ci --legacy-peer-deps --ignore-scripts`（只能在根目录跑）。
5. **跑链**：用 worktree 自己的 `packages/brain/scripts/activity-contract-run.js --cwd <worktree>/packages/brain/scripts/coding-workflow --receipt <LOG_DIR>/<task>.json`，stdin `{contract, input:{run_tag, task_id, worktree, sprint_dir:"sprints/<MMDDHHNN>-cw-<task前8>", brain_url}}`；runner 自身总超时 = 契约各活动 budget 之和 + 10 分钟。
6. **收尾**：
   - 回执 completed：`PATCH status=completed`（result 由 report 活动已写入 coding_workflow，runner 只补 `runner: {receipt_path, host, duration_s}`）；若 `CODING_WF_AUTOMERGE` 不为 `0`，对回执里的 pr_url 执行 `gh pr ready` + `gh pr merge --auto --squash`；删除 worktree（分支已推到远端）。
   - 回执 failed/partial 或执行器崩溃：`PATCH status=failed`，result 写 `{coding_workflow_runner:{status, failed_activity, reason_code, receipt_path, host}}`；**保留 worktree** 供排查。
   - 任何一步异常都要尽力回写 Brain，不留 in_progress 孤儿。

### 运行底座（独立 clone）

- runner 不使用主仓 checkout（落后且多会话共用）。使用专用 clone `CODING_WF_REPO`（默认 `~/perfect21/cecelia-cw-runner`）。
- `runner.sh` 启动器：clone 不存在则 `git clone`；工作区干净时 `git fetch origin main && git reset --hard origin/main` 自更新；然后 `exec node packages/brain/scripts/coding-workflow/runner/run-once.mjs`。工作区不干净则记日志并不更新（不破坏现场）。
- 任务 worktree 从该 clone 建（`git -C <clone> worktree add ...`），runner 结束删除成功任务的 worktree，并定期 `git worktree prune`。

### 部署

- `install.sh`：生成并安装系统域 LaunchDaemon `com.cecelia.coding-workflow-runner`（`/Library/LaunchDaemons`，`UserName=administrator`，`StartInterval=300`，日志 `~/Library/Logs/coding-workflow-runner.log`，PATH 含 node/git/gh/claude 实际路径），`launchctl bootstrap system` + `enable`。按本机铁律禁止放 `~/Library/LaunchAgents`。
- 把 `com.cecelia.coding-workflow-runner` 登记进 `packages/brain/src/launchd-patrol.js` 的 MUST_LOAD。
- runner 跑在执行机（本机 MMV），不在 us-vps。

## 测试

- 单测（假 Brain HTTP、临时 bare origin、假执行器脚本 `CODING_WF_EXECUTOR` 覆盖）：无任务退出 0；锁占用退出 0；陈旧锁回收；认领 409 换下一条；成功路径（worktree 建在临时 base、npm ci 可用 `CODING_WF_SKIP_NPM_CI=1` 跳过、执行器回执 completed → PATCH completed、worktree 删除、automerge 调用假 gh）；失败路径（回执 failed → PATCH failed 含 failed_activity/reason_code、worktree 保留）；执行器崩溃/超时 → PATCH failed。
- launchd-patrol 登记的既有测试同步。

## 验收

- [ ] 单测全过；DevGate 通过；CI 必需检查全绿
- [ ] 安装后 `launchctl print system/com.cecelia.coding-workflow-runner` 显示已加载、5 分钟间隔
- [ ] 建一条带开关的真实任务，runner 自动认领，Brain 状态与 result 正确（真实端到端由下一个任务完成）
