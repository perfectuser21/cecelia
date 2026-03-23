# Learning: capability-scanner 孤岛误判修正

**分支**: cp-03230503-b0a1c374-a23f-4815-b60d-a367c8
**PR**: #1463
**日期**: 2026-03-23

---

### 根本原因

capability-scanner 的证据查找逻辑假设所有能力都会在 Brain DB 留下痕迹（run_events、cecelia_events 或 key_tables 指向有数据的表）。但有两类能力天然不满足这个假设：

1. **外部基础设施能力**：Tailscale、CI/DevGate、Cloudflare Tunnel、NAS、VPN 等——它们"正在运行"是事实，但运行证据在各自系统而非 Brain DB，导致扫描器找不到证据 → 误判为 island
2. **key_tables 未填或填错**：`credential-management`、`multi-platform-publishing`、`ai-driven-trading` 的 key_tables 为空或指向不存在的表，即使对应表有数据也无法被扫描器找到

### 下次预防

- [ ] **注册新能力时同步填写 key_tables**：如果能力操作某个 DB 表，必须在 capabilities 表的 key_tables 字段填写，否则扫描器会误判
- [ ] **区分能力类型时考虑证据路径**：外部基础设施类能力无 DB 证据路径是正常的，不应和 brain-embedded 能力用同一套标准评估
- [ ] **新增外部基础设施能力时更新 INFRA_DEPLOYED_CAPABILITIES**：在 capability-scanner.js 的常量集合中显式登记，避免下次扫描时再次误判
- [ ] **迁移后用 capability-scanner API 验证**：每次跑完 migration 后调用 `/api/brain/capabilities` 验证 island 数量回到预期值

### 技术方案选择理由

选择在代码层（`INFRA_DEPLOYED_CAPABILITIES` Set）而非 DB 层处理外部基础设施能力：
- 外部基础设施是架构事实，不随数据变化，适合硬编码在扫描器逻辑中
- 避免在 capabilities 表加 `type` 字段引入过多 schema 变更
- Set 查找 O(1)，性能无影响
