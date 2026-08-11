# Universal Map Knife 3 Contract

## Scope

Anchor Resolver + Query-time State Resolver + Impact Radius。只接现有 Projection Core，不交付 Unified Map HTTP 读端点或 Dashboard。

## Hard contracts

- scope 与 repo 必须经显式 adapter 配置，禁止猜测同名。
- Capability 仅经 `journeys.capability_code` 稳定 key 归属，Feature 仅经 UUID，artifact 仅经 registry 稳定标识精确命中。
- 锚点歧义不任选；目标消失且快照新鲜时 gray，快照陈旧时 unknown。
- PASS/FAIL receipt 必须绑定当前 source revision；revision mismatch 一律 unknown。
- 旧 `cell_status` 不得贡献权威颜色；projection 不保存权威颜色。
- radius 必须 repo 隔离、顺序确定，Cross-cut 影响范围不得为空。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 显式 repo adapter | `packages/brain/src/lib/__tests__/map-repo-adapter.test.js` | 未配置 scope 时 fail closed | 实现前缺 adapter loader，测试失败 |
| 精确锚点解析 | `packages/brain/src/lib/__tests__/map-anchor-resolver.test.js` | 路径锚点命中多个 repo 时不任选候选 | 实现前歧义锚点被错误投影或模块缺失 |
| 原子确定性投影 | `packages/brain/src/__tests__/integration/map-projection-store.integration.test.js` | 重建得到同 digest 与同 stable IDs | 实现前真实 PostgreSQL 投影缺锚点或 digest 漂移 |
| 查询时五态 | `packages/brain/src/__tests__/integration/map-state-resolver.integration.test.js` | 同一 active projection 现算 green→gray→red→unknown | 实现前状态 reader 缺失，四态演习失败 |
| repo 隔离影响半径 | `packages/brain/src/__tests__/integration/map-state-resolver.integration.test.js` | 真实 graph snapshot 按 repo 回溯到业务节点和必跑断言 | 实现前 radius 缺业务回溯或跨 repo 污染 |
| scratch 真验火 | `packages/brain/scripts/smoke/map-anchor-state-smoke.sh` | green→gray→red→unknown 与 fixture 清零 | 任一状态规则未生效或有残留时脚本失败 |

## Excluded

HTTP 统一读入口、Dashboard 消费、ZenithJoy adapter 与 Harness/Island Gate 收权，分别由 Knife 4/5 验收。
