# PrepPRD：并行血管P1 — worker 池自动派发

> Brain task: 873acc6d-35ba-405c-98e3-a2b5008abc10（人工worker批次，Alex 已拍板自治推进）
> 现成积木：scripts/dispatch-worker.mjs（账号池思想）+ scripts/claude-launch.sh（交互 launcher）
> 先例：harness-skill-relay.js _spawnHeadedSession（SSH 逃逸+tmux 守卫）、youtou-dispatch-pattern memory

## 本次要做的

新增 Brain scheduler job `worker-pool-dispatch`（60s 轮询注册表 + 模块内 5min 自 gate）：

1. **扫队列**：`status='queued'` 且（`payload.parallel_worker=true` 或 `payload.pipeline='canvas'` 且 `payload.canonical='exploratory'`）的任务
2. **挑空闲 worker 槽**：只用 tmux `slot7`/`slot8`/`slot9`（slot1-6 是 harness/Alex 地盘绝不碰）。
   空闲判定 = session 的 pane_current_command 是 shell（zsh/bash）；session 不存在 → 创建。
3. **并发上限 2**：忙槽（非 shell pane）≥2 → 本轮不发射
4. **发射**：预占 `claimed_by='interactive-dev-skill'`（与 /dev claim 409 预占约定对齐）→
   tmux send-keys 到空闲 slot：`cd 主仓 && bash scripts/claude-launch.sh "/dev --task-id <id> ..."`
   （launcher 自动 session-id + per-session worktree；prompt 里带"claim 409 且 claimed_by=interactive-dev-skill 属预占继续"）
5. **发射即记** `dispatch_events(event_type='dispatched', reason='worker_pool:slotN')`
6. **SSH 逃逸**：/.dockerenv 存在 → `administrator@host.docker.internal` + key 自动发现（对齐 harness 先例）

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| slot 空闲判定 | pane_current_command 是 shell / session 不存在 / pane 数 | pane_current_command ∈ {zsh,bash}（session 不存在=可建即空闲） | worker 跑完 claude 退出回 shell | 误判忙→发射堆叠；用预占+claim 幂等兜底 |
| 发射成功判定 | send-keys 返回码 / 轮询 pane 内容 | send-keys+new-session 返回码（发射即 dispatched，不追踪执行结果——worker 自己走 /dev 全流程回写） | P1 最小闭环 | 发射后 claude 启动失败→任务卡 in_progress，由既有 stale 回收兜底 |

## 前置工作（已核对）

- [x] tmux slot7/slot8 已存在（slot9 按需建）；slot1-6 attached 是 harness/Alex 地盘
- [x] SSH 逃逸先例：harness-skill-relay HEADED 分支（key 发现 + BatchMode + host.docker.internal）
- [x] dispatch_events 表已存在（event_type CHECK 含 dispatched/failed_dispatch/skipped）
- [x] scheduler-jobs.js 注册表机制（60s 轮询+handler 自 gate）
- [x] claude-launch.sh 交互模式自动 worktree 隔离

## 涉及文件

- `packages/brain/src/jobs/worker-pool-dispatch.js`（新）
- `packages/brain/src/jobs/__tests__/worker-pool-dispatch.test.js`（新，failing test 先行）
- `packages/brain/src/scheduler-jobs.js`（注册）
- `packages/brain/scripts/smoke/worker-pool-dispatch-smoke.sh`（feat+brain/src 必配）
- version bump 四处（package.json/package-lock/.brain-versions/DEFINITION.md）

## 不包含

- worker 执行结果追踪/收窗（handoff 后 send-keys /exit）——后续件
- 跨机器派发（只本机 tmux）
- headless 降级兜底

## 验收标准

- [ ] failing test 先 commit（commit-1），实现后全绿（commit-2）
- [ ] 测试覆盖：扫描条件/slot7-9 白名单（绝不出现 slot1-6）/并发上限2/5min 自 gate/预占 claim/dispatch_events 记账
- [ ] DevGate 三命令 + version bump 四处 + smoke 脚本
- [ ] CI 全绿 + merged
