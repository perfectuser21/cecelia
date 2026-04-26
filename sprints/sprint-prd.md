# Sprint PRD — Brain Orchestrator v2 P2 收尾：Spawn Policy Layer 接线

## OKR 对齐

- **对应 KR**：Brain v2 三层架构 — Layer 3（Executor）收敛
- **当前进度**：spawn/ 目录骨架 + 10 middleware + 单元测试已建立（PR #2543-#2555）；spawn.js 仍为 attempt-loop 占位实现，调用方仍直连 executeInDocker
- **本次推进预期**：spawn() 真正装配 middleware 链；4 个调用点迁移；硬编码 account 解析下沉；执行链 End-to-End 接通

## 背景

Brain v2 §5 的设计要求所有 Docker spawn 都收敛到 `packages/brain/src/spawn/spawn.js` 这一原语。前期 PR 已完成"目录骨架 + 10 个 middleware 文件 + 各自单元测试"，但当前 `spawn.js` 仅是一个 `for` 循环直接调 `executeInDocker`，并没有把这些 middleware 真正串成两层洋葱链。同时 `executor.js`、`harness-graph-runner.js`、`workflows/content-pipeline-runner.js` 仍直接 `import { executeInDocker }`，导致：

1. 中间件存在却没接入 — 账号轮换、模型降级、cap 标记、计费的横切逻辑没真正生效
2. `executor.js` 行 3030-3078 还内联了一份与 middleware 重复的 cap 检测 + selectBestAccount 逻辑
3. 调用方各自传 env 各自 fallback，PR #2534 的硬编码 `account1` 治理无法在新链上 enforce

本 Initiative 把这些桥接到位，完成 v2 P2 的"功能闭环"。

## 目标

把 `spawn()` 从占位升级为真正的两层洋葱执行链；把 Brain 内所有要跑 Docker 的 caller 改成走 `spawn()`；保留 `SPAWN_V2_ENABLED` 回滚开关，灰度可控。

## User Stories

- **US-001**（P0）：作为 Brain 平台维护者，我希望任何调用方都通过 `spawn()` 触发 Docker，以便横切能力（账号轮换 / 模型降级 / cap 标记 / 计费 / 日志）一次到位、不漏不重
- **US-002**（P0）：作为 Brain 运维，我希望可以通过 `SPAWN_V2_ENABLED=false` 立即回退到旧 `executeInDocker` 直连路径，以便新链上线初期出现回归时可快速止血
- **US-003**（P1）：作为开发者读 `executor.js`，我希望"账号选择 / cap 检测 / cascade 降级"只出现在一个地方（spawn middleware），以便后续维护和审计

## 验收场景（Given-When-Then）

**场景 1**（US-001 — 调用方迁移完成）：
- Given Brain 启动且 `SPAWN_V2_ENABLED=true`
- When `executor.js` HARNESS_DOCKER_ENABLED 分支、`harness-graph-runner.js`、`workflows/content-pipeline-runner.js` 任一触发 Docker 执行
- Then 实际进入容器前，请求会经过 spawn 外层四个 middleware（cost-cap → spawn-pre → logging → billing）和内层 attempt-loop（account-rotation → cascade → resource-tier → docker-run → cap-marking → retry-circuit），且 `import { executeInDocker }` 不再出现在 spawn/ 之外的非测试文件

**场景 2**（US-002 — 回滚开关）：
- Given Brain 启动且 `SPAWN_V2_ENABLED=false`
- When 任一调用方触发 Docker 执行
- Then 执行直接走旧 `executeInDocker` 路径，跳过 spawn 中间件链；行为与本 Initiative 之前完全一致（grep `[spawn]` 日志为空）

**场景 3**（US-001 — account capped fallback）：
- Given `account1` 已被标记 spending-capped，调用方未显式传 `CECELIA_CREDENTIALS`
- When `spawn()` 触发执行
- Then account-rotation middleware 自动选 `account2/account3` 之一，billing middleware 写入 `dispatched_account` 与最终账号一致，不再出现"被 capped 账号仍被派发"的死循环

