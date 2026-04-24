# C7 checkpointer singleton Learning

## 背景

Brain v2 Phase C7 —— 执行 handoff §3 定义的清理：移除 `executor.js` + `routes/content-pipeline.js` 共 3 处 inline `PostgresSaver.fromConnString(...) + setup()`，全部改走 C1 建立的 `orchestrator/pg-checkpointer.js` 单例 `getPgCheckpointer()`。消除重复 checkpointer 实例 + 统一走 Brain v2 L2 中央路径。

## 根本原因

C1 阶段建立 `orchestrator/pg-checkpointer.js` 作为统一单例入口，但 executor.js / content-pipeline.js 既有代码仍各自 inline 初始化，原因是 C1-C6 在推 `.graph.js` 搬家时没一并清理 caller 层面的重复。C7 的价值：

1. 三处共用同一 PostgresSaver 实例，节约连接池
2. `setup()` 只执行一次（幂等 `_setupPromise` 共享），避免并发 setup race
3. 以后新增 graph 时统一路径，不出现第四处散建

**import 路径相对层级陷阱**：`routes/content-pipeline.js` 在 `packages/brain/src/routes/` 下，必须用 `'../orchestrator/pg-checkpointer.js'`（多一层 `..`），而不是 `'./orchestrator/...'`。`node --check` 只查 syntax 不查 import 解析，错误要等 runtime 才爆。

**副产品**：更新 `executor-langgraph-checkpointer.test.js`（旧测试直接断言 inline 行为 `PostgresSaver.fromConnString` / `checkpointer.setup()`，C7 后改为断言"零 inline + 两处 `getPgCheckpointer`"）。这是结构断言测试在 refactor 时的典型维护成本。

## 下次预防

- [ ] 新增 `await import()` 相对路径前，核对当前文件所在目录层级（`src/` vs `src/routes/` vs `src/orchestrator/`）
- [ ] C1 阶段建立新单例时，同 PR 内列出所有 caller 并清理，不留"etl tech-debt 下次再扫"
- [ ] grep 自查命令：`grep -rn "PostgresSaver.fromConnString" packages/brain/src/ --include="*.js" | grep -v node_modules | grep -v __tests__ | grep -v pg-checkpointer.js` 必须返回空
- [ ] 合并后 Brain redeploy 必做，验证 `docker exec cecelia-node-brain node -e "(async()=>{const{getPgCheckpointer}=await import('./src/orchestrator/pg-checkpointer.js');const cp=await getPgCheckpointer();console.log(cp.constructor.name)})()"` 返回 `PostgresSaver`
- [ ] refactor 时优先看有没有"结构断言"测试（grep-based test on source string），这种测试对 refactor 最脆弱，必须同步更新

## 相关

- PR: 本 PR
- Handoff: `docs/design/brain-v2-c6-handoff.md` §3 C7 定义
- Design: `docs/superpowers/specs/2026-04-24-c7-checkpointer-singleton-design.md`
- Plan: `docs/superpowers/plans/2026-04-24-c7-checkpointer-singleton.md`
- Spec SSOT: `docs/design/brain-orchestrator-v2.md` §6
- Singleton source: `packages/brain/src/orchestrator/pg-checkpointer.js`（C1 #2583 建）
- 预存在 flake（与 C7 无关）：`harness-parse-tasks.test.js` 12 fails on main，外部 SKILL.md 格式校验
