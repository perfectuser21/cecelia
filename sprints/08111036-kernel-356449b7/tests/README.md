# TDD RED 测试落位说明（本 sprint）

本 sprint Invariant「vitest 范围」硬规则：新增 test 必须落在 `packages/brain/vitest.config.js`
的 include（`src/**/*.{test,spec}...`）范围内才算真回归——`sprints/**` 不在 include，放这里
的测试不会进 CI（绿态也退出 0，假回归）。故本 sprint 三个 RED 回归测试**直接落位于**
package 内 CI include 范围（已由 proposer 提交，当前对未改源码为 RED）：

| 测试文件（CI include，永久回归） | 覆盖 Golden Path 步骤 |
|---|---|
| `packages/brain/src/orchestrator/__tests__/quota-exhaustion-classify.test.js` | Step 1-2：429 weekly limit → account_exhausted；偶发 429 → runner_failure |
| `packages/brain/src/orchestrator/__tests__/derive-account-exhausted.test.js` | Step 3-4：account_exhausted 非终态重派；runner_failure 仍终态 |
| `packages/brain/src/orchestrator/preflight/execution-targets-capped.test.js` | Step 5-7：CAPPED 跳过轮换 account2；全 CAPPED→blocked；不可达降级不 crash |

RED 证据（proposer 阶段实跑）：三文件共 11 用例，5 个新行为用例 RED（源码未改），
6 个回归护栏用例 GREEN。generator 实现三处源码改动后应全绿。

DoD 的 [BEHAVIOR] manual:bash 命令与 ## E2E 验收 脚本均指向上表 CI-include 路径。