**场景 4**（US-001 — 模型 cascade 降级）：
- Given Anthropic 三个 sonnet 账号全部 cap，`opts.cascade` 为默认链
- When `spawn()` 触发执行
- Then cascade middleware 按 spec §5.3 顺序先横切账号保 sonnet → 全满后降 opus → 再 haiku → 最后 minimax，且不会在某个账号被 cap 时立刻就降模型

**场景 5**（US-001 — 429 transient 重试）：
- Given attempt 0 docker-run 返回 stderr 含 `api_error_status: 429`
- When spawn attempt-loop 进入下一次 iteration
- Then cap-marking 已标该账号 capped，account-rotation 在 attempt 1 自动选别的账号；同时 `opts.env.CECELIA_CREDENTIALS` **不被** spawn 主动 delete（保持 spec 契约）

**场景 6**（US-003 — executor.js 内联逻辑下沉）：
- Given 阅读 `executor.js` 行 3030-3078
- When 查找 `isSpendingCapped` / `selectBestAccount` 直接调用
- Then 这两个调用已从 `executor.js` 移除，仅存在于 spawn middleware 内

## 功能需求

- **FR-001**：`spawn.js` 内部按洋葱顺序串联 10 个 middleware；外层 4 个用 Koa 风格 `next()`，内层 6 个在 attempt-loop 显式 `for` 内调用
- **FR-002**：新增 env var `SPAWN_V2_ENABLED`（默认 `true`）；`false` 时 `spawn()` 直接调旧 `executeInDocker` 跳过 middleware
- **FR-003**：`executor.js` 删除 HARNESS_DOCKER_ENABLED 分支内 3030-3106 的内联账号解析 + executeInDocker 直调，替换为 `spawn(opts)`
- **FR-004**：`harness-graph-runner.js` 把 `dockerExecutor` 默认值从 `executeInDocker` 改为 `spawn`
- **FR-005**：`workflows/content-pipeline-runner.js` 把 `dockerExecutor` 默认值从 `executeInDocker` 改为 `spawn`
- **FR-006**：`docker-executor.js` 的 `executeInDocker` export 在 spawn/ 之外不再被任何业务文件 import（保留 export 只供 spawn/middleware/docker-run.js 调用 + 测试）
- **FR-007**：`spawn/__tests__/spawn.test.js` 扩充 3 个端到端集成场景：account capped fallback、cascade 降级、429 retry
- **FR-008**：保留所有现有 middleware 单元测试不破坏

## 成功标准

- **SC-001**：`grep -rn "from.*docker-executor" packages/brain/src/ | grep -v __tests__ | grep -v spawn/` 输出为 0 行（writeDockerCallback / resolveResourceTier / isDockerAvailable 这类非 executeInDocker 的 export 允许保留，但被 grep 命中的话需移到独立模块）
- **SC-002**：`grep -n "isSpendingCapped\|selectBestAccount" packages/brain/src/executor.js` 输出为 0 行
- **SC-003**：`SPAWN_V2_ENABLED=false` 时 `spawn()` 执行行为与 PR 合并前完全一致（行为契约通过单元测试验证）
- **SC-004**：`vitest run packages/brain/src/spawn` 全部 PASS，新增 3 个 E2E 集成测试均覆盖到对应 middleware 调用栈
- **SC-005**：现有 brain-ci.yml 不出现回归（含 `docker-executor-account-rotation.test.js` PR #2534 基线）

## 假设

