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

## Excluded

HTTP 统一读入口、Dashboard 消费、ZenithJoy adapter 与 Harness/Island Gate 收权，分别由 Knife 4/5 验收。
