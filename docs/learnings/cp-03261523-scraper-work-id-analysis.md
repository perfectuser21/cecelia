# Learning: 8平台 scraper work_id 关联分析

**Branch**: cp-03260820-da685fbf-15c4-4a5f-9473-3a89a8
**Date**: 2026-03-26
**Task**: [codex] 审查数据采集+work_id关联

---

### 根本原因

Codex 西安机器因 OpenAI 连接超时（`chatgpt.com/backend-api/codex/models` 拒绝连接）连续3次失败，任务回落到美国 Mac mini /dev 执行。

---

### 关键发现

1. **work_id 关联覆盖率 3/8**：快手/抖音/微博已实现，视频号/头条/公众号/小红书/知乎尚未实现

2. **视频号 DB 约束缺口**：`publish_logs.platform_check` 约束不含 `channels`，导致视频号即使实现了 work_id 逻辑也无法写入 DB

3. **各平台 platform_post_id 来源差异**：
   - API 拦截类（快手/抖音/微博）：能直接获取原生 ID，实现相对容易
   - DOM 抓取类（头条/公众号/小红书）：难以获取原生 ID，需改为 API 拦截或 DOM data 属性
   - API 注入类（知乎）：有 ID 但完全无 DB 写入基础设施

4. **当前数据为空**：`works` 和 `publish_logs` 表均为 0 行，即使现有的 work_id 关联代码也从未实际执行成功

---

### 下次预防

- [ ] 分析任务被 Codex 连续超时时，应尽早降级到美国本机而非重试3次
- [ ] 改造 scraper work_id 时，**先检查 publish_logs platform 枚举**是否包含目标平台
- [ ] 知乎 scraper 改造需分两步：先加 DB 基础设施，再加 work_id 关联
- [ ] DOM 抓取的 scraper（头条/公众号/小红书）难以获取原生 ID，优先考虑改为 API 拦截