- [ASSUMPTION] `docs/design/v2-scaffolds/spawn-readme.md` 已不存在（v2-scaffolds 现仅有 observers-readme.md / workflows-readme.md），且 `packages/brain/src/spawn/README.md` 已是最终位置 — 任务里的 `git mv` 步骤本 Initiative 不再执行
- [ASSUMPTION] `harness-task-dispatch.js` 仅 import `writeDockerCallback`，不算 executeInDocker 调用方，本 Initiative 不迁移
- [ASSUMPTION] PR #2534 + P2 PR1-PR11 已清掉 `executor.js:2856` / `executor.js:3045` / `content-pipeline-graph-runner.js:70` 三处硬编码 `account1` 字符串本身；本 Initiative 进一步把"内联 cap 检测/selectBestAccount 调用"也下沉到 middleware
- [ASSUMPTION] `harness-gan.graph.js` / `content-pipeline.graph.js` 内部节点工厂仍接收 `executor` 参数；通过外层 caller 在构造时把 `spawn` 传进去即可，不需要改 graph 内部节点签名

## 边界情况

- **测试注入**：harness-graph-runner、content-pipeline-runner 现有 `opts.dockerExecutor` 测试注入接口必须保留；默认值改为 `spawn` 即可，老测试用例传 mock 仍生效
- **timeout / cidfile / forensic log**：spawn-pre middleware 必须保留 docker-executor 原有的 cidfile + forensic log 行为，不能因为外层化而丢失
- **billing 双写**：billing middleware 写 dispatched_account 时必须与 executor.js 现有 `pool.query UPDATE tasks SET payload || dispatched_account` 行为对齐，避免 callback 路径上 cap 标记找不到正确账号
- **空 result**：attempt-loop 内 docker-run 抛异常 vs 返回 exit_code≠0 — retry-circuit 必须区分（异常按 transient 处理，进入下一轮）
- **回滚路径并发**：`SPAWN_V2_ENABLED=false` 时 cap-marking 的副作用（markSpendingCap）必须仍在某条路径上发生，不能因为绕过 middleware 就丢失账号 cap 标记 — 旧 executor.js 路径里本就有这段逻辑，回滚时由它兜底

## 范围限定

**在范围内**：
- spawn.js 内部把 middleware 串成洋葱链
- 4 个调用点（executor.js HARNESS_DOCKER_ENABLED 分支、harness-graph-runner.js、workflows/content-pipeline-runner.js、harness-gan 调用方）迁移到 spawn()
- executor.js 内联账号解析下沉（3030-3078）
- SPAWN_V2_ENABLED 回滚开关
- spawn 端到端集成测试（3 场景）

**不在范围内**：
- 新建 `packages/spawn/` 子包（仍在 `packages/brain/src/spawn/` 内部组织）
- LangGraph 版本升级
- 重写 account-usage.js / slot-allocator.js
- 修改 Brain API 路由对外接口
- 1 周观察后删除 SPAWN_V2_ENABLED flag（属于后续清理 Initiative）
- harness-task-dispatch.js（仅 import writeDockerCallback，不算 spawn 调用方）

## 预期受影响文件

- `packages/brain/src/spawn/spawn.js`：从占位 attempt-loop 升级为真正洋葱链装配；新增 SPAWN_V2_ENABLED 分支
- `packages/brain/src/spawn/__tests__/spawn.test.js`：扩展 3 个 E2E 集成场景
- `packages/brain/src/executor.js`：HARNESS_DOCKER_ENABLED 分支替换为 `spawn()`；删除 3030-3078 内联 cap/selectBestAccount 调用
- `packages/brain/src/harness-graph-runner.js`：`dockerExecutor` 默认值改为 `spawn`
- `packages/brain/src/workflows/content-pipeline-runner.js`：`dockerExecutor` 默认值改为 `spawn`
- `packages/brain/src/docker-executor.js`：`executeInDocker` 标注为内部 export（注释 + 限流，不实际改 export 关键字以免破坏 spawn/middleware/docker-run.js 引用）
- `packages/brain/src/spawn/README.md`：更新 P2 状态从 "PR1-PR11 完成等待接线" 到 "P2 接线完成"
