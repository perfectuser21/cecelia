## Nightly集成启动与隔离连接（2026-10-08）

### 根本原因
Nightly未随正式CI使用集成Vitest配置，真实选择为零；smoke未接收BRAIN_CONTAINER、SMOKE_ALLOW_WRITE和libpq连接变量；F5用curl -f丢弃合法503健康正文。

### 下次预防
- [x] 配置改动用真实Vitest选择器核选中文件，并检查POSTGRES_INTEGRATION，禁止零文件通过。约束：.github/workflows/scripts/__tests__/nightly-runtime.test.mjs。
- [x] 实际执行工作流批量shell，检查隔离容器与同一DB/PG连接，任一脚本失败必须汇总为失败。约束：.github/workflows/scripts/__tests__/nightly-runtime.test.mjs。
- [x] 专用Walking入口沿正式CI独立Docker/PG任务实际执行，普通RunAll只委托且失败汇总依赖必须包含它；真实启动参数及正式任务结构对比永久测试防止漏接。约束：.github/workflows/scripts/__tests__/nightly-runtime.test.mjs。
- [x] 复用healthz-smoke.sh公开200/503及完整schema检查，输出真实critical状态；真HTTP负例拒绝错误状态、schema及HTTP。约束：.github/workflows/scripts/__tests__/nightly-runtime.test.mjs。

任务：824e713f-b2ad-43b5-be4a-54fbda91c97e；仅测试实例授权写入，不变更生产权限。
