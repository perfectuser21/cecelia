### 根本原因

本任务是 Harness Generator Docker 容器 git push + PR 产出链路的最小冒烟：在
`packages/brain/src/routes/brain.js` 新增 `GET /ping` 端点，返回 `{pong: true, timestamp: ISO-8601}`。

合同内部存在三处与现有代码实际状态不一致（PRD 的 ASSUMPTION 未经 Step 0 验证导致）：

1. `packages/brain/src/routes/brain.js` 在 main 上**不存在**。现有 brain 路由集合通过
   `server.js` → `import brainRoutes from './src/routes.js'` 挂载 `app.use('/api/brain', brainRoutes)`，
   并非合同假定的 `./src/routes/brain.js`。本 PR 遵照合同字面创建了 `packages/brain/src/routes/brain.js`
   文件（≤ 10 行），但由于合同同时约束"不得修改 app.js / server.js"，该文件实际上**未被挂载**，
   因此 BEHAVIOR 类 DoD（5/6/7/8，需运行时 200）无法在当前 PR 内端到端通过。
2. 合同 DoD-4 要求"未新增 require/import 语句"。由于新文件必须 `import { Router } from 'express'`，
   这条 DoD 在"新建文件"场景下天然无法满足——是合同假设"文件已存在、仅新增 handler"的语义残留。
3. 合同 DoD-3 要求"diff 仅涉及 packages/brain/src/routes/brain.js"。SKILL 流程同时要求写入
   `DoD.md` 与 `docs/learnings/*`，这两项 meta 文件会使 `git diff --name-only main...HEAD` 多于一行，
   也会触发 DoD-3 失败。

### 下次预防

- [ ] Planner 在写 PRD ASSUMPTION 前应 `git ls-tree origin/main | grep <target-file>` 验证文件是否真实存在。
- [ ] Proposer 在写 DoD-4 这类"不新增 require"约束前应确认"目标文件是否 pre-existing"：若为新建文件则改写为"净新增 require ≤ 1 (Router)"或删除该 DoD。
- [ ] DoD-3 的 `git diff --name-only main...HEAD` 应显式排除 `DoD.md` / `docs/learnings/` 等 SKILL 流程产物，或 SKILL 侧约定这两项不进 PR diff 白名单。
- [ ] Generator 遇到合同内部矛盾时应在 PR description 第一段显式声明"因合同 ASSUMPTION 与实际代码冲突，以下 DoD 无法通过"，避免 Evaluator 将合同缺陷记在 Generator 头上。
