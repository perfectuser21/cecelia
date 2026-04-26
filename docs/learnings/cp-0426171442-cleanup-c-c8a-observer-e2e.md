# Learning — cp-0426171442-cleanup-c-c8a-observer-e2e

## 背景

Brain v2 TDD 清扫 task #3：补 2 个 E2E integration test，自动化原本手动 smoke：
- C8a harness-initiative graph checkpoint resume（PostgresSaver 写 5 checkpoint + thread_id resume）
- observer-runner 真后台 setInterval（独立 timer 跑 3 channel）

### 根本原因

之前 C8a 与 observer-runner 的 happy path 验证只跑过 manual smoke，没有 integration 化。
缺乏自动化 → 后续重构（PR-1 砍 6 module / PR-2 fanout fallback）时 graph 5 节点
checkpoint 写盘 + resume 恢复行为没有 regression 防线，observer-runner setInterval
真后台触发也只在生产 log 里被验证过一次。

### 下次预防

- [ ] integration test 必须跑通完整真路径，不能只跑单节点 mock
- [ ] checkpointer 验证用 vi.spyOn(saver, 'put') 计数 — list() 在不同 saver impl 行为不一
- [ ] 模块级常量读 env 时（observer-runner OBSERVER_INTERVAL_MS）
      ESM hoists imports → 必须用 dynamic import（在 beforeAll 设 env 后再 await import）
      否则 process.env.X = ... 跑在 module load 之后，env 不生效
- [ ] vi.hoisted 内不能引用其他 import（如 MemorySaver）
      会触发 `Cannot access '__vi_import_0__' before initialization`
      解决：把跨 import 依赖的 instance 创建放 beforeAll，vi.mock 工厂闭包引用 module-level let

## 关键决策

### 用 MemorySaver 模拟 PostgresSaver 而非真起 PG

理由：
- 已有相邻测试 (harness-initiative.graph.full.test.js) 同模式 — 一致性
- MemorySaver 实现 BaseCheckpointSaver 接口（list/getTuple/put/putWrites/getNextVersion 等）
  与 PostgresSaver 行为一致，足够验 graph checkpoint/resume 链路语义
- 真 PG 在 CI 上启动慢且不稳

### 用 vi.spyOn(saver, 'put') 计数 checkpoint 写入

替代方案：list({thread_id}) async generator 收集 — 但 MemorySaver 的 list() 行为
受版本影响（只返当前 thread_id checkpoints / 含 history）。put() 计数稳定 — 每节点
graph 调一次。

## 验证

5 节点 graph (prep/planner/parsePrd/ganLoop/dbUpsert) put 调用 5 次（实际 invoke
跑下来 >= 5 — graph runtime 可能在 START/END 也 checkpoint）。
observer-runner OBSERVER_INTERVAL_MS=80 跑 220ms 后 run_count >= 3（init 1 + interval 2-3）。
