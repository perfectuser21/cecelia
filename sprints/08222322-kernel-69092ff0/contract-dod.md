---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: runner_failure 有界重派计数按角色窗口化（priorRunnerFailures per-role）

**范围**: `packages/brain/src/orchestrator/derive.js` 中 `priorRunnerFailures` 统计逻辑增加同角色过滤条件（`callbackDetail(r).role === role`，role = `callbackDetail(row).role`）；不触碰路由/阈值/其它 failure_class 分支。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] derive.js 的 priorRunnerFailures filter 含同角色过滤条件
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');const i=c.indexOf('priorRunnerFailures');const seg=c.slice(i,i+400);if(!/callbackDetail\(r\)\.role\s*===\s*role/.test(seg))process.exit(1)"
  期望: exit 0（filter 段出现 `callbackDetail(r).role === role`）

- [x] [ARTIFACT] 冻结合同测试文件存在且断言按角色窗口化
  Test: node -e "const c=require('fs').readFileSync('sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js','utf8');if(!c.includes('callback_runner_failure_retry')||!c.includes('publish:approved_ref'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] [L2] B-01: 跨角色 runner_failure 不再互耗额度——evaluator 2 败后 publisher 首败仍可重派
  动作: 调 derive()，喂 decisionLog：evaluator 2 次 runner_failure（hop3/6）后 publisher 首次 runner_failure（hop9）
  预期观察: derive 返回 `{phase:'publish',action:'publish:approved_ref',reason:'callback_runner_failure_retry'}`（不再被 evaluator 额度耗尽）
  等待预算: 0s
  留证: 命令输出（`1 passed (1)`）
  Test: manual:bash -c 'npx vitest run sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js -t "跨角色 runner_failure 不再互耗额度" --reporter=dot 2>&1 | grep -q "1 passed (1)"'

- [x] [BEHAVIOR] [L2] B-02: 同角色 runner_failure 3 连败第 3 次仍进人审（负向语义不变）
  动作: 调 derive()，喂 decisionLog：publisher 3 次连续 runner_failure（hop3/6/9）
  预期观察: derive 返回 `{phase:'review',action:'wait:human_review',reason:'callback_runner_failure_exhausted'}`（窗口化未放宽阈值）
  等待预算: 0s
  留证: 命令输出（`1 passed (1)`）
  Test: manual:bash -c 'npx vitest run sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js -t "同角色 runner_failure 3 连败第 3 次仍进人审" --reporter=dot 2>&1 | grep -q "1 passed (1)"'

- [x] [BEHAVIOR] [L2] B-03: 缺 role 字段的历史 runner_failure 行不计入当前角色窗口
  动作: 调 derive()，喂 decisionLog：2 次 role 缺失的 runner_failure 后 publisher 首次 runner_failure
  预期观察: derive 返回 `{phase:'publish',action:'publish:approved_ref',reason:'callback_runner_failure_retry'}`（role-less 行不匹配 publisher 窗口，保守等价旧行为子集）
  等待预算: 0s
  留证: 命令输出（`1 passed (1)`）
  Test: manual:bash -c 'npx vitest run sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js -t "缺 role 字段的历史 runner_failure 行不计入当前角色窗口" --reporter=dot 2>&1 | grep -q "1 passed (1)"'

- [x] [BEHAVIOR] [L2] INV-额度语义 既有 derive 有界重派回归保持绿（bounded ≤2 语义无回退）
  动作: 跑既有 packages/brain 单测中 `runner failure retries bounded` 用例
  预期观察: 该用例 GREEN，同角色 ≤2 有界重派 + 第 3 次 exhausted 语义不变
  等待预算: 0s
  留证: 命令输出（`1 passed (1)`）
  Test: manual:bash -c '(cd packages/brain && npx vitest run src/orchestrator/__tests__/derive.test.js -t "runner failure retries bounded" --no-cache --reporter=dot 2>&1) | grep -q "1 passed (1)"'

## Invariant 覆盖（历史约束三源 — 铁律映射）

- INV-额度语义: 由上方 B-02（同角色 3 连败第 3 次仍 exhausted）+ B-04（既有 bounded 回归绿）覆盖，窗口化不放宽阈值
- INV-BEHAVIOR封印: N/A（本条为 GAN 阶段封印机械校验约束，非交付物运行时行为——由 Test Contract 表 BEHAVIOR↔it() 子串校验满足，见 contract-draft.md ## Test Contract）
- INV-冻结纪律（run 在途 Commander 不合 PR）: N/A（Commander 合并纪律，本 sprint 不触及 Commander/合并路径）
- INV-凭据隔离: N/A（本 sprint 无多人凭据/账号操作，纯 kernel 纯函数改动）
