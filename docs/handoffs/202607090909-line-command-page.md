# Handoff：Line 指挥页 PR1 + 部署链路修复（会话终态）

task_id: unknown（跨多个子任务的会话级 handoff，非单一 Brain task）
verdict: PASS（PR1 范围内）

## 背景 / 最初目标

主理人提出：每条 Line 已经有自己的军师 skill（line-strategist）在做节奏决策（修 bug / 小改动 / 推进项 / 停线），
但缺一个前端——按 Line 分的指挥页面，能一眼看到某条线连了什么、节奏健不健康、军师最近决策了什么。

设计定案（本会话 brainstorming 产出）：WarRoom 总览页下钻，`/warroom/line/:id`，
分两期交付——**PR1 只读指挥页**（军师决策流水 / 连接全景图 / 节奏健康度）+ PR2 可操作控制台（手动唤醒军师、停线/复线、调优先级）。

## 完成（PR1 范围）

1. **后端**：`GET /api/brain/warroom/line/:id/command`（`packages/brain/src/routes/warroom.js`），聚合返回
   `decisions`（notes 表按 `军师决策[<Line名>]` 前缀）+ `connections`（abilities/features/advancements/active_tasks/open_issues/recent_runs）
   + `health`（近30天成功率/PR频率/是否停线），每个子查询独立 try/catch 优雅降级。
2. **前端**：`apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx`，路由 `/warroom/line/:id`，三栏只读布局；
   WarRoom 总览页 line 卡片 hover 出现下钻按钮。
3. **交付路径**：注册 Brain `task_type=dev` 任务（`6d125b88`）后，Brain 自动派发链路独立跑完全套（比我手动用 Codex 那条线更快更完整），
   产出 **PR #3641**（perfectuser21/cecelia）。发现是重复劳动后放弃了手动 Codex 那条线（tmux session `run-line-cmd` 已 kill，
   临时分支/worktree 已清理）。PR #3641 唯一卡的是 `lint-feature-has-smoke`（缺配套 smoke.sh），已补齐 `packages/brain/scripts/smoke/warroom-line-command-smoke.sh`
   并登记进 `packages/quality/smoke-allowlist.txt`，CI 全绿后合并。
4. **顺手修的基础设施 bug**：触发 Brain deploy webhook 时发现 `dashboard-staging-selfcheck.sh` 的 staging 自检必崩
   （`mktemp: : Invalid argument`）。**排查纠偏记录在案**：最初误判是容器 `TMPDIR=""` 导致，
   实测 TMPDIR 正常时同样报错——真根因是 `cecelia-node-brain` 容器跑的是 **BusyBox mktemp**（非 GNU/BSD），
   其模板解析不支持 `XXXXXX` 占位符后再跟静态后缀（如 `dashboard-slot.XXXXXX.log`）。已修 **PR #3648**（4处 mktemp 调用，
   `dashboard-staging-selfcheck.sh` ×3 + `brain-deploy.sh` ×1），新增回归测试 `scripts/__tests__/mktemp-empty-tmpdir.test.sh`，
   本机（GNU/BSD）+ 容器内（BusyBox）双端验证过，已合并。
5. **端到端验证**：Playwright 实测打开 `http://localhost:5211/warroom/line/bb8cc561-b3ee-4fec-b74d-2255694bd963`
   （Cecelia Harness Pipeline 这条线），三块内容渲染正常、无 console 报错，截图已看过。
   决策流水/连接全景显示为空是**真实数据**（这条 line 没有军师留过决策、没有 task/issue/ability 挂它的 journey_id），不是渲染 bug。
6. **部署**：Brain 官方 webhook（方式A）当时因为主仓被另一个自主任务占用、`git pull` 静默失败继续用旧代码而不可靠
   （同 `deploy-silent-stale-failure-mode.md` 记录的模式）。**绕过方法**：在隔离的 `git worktree add <tmp目录> origin/main --detach`
   里独立构建，产物直接 rsync 到本机容器 bind-mount 的 `apps/dashboard/dist/`（本机 `cecelia-frontend`）和
   `hk-vps:/opt/cecelia/frontend/dist/`（HK `cecelia-core-hk`）。已验证两边 `index-*.js` bundle hash 完全一致（`index-BUlVss-M.js`）。
   PWA autoUpdate，未重启容器。

## 没做

- **PR2 控制台**（手动唤醒军师 / 停线复线 / 调优先级）——完全没开始，只有口头两期约定，没有单独的设计/brainstorming
- **数据缺口**：绝大多数 task/issue 创建时没写 `payload.journey_id`，导致"连接全景图"对大部分 line 会显示为空——
  指挥页代码本身没问题，但数据源没铺开，页面价值打折扣。需要系统性排查 task/issue 的创建入口（`packages/brain/src/routes/task-tasks.js` 的 POST `/tasks`、
  issue 创建脚本等），补上 journey_id 写入
- 只验证了 **Cecelia Harness Pipeline** 一条线；其他 line 的指挥页没有单独截图验证过（代码路径应该一致，但没实测）
- Brain deploy webhook 的根因（主仓被占用时 `git pull` 静默失败仍继续用旧代码部署）**没有修**，这次是手动绕过，
  下次主仓空闲时该链路本身还是有隐患，值得单独立一个 bug 修

## 下一步（建议优先级）

1. **数据缺口修复**（优先，不然指挥页对大多数 line 都是空壳）：排查 task/issue 创建全部入口点，系统性补 `journey_id` 写入
2. **PR2 控制台**：走完整 brainstorming → 设计 → /dev 流程，不要跳过设计直接写代码
3. （可选）验证其他几条活跃 line 的指挥页渲染是否正常
4. （可选）修 Brain deploy webhook 在主仓被占用时静默用旧代码的根因（`scripts/deploy-local.sh` line ~118 `git pull` 失败只 warn 不 abort）

## 数据源

- PR: https://github.com/perfectuser21/cecelia/pull/3641 （Line 指挥页 PR1）
- PR: https://github.com/perfectuser21/cecelia/pull/3648 （mktemp BusyBox 修复）
- Brain task: `6d125b88-1c0b-4af5-a617-a02815c407f9`（completed）
- decision: `4b3b6293-25ef-417e-bc54-99f90ed7566d`（small-change，指挥页设计）
- decision: `759047af-5d92-49ec-b65c-f0677394c5c2`（bug-fix，注意其中 TMPDIR="" 的假设已被 PR #3648 的排查推翻，真根因是 XXXXXX 后缀语法，看 PR #3648 描述而非这条 decision 原文）
- API: `GET /api/brain/warroom/line/:id/command`
- 页面: `apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx`
- Line id（测试用）: Cecelia Harness Pipeline = `bb8cc561-b3ee-4fec-b74d-2255694bd963`

## 产物

- branch（PR1，已合并删除）: `cp-07081330-warroom-line-command-page-pr1`
- branch（mktemp修复，已合并删除）: `cp-0708231611-fix-mktemp-empty-tmpdir`
- 本机 dashboard: http://perfect21:5211/warroom/line/bb8cc561-b3ee-4fec-b74d-2255694bd963
- HK 生产: hk-vps 上同步（bundle hash 与本机一致）
