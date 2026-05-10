# Sprint PRD — W8 v16 真端到端验证 status=completed (post H7/H9/H8/H10/H11)

## OKR 对齐

- **对应 KR**：W8 LangGraph harness 端到端可执行性（KR-W8）
- **当前进度**：v14 在 generator 与 evaluator 阶段暴露 H7~H14 一系列阻塞 bug，已逐一修复，但**没有任何一次完整跑通到 `tasks.status='completed'`**
- **本次推进预期**：从"阶段性绿灯"推进到"真端到端绿灯" — sub_task 行 `status='completed'` 由 evaluator 通过 callback 真实写入（非人工 PATCH、非 stub）

## 背景

v14 的 Walking Skeleton noop PR 任务（`docs/learnings/w8-langgraph-v14-e2e.md`）是上一轮真实跑全链路的尝试。它暴露了 8 个阻塞性问题：

| 编号 | 修复 commit | 修的是什么 |
|---|---|---|
| H7  | `a2b43b180` | entrypoint.sh tee stdout 到 STDOUT_FILE — generator 节点拿不到子进程输出 |
| H8  | `342a01db8` | evaluator 切到 generator 的 task worktree — evaluator 在错误目录里找不到 DoD 验证文件 |
| H9  | `1b2364301` | harness-planner SKILL push noise 静默 — planner 误把 push 失败当致命错 |
| H10 | `8e230cf77` | proposer 节点 verify origin push — proposer 自以为 push 成功实际没 push 上去 |
| H11 | `323f3de28` | sub-task worktree key 用 `<init8>-<logical>` 复合键 — sub_task 之间互踩 worktree |
| H12 | `4cb6f3374` | docker-executor `cecelia-prompts` mount ro→rw — H7 的修复在容器里只读不能写 |
| H13 | `5a2ec166f` | spawnGeneratorNode 注入 contract artifacts — evaluator 找不到 DoD 文件 |
| H14 | `086ddf6d6` | 移除 account3（403 退订） — 影响调度可用账号池 |

H7~H14 已全部合入 main。**v15 没有作为独立 sprint 存在**（修复期间所有改动以 hotfix PR 形式推进）。v16 是"假定一切修复都生效后的真端到端复盘"。

## Golden Path（核心场景）

Brain 派发一个 `harness_initiative` 类型的 Walking Skeleton noop 任务 → LangGraph 全部五个节点（planner / proposer / reviewer / generator / evaluator）按顺序无人工介入完成 → evaluator 通过 callback 把 sub_task `status` 写为 `completed`。

具体：

1. **触发**：`POST localhost:5221/api/brain/tasks` 创建一个 task，`task_type=harness_initiative`，描述固定为 "[W8 v16 — final] Walking Skeleton noop 真端到端"，`payload.skeleton_mode=true`（中间层允许 stub，generator 不修改任何 packages/ 运行时代码，只产出一个 docs/learnings/w8-langgraph-v16-e2e.md 文件）。
2. **planner 节点**：从 task 描述生成 `sprint-prd.md` 推到分支，verdict=DONE。日志里 `[harness-planner] push skipped` 这种 noise 不算失败（H9 已修）。
3. **proposer 节点**：起草 sprint-contract.md 和 task-plan.json，git push 后**真正校验 origin 上分支已更新**（H10 已修）。
4. **reviewer 节点**：GAN 对抗，最终 APPROVED。
5. **generator 节点**：在 sub_task 自己的 worktree（`<init8>-<logical>` 复合键，H11）里读取从 contract artifacts 注入进来的 DoD（H13），跑容器（mount cecelia-prompts rw — H12，使用 ACCOUNTS 中可用账号 — H14），子进程 stdout 完整 tee 到 STDOUT_FILE（H7），最终产出 `docs/learnings/w8-langgraph-v16-e2e.md` 并 push。
6. **evaluator 节点**：切到 generator 的 sub_task worktree（H8），读到 contract artifacts，跑 DoD 验证命令全部 PASS，通过 callback 把 sub_task 行 `status` 写为 `completed`。
7. **可观测出口**：
   - PostgreSQL `tasks` 表里 sub_task 行 `status='completed'`，`updated_at` 在 evaluator 完成的那一分钟内
   - 同一行的 `result` JSON 字段非空，且能反查到 PR URL
   - GitHub 上对应 PR 处于 OPEN（无需 merge）
   - 上述 status 由 evaluator 通过 `/api/brain/tasks/:id` PATCH 写入，**不是任何人工 curl PATCH**

