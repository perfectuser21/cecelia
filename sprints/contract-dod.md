---
skeleton: false
journey_type: system
---
# 西安 M4 PF 修复验收

- [x] [BEHAVIOR] PF 身份查询回归已先报红，再修正；新策略双栈绑定 Self，失效不保留业务 pass，精确 bootstrap 与缓存拒绝符合合同。
  Test: manual:python3 tests/regression/tailscale-us-exit/pf-identity-free.test.py -v
- [x] [BEHAVIOR] 原强制器 20 条回归保持；显式新模式不隐式改旧生产。
  Test: manual:bash -c 'cd packages/brain && npx vitest run ../../tests/regression/tailscale-us-exit'
- [x] [BEHAVIOR] Impact Contract 的 MJ5/F1 四个真断言均执行。
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/cascade-list.test.js src/__tests__/dispatch-anchor-gate.test.js src/__tests__/integration/promise-map-nightly.integration.test.js src/orchestrator/__tests__/ground-truth.test.js'
- [x] [BEHAVIOR] 安装器 shell 与所有 Python 实现语法合法。
  Test: manual:bash -c 'bash -n scripts/ops/install-tailscale-us-exit-enforcer.sh && python3 -m py_compile scripts/ops/tailscale-us-exit-enforcer.py scripts/ops/tailscale_us_exit_policy.py scripts/ops/tailscale_us_exit_legacy.py scripts/ops/tailscale_us_exit_activation.py scripts/ops/tailscale_us_exit_lease.py'

生产切换另须明确审批；真实 M4 只读证据在任务 result 中，独立 evaluator 必须真实执行，不能把本清单当生产上线或裁判通过。
