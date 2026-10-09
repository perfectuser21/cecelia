# Contract — orchestrator 远程化 + 机器角色模型

## Test Contract

| 覆盖点 | Test File | BEHAVIOR 覆盖 | 类型 |
|---|---|---|---|
| machine-registry primary 唯一性 | `packages/brain/src/__tests__/machine-registry.test.js` | `恰好一台 primary` | BEHAVIOR |
| step3 远程派发 | `tests/gp/f1/step3-orchestrator-remote-launch.test.js` | `闸=false + kernel-v1 headless → 经桥 prepare+start，不本机 spawn` | BEHAVIOR |
| step3 非 kernel 拒绝 | `tests/gp/f1/step3-orchestrator-remote-launch.test.js` | `闸=false + 非 kernel 路径 → 仍拒绝` | BEHAVIOR |
| orchestrator-runner 槽位 | `packages/brain/scripts/fleet-worker/orchestrator-runner.test.cjs` | `槽位独立：满员 prepare 抛 orchestrator_slots_exhausted` | BEHAVIOR |
| kernel-liveness 租约判死 | `packages/brain/src/lib/__tests__/kernel-liveness.test.js` | `租约过期 + 心跳过期 → dead` | BEHAVIOR |
| broker 锁行为（primary 放行半支） | `packages/brain/src/orchestrator/credential-broker.test.js` | `primary worker（resolvePrimaryWorkerId()）放行：issue 走到凭据加载` | BEHAVIOR |
| 闸关必有远程执行路径 | `packages/brain/scripts/smoke/orchestrator-remote-launch-smoke.sh` | — | SMOKE |

> BEHAVIOR 覆盖列均为对应测试文件真实 `it()` 名的连续子串（逐条核对，非照抄 brief 猜测）。`.sh` 行免匹配。
>
> **broker 锁行为一行的已知盲区（如实说明，不隐瞒）**：`credential-broker.test.js` 里「非 primary fail-closed」的断言实际写法是 `it.each([['非 primary 机器（us-vps）', 'us-vps'], ['未知控制器（undefined）', undefined]])('%s fail-closed，错误码不变', async (...) => {...})`——`check-test-coverage.cjs` 用来抓 it 名的正则是 `\b(?:it|test)\(['"]`，只认紧跟 `it(`/`test(` 后面直接是引号的单段调用，`it.each(array)(templateString, fn)` 这种两段调用它抓不到，且模板串本身是带 `%s` 占位符的通用文案，不含"非 primary"字样。这是检查器本身的盲区，不是本合同漏测——`assessKernelLiveness`/broker 的非 primary fail-closed 断言真实存在且已跑绿（见下方 DevGate 全量测试结果），只是这道 CI 闸暂时看不见它。本行因此只锚定可被工具捕获的「primary 放行」半支。

