# Learning: skill-creator 接入 Brain Registry API

### 根本原因

skill-creator 的 Step 0 查重依赖静态文件 `.agent-knowledge/skills-index.md`，而该文件需要手动维护容易过期。
本次 PR #1595 已引入 Brain `system_registry` 表作为全局 SSOT，但 skill-creator 尚未接入。
导致即便 registry 存在，创建 skill 前的查重仍走静态文件，不能保证实时准确。
根本缺口：工具创建流程和注册表之间没有闭环，信息孤岛依然存在。

### 解决方案

skill-creator SKILL.md Step 0 改为：
1. 先调 `GET /api/brain/registry/exists?type=skill&name=/xxx` 精确查重
2. 再调 `GET /api/brain/registry?type=skill&search=关键词` 搜索相似
3. Brain 不可用时降级到静态文件（保持向后兼容）
4. 创建后调 `POST /api/brain/registry` 登记，形成闭环

### 下次预防

- [ ] 任何新增 skill 后自动触发 POST /api/brain/registry 登记（可考虑加 hook）
- [ ] skills-index.md 定期从 registry 重新生成，而不是手动维护
- [ ] skill-creator 创建模板里加 registry 登记步骤作为最后一步
