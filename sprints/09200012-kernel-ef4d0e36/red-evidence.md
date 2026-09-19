# Red 阶段证据（bugfix 快车道 / direct profile 契约）

契约类型：`direct-profile-contract-policy/v1`，change_kind=`bugfix`。
冻结的 required_assertion 只有一条，作为能力 F1「开发闭环」的回归护栏：

```
命令: npx vitest run packages/brain/src/orchestrator/__tests__/ground-truth.test.js
覆盖: F1
```

## 为什么这是回归护栏而非新增失败规格
本契约是「bugfix 快车道 #5429 的实弹验证」（见 sprint-prd.md）。合同 tests 目录随
`chore(harness): import contract` 预置的唯一制品是 `tests/impact-contract.md`（断言清单，
非可运行测试）。`ground-truth.test.js` 是仓库既有测试，被 impact contract 绑定为 F1 能力
的粗粒度回归护栏——它不是针对本次改动的单元规格，而是保证「开发闭环」核心逻辑
（collectGroundTruth / derive）在 bugfix 落地后不回归。

## 缺陷根因（run 0f36a253 hop 20/27 实证）
fleet-worker `/health` 冷探测 2.4–6s（fleet-worker.cjs 注释自述 4–6s）。历史上 admission
client 5s 超时 → 探测未完成即 AbortError → signature=worker_timeout，被
`admittedNode` 与真离线一视同仁地压平为 `node_not_base_admitted`，每轮 attempt 白等
1–2 分钟。

契约给出二选一修法：
- (a) worker /health 探测中先返回上一份缓存报告；
- (b) admission client 超时 ≥10s，并把 probe 超时与真离线分类区分开。

## 基线现状（红/绿判定）
- `packages/brain/src/orchestrator/preflight/production-probes.js` 在 base_sha
  `5102860a5f7b40303e77e3d2ab2d824f27e89a7e` 已把 `DEFAULT_NODE_ADMISSION_TIMEOUT_MS`
  设为 `20_000`（≥10s，(b) 的超时部分已落地）。
- (b) 的第二部分「probe 超时 vs 真离线分类区分」尚缺：`admittedNode` 对所有非 base-admitted
  失败一律返回 `node_not_base_admitted`，丢弃了底层 `worker_timeout` 这一瞬时冷探测信号。

required_assertion 基线执行（F1 回归护栏，实现落地前）：

```
npx vitest run packages/brain/src/orchestrator/__tests__/ground-truth.test.js
 Test Files  1 passed (1)
      Tests  87 passed (87)   # numTotalTests=87 numPassedTests=87 numFailedTests=0
```

Green 阶段将补齐 (b) 的分类区分（surface `node_probe_timeout`），并复验该护栏仍全绿。