## 边界情况

- **GAN 不收敛**：reviewer 走完 GAN_CONVERGENCE 检测仍然发散 → force APPROVED（已存在机制 `d3561e97d`）。这条路径不在本 sprint 修复范围。
- **账号 5h 配额耗尽**：H14 后 ACCOUNTS 池剩余账号若全部 throttle，generator 可能在 spawn 阶段就阻塞。本 sprint 视为"环境不可用"而非验证失败 — 报告里如实说明并允许重跑。
- **GitHub push 网络抖动**：proposer/generator push 重试上限（已存在）触发后视为真失败 — evaluator 也不应误判 PASS。
- **partial completion**：planner/proposer/reviewer 全 DONE 但 generator 或 evaluator 中途崩溃 → sub_task `status` 不会变 `completed`，本 sprint 视为未达成（不允许"接近成功就算成功"）。

## 范围限定

**在范围内**：
- 设计/产出一条 Walking Skeleton noop 任务作为本次 v16 验证载体
- 真实派发该任务，从 Brain 触发到 evaluator 写 status=completed 的全链路必须无人工介入
- 收集 5 个节点各自的 duration、GAN proposer/reviewer 轮数、最终 PR URL，写入 `docs/learnings/w8-langgraph-v16-e2e.md`
- 如果跑挂，定位是哪个节点哪一步，新增 H15/H16... hotfix 直到跑通

**不在范围内**：
- 修改 LangGraph 节点本身的实现（H7~H14 已完成）
- 引入新的节点类型（如 collect-evidence 节点，v14 PRD 提过但本 sprint 不做）
- 验证非 Walking Skeleton 模式（真实修代码的 task）— 那是下一个 sprint
- 验证多 sub_task 并发跑（本 sprint 单 sub_task 即可）
- 改 evaluator 的 DoD 表达力（contract artifact 注入机制 H13 已修，本 sprint 沿用）

## 假设

- [ASSUMPTION: H7~H14 八个修复已全部合入 main 且未被后续 PR 回滚 — 通过 `git log --oneline -30` 已核对到 086ddf6d6/5a2ec166f/4cb6f3374/323f3de28/8e230cf77/342a01db8/1b2364301/a2b43b180]
- [ASSUMPTION: Brain 在跑这个任务期间是 healthy 的（tick loop 正常、没有 breaker OPEN、ACCOUNTS 池中至少 2 个账号有 5h 配额）]
- [ASSUMPTION: docker-executor 镜像已 rebuild 并包含 H7/H12 相关 entrypoint.sh 改动 — 上次 image build 时间晚于 4cb6f3374 合入时间 2026-05-09]
- [ASSUMPTION: GitHub `origin` 推送通道可用 — proposer/generator 两个节点都依赖 push]
- [ASSUMPTION: PostgreSQL `tasks` 表 schema 自 v14 以来没有破坏性 migration — selfcheck 报告 EXPECTED_SCHEMA_VERSION 一致]

## 预期受影响文件

- `sprints/w8-langgraph-v16/sprint-prd.md`：本文件，本次 sprint PRD
- `sprints/w8-langgraph-v16/sprint-contract.md`：proposer 阶段产出
- `sprints/w8-langgraph-v16/task-plan.json`：proposer 阶段从 Golden Path 倒推产出
- `docs/learnings/w8-langgraph-v16-e2e.md`：generator 阶段产出（这是 Walking Skeleton 的唯一交付物）
- 不预期修改 `packages/brain/`、`packages/engine/`、`packages/workflows/` 任何运行时代码 — 一旦 v16 跑挂需要 H15+ hotfix，那些改动属于本 sprint 之外的并行 PR

## journey_type: dev_pipeline
## journey_type_reason: 本 sprint 的 Golden Path 完整经过 LangGraph harness 五节点（planner→proposer→reviewer→generator→evaluator），核心被验证对象就是 dev pipeline 自身 — 跑挂的修复全部落在 packages/brain（harness 节点）与 packages/engine（hooks/skills），符合 dev_pipeline 定义的"涉及 packages/engine（hooks/skills）"判据
