## PR 正文必须保留任务登记的 GP 锚点（2026-10-12）

### 根本原因

真实 ZenithJoy PR #2132 的 payload 已登记 `none(infra)`，runner 只把该值写入 `.dev-mode`，未传活动信封；publish 正文也缺声明，导致 GP-ANCHOR-MISSING。该 PR 由有头会话补真实正文并 reopen 后重跑 CI，不能记为无人干预成功。

### 下次预防

- [x] 对元数据用真实 runner → publish → fake GH 参数验收；只测手工构造的 publish 输入不足。
- [x] 固定目标仓库原始 lint 脚本验生成正文，不复制正则冒充消费端验证。
- [x] 缺失锚点保持不声明，不采用 `.dev-mode` 的兼容豁免；非法多行/控制字符提前拒绝。
- [x] 保留红测 commit 5734fc1c8：17 failed / 63 passed；实现后 80 passed。

Actor: Codex。登记任务：5ca3f73e-7869-40b3-af3c-81ab0d49a028。
