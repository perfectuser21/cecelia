## Brain {VERSION} — 树+仓库 v3.0 第 4 刀（路 A）：契约 Step 的读回终于进 Brain，不写读回不许过

- 任务 3590ec8f：生产里获客线 44 个 Step 的读回全是空对象，不是合同没写，而是同步映射错了——合同把读回写在 `dod.readback`、模式写在 `dod.mode`，同步却只认 `step.readback`；且生产同步根本没开 Step 同步（只有 CI 快照路径开着）。
- 映射集中到 `lib/contract-steps.js`：读回取 `dod.readback`、模式取 `dod.mode`，名字、动作（实现引用，按脚本精度）、进出（`reads` / `writes`）一并落库；失败处理只认合同显式写的 `retry:N` 或 `abort`，没写就是空，不编造。
- `syncSteps` 写新列（name / action / inputs / outputs / on_fail）：新列只在来源带了才进指纹，旧来源（`step-dod.json`）的指纹不变、也不会把已同步的新列清空；库里没有这些列的旧夹具自动退回只写老字段。
- 生产同步（`backbone-contract-sync`，30 分钟一轮）默认同时落 Step；下一轮起获客线 Step 读回自动补齐，另一条标杆链接获客线的 Step 也会入库。
- 硬闸「不写读回不许过」：同步 Step 前先验每个 Step 都有 `dod.readback`（`type: none` 必须写原因，与合同 schema 同口径），缺口一次列全、整轮拒绝、不写任何库，按同步滞后处理（超 2 小时告警）。
- 测试夹具：共享合同夹具与活动合同同步测试里的 Step 补上 `dod`，与真实合同形状一致。
