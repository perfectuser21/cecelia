# Learning — Brain MINIMAL_MODE 支持

### 根本原因
Brain tick.js 中所有自动调度（内容线、认知系统、巡检、告警）硬编码在 tick 主循环中，
没有统一的开关，导致无法按需关闭，持续消耗 token。

### 解决方案
新增 `BRAIN_MINIMAL_MODE=true` 环境变量，在 tick.js 中统一用 `if (!MINIMAL_MODE)` 包裹：
- 0.5.5 / 0.5.6 Content Pipeline 编排和执行
- proactiveTokenCheck（避免生成告警 research 任务）
- 10.x 全部（daily code review / arch_review / diary / 内容线 / memory sync 等）

### 下次预防
- [ ] 新增自动调度 section 时，默认加 `if (!MINIMAL_MODE)` guard
- [ ] BRAIN_QUIET_MODE 覆盖范围仅 LLM 认知调用，非 LLM 调度用 MINIMAL_MODE
