# RED 证据 — Sprint r80 结构化上报保真透传

冻结合同主线 `tests/provider-exit-fidelity.test.js` 随 `chore(harness): import contract` 已在分支上（relay 常态，TESTS_ALREADY_PRESENT）。
补充回归行 `tests/gp/f1/step3-provider-exit-fidelity-r80.test.js` 本 Red commit 新增。
实现落地前（本 commit 时点），两文件全红，符合 TDD Red 预期：

## kernel 主线（10 条全红 — 被改模块未导出）

```
FAIL provider-exit-fidelity.test.js > A. 病族边界 SSOT
  TypeError: isInfrastructureErrorCode is not a function   (A1/A2/A5)
  TypeError: isContractFaultCode is not a function          (A3/A4)
FAIL provider-exit-fidelity.test.js > B. failed_targets 拉黑过滤
  TypeError: __test__.filterBlacklistableTargets is not a function  (B1-B5)
Tests  10 failed (10)
```

## entrypoint 补充线（9 条全红 — detect_structured_terminal 未定义）

```
FAIL tests/gp/f1/step3-provider-exit-fidelity-r80.test.js
  Error: entrypoint.sh 原文缺少函数 detect_structured_terminal()
Tests  10 failed (提取阶段抛错，全 describe 红)
```

根因链（病根三实证）：runner/entrypoint 在 CLI 退出码非零时一律降级为 `provider_exit`
→ 真因（CONTRACT_* 码 / success 结果）被埋没 → kernel 把合同故障当基础设施病族重试并拉黑 target → run 死。
（r69 attempt 56a09164 / r76 同类 / r77 attempt e022a331）

## GREEN（实现落地后）

```
✓ sprints/.../tests/provider-exit-fidelity.test.js  (10 tests)
✓ tests/gp/f1/step3-provider-exit-fidelity-r80.test.js  (9 tests)
Tests  19 passed (19)
```
