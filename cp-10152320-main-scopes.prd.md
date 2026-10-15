# main 固定双来源验证

根任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)。

d920 自然 main 已产生完整双 scope 官方快照，但消费端只检查 KR，导致同树已通过的 PR 在 main 出现六项文件无归属。保留原主 run 模板和 ADMISSION_SCOPES；仅官方 self main push / 严格同仓 main dispatch 明确设置独立 main scopes。

原单入口消费该显式参数，校验 mode、repo、顶层 scope 和固定双 scope schema，按 main 读取两份官方 bundle；保留中央版本 ID，不构建 PR candidate。联合证据和实际回归收据使用 main_verification，业务运行仍 not_evaluated。PR、其他仓库、single 与巡查旧路径不隐式扩展；无效输入不能降级通过。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| ws1 | `packages/brain/src/lib/__tests__/implementation-pr-gate.test.js` | `main显式双scope经真实单入口选择main验证，缺源明确拒绝` |
| ws1 | `packages/brain/src/lib/__tests__/implementation-pr-gate.test.js` | `main双scope拒绝非main污染、外仓、错顶层scope和非法schema` |
| ws1 | `packages/brain/src/__tests__/integration/implementation-multi-scope.test.js` | `main联合证据保留真实用途并执行每scope回归，PR输出不变` |

正式 d920 原失败与新固定 main 完整官方 bundle 做真实 CLI 端到端核验；旧可信 collector 必须认领全部改动。若旧工具不认领，改走正规自举，不削弱范围或断言。
