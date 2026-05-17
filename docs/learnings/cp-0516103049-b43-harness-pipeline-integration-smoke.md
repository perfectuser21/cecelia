## B43 — harness pipeline A→B→C regression guard（2026-05-16）

### 根本原因

Phase B→C 的状态机转移（`pick_sub_task → run_sub_task → advance → final_evaluate → report`）
完全没有自动化保护：`harness-initiative.graph.full.test.js` 中 3 个关键 e2e 测试全是 `it.skip`
（标注 `LAYER_3_SMOKE_COVERED`），原因是 `runSubTaskNode` 内部走 spawn-and-interrupt 架构，
单进程 vitest 无法模拟 callback router resume。

B40/B41/B42 修复之后，pipeline 首次 PASS（task `d6ea1ffe`），但下次有人改路由逻辑或
节点连接，不会有任何测试报警。

### 下次预防

- [ ] 生产节点函数如果依赖重 I/O（Docker spawn + callback），必须从设计阶段拆出
  `nodeOverrides` 接口，允许测试注入 mock 实现（参考 `buildHarnessFullGraph(nodeOverrides = {})`）
- [ ] `it.skip` + `LAYER_3_SMOKE_COVERED` 标注意味着"完全没有保护"，出现时必须立即用
  nodeOverrides 模式补集成测试
- [ ] vitest mock 路径必须与实际 import 路径完全一致：
  - `harness-graph.js` 不存在，正确路径是 `harness-shared.js`
  - `lib/git-fence.js` 需要显式 mock（否则会跑真实 git 命令）
  - `node:fs/promises` mock 要覆盖 `readdir`（否则 `readFile` 报错时会 fallback 到真实 fs）
- [ ] JS 规范：有默认值的参数不计入 `Function.prototype.length`（`f(x = {}) => f.length === 0`），
  smoke 脚本验证"函数接受参数"应做行为验证（传入参数后结果正确），而非 `.length` 或 `.toString()`
- [ ] `beforeEach` mock reset 列表必须包含 `mockPool.connect`，否则跨测试 mock 泄漏
- [ ] DB transaction mock 序列（`BEGIN / INSERT / INSERT / COMMIT`）必须用 `mockResolvedValueOnce`
  精确排列，顺序错误会导致测试随机失败
