# Learning — LangGraph Harness Pipeline 可视化

## 本次任务

在 `pipeline-detail` API 和 `HarnessPipelineDetailPage.tsx` 加 LangGraph 路径可视化（GAN/Fix 轮次 + checkpoint 状态 + Mermaid 架构图）。

## 根本原因（历史架构 gap）

- `pipeline-detail` 按「每阶段独立 DB task」建模 `stages[]`（10 步），但 LangGraph 路径一个 task 跑完整条 pipeline — `stages[]` 里除了 `planner` 全是 `not_started`。
- 实际节点执行数据都在 `cecelia_events.langgraph_step`（onStep 写）和 `checkpoints` 表（PostgresSaver 写），API 以前没读它们，所以前端只能看到 planner 一个节点状态。
- executor.js 的 onStep 之前只把 `state_snapshot` 写入 payload，丢了 `node` 和 `step_index` — 重建 GAN/Fix 轮次配对必须知道节点名，所以必须补回来。

## 下次预防

- [ ] LangGraph 新节点加 onStep payload 字段时，同步更新 `buildLangGraphInfo()` 的 payload 解构（`node`/`step_index` 现在必需）
- [ ] 新增 `gan_rounds` / `fix_rounds` 类似的配对节点组合时，把配对逻辑抽出通用 helper（避免两段几乎一样的代码）
- [ ] Worktree 重装 node_modules 后要在 worktree 根 `npm install`（workspaces 逻辑），单独在 `apps/dashboard/` 里 install 会把根部 vitest 冲掉
- [ ] 前端组件测试涉及 react-router 时直接 `vi.mock('react-router-dom', ...)`，别用 MemoryRouter（worktree 内 react 双实例会导致 useRef=null）

## 已避开的坑

- PG 参数化查询：`WHERE task_id = $1::uuid` 需要合法 UUID，不合法会 500，所以 API 入口处做正则校验直接返回空
- checkpoints 表可能未初始化（PostgresSaver.setup 在真实 runtime 才跑）— try/catch 降级为 count=0
- Mermaid 在 happy-dom 下渲染会炸 — 前端测试直接 mock mermaid 模块
