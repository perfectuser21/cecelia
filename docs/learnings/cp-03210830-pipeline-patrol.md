# Learning: Pipeline Patrol 巡航模块

## 变更概述
实现 `packages/brain/src/pipeline-patrol.js` 作为 Brain tick 新周期性模块，扫描 `.dev-mode` 文件检测卡住/孤儿 pipeline 并自动创建修复任务。

### 根本原因
Brain tick 缺少对 dev pipeline 本身的监控。当 agent 的 pipeline 在某个 stage 卡住（CI 等待超时、代码阶段长时间无进展）或进程死亡但 pipeline 未完成时，没有自动检测和修复机制。Pipeline Patrol 填补这个空白，与 zombie-sweep / health-monitor 平级。

### 下次预防
- [ ] 新增 tick 周期性模块时，参考 zombie-sweep 的模式（fire-and-forget + non-fatal catch）
- [ ] .dev-mode 文件解析需要考虑旧格式兼容（step_4_learning vs step_4_ship）
- [ ] 进程存活检测使用 ps + grep 有误报风险，后续可改为检查 .dev-lock 文件的 flock 状态
