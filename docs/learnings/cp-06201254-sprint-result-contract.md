# Learning: pipeline 在 sprint 边界开环——产出写而不读

**分支**: cp-0620124828-sprint-result-contract
**日期**: 2026-06-20
**Decision**: 75b66ad3-498b-490e-95d2-a4c29bf372fd

## 背景

审查 harness pipeline 时，主理人反复有"几个东西差一点点、非系统性、怪怪的"的体感。逐项查下来，报告不清晰、跨 initiative 不接力、合并后 bug 不自动立案——表面是 3 个独立缺陷。

### 根本原因

这 3 个不是 3 件事，是**同一个结构缺陷的 3 处漏点**：pipeline 在**一个 sprint 内部**闭环很好（generate→CI→evaluate→修→合），但**在 sprint 边界开环**——sprint 的产出（报告、learning、新 skill/test、发现的 bug）全是**只写不读**：

- `report_content` 写进 DB → 零消费者读（实测 grep：无任何代码/测试读它）
- learning 写进文件 → 下个 proposer 不读
- 产出的 skill/test/decision 入库 → 下个 planner 不继承
- bug 进 issue → 没人据此自动立案

"每次都能跑，但跑完之间不咬合、产出不复利、边界漏"——这就是**开环**的体感，就是"非系统性、差一点点"的真身。按 4 个症状各修各的，只会做出 4 个补丁，把"补丁感"做实。

### 下次预防

- [ ] 评估一个系统"为什么感觉非系统性"时，先问："它的产出是被下一环节读回去了，还是只写不读（开环）？" 开环是"差一点点"体感的常见根因
- [ ] 多个边界缺陷（报告/接力/立案）若都发生在"某阶段结束之后"，优先怀疑它们是**同一个缺失边界处理器**的多处漏点，先找共同的产物契约（SSOT），别各打各的补丁
- [ ] 闭环的钥匙是**一份统一的产物契约**：所有边界读取者读它这一个；先定契约（骨架），再并行接读取者（肉），不要先并行补丁
- [ ] 改"只写不读"的数据结构 key 名前，先 grep 确认零消费者（本次确认 report_content 无人读 → 改名安全）

## 本次落地（Phase 1 骨架）

- 新建 `sprint-result-contract.js`：四段契约（结果/产出资产/发现/遥测）的 build + validate 纯函数
- reportNode 用它产出 `report_content`（SSOT），现可填字段填，Phase2 采集字段留 stub+TODO
- Phase 2（另立）：读取者①展示②继承④立案 + 上游采集器（node_telemetry 逐节点 token / incidental_bugs / produced_assets）
