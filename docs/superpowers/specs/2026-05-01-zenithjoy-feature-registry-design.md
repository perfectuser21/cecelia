# ZenithJoy Feature Registry Migrations — Design

**Goal:** 将 ZenithJoy 系统的 87 个 feature 注册到 Brain feature registry，并扩展 Notion 同步脚本支持新 domain。

**Architecture:** 三个 SQL migration 文件（纯 INSERT + ON CONFLICT DO NOTHING），一个 sync 脚本扩展。不涉及 src/ 代码改动，无需测试文件。

**Tech Stack:** PostgreSQL migration, Node.js sync script

---

## 文件清单

| 文件 | 内容 |
|------|------|
| `migrations/251_zenithjoy_publisher_features.sql` | 12 个发布平台 feature（8 平台发布器 + 图文分发 + 素材抓取 + NAS 备份） |
| `migrations/252_zenithjoy_full_features.sql` | 37 个完整 feature（media/creator/scraping/ai-gen/research/platform-auth/label） |
| `migrations/253_zenithjoy_missing_features.sql` | 38 个遗漏 feature（Agent 自检/License/Works CRUD/Creator 服务/JNSY 标注扩展） |
| `scripts/sync-features-to-notion.mjs` | 新增 7 个 domain 的 Area/Sub Area 映射 |

## 测试策略

- 纯数据 migration（无 schema 变更）→ trivial：migration 幂等，ON CONFLICT DO NOTHING 保证安全
- sync 脚本已本地验证（246 features 全量同步至 Notion 成功，0 错误）
- smoke 状态：237/246 passing，9 failing 均为 JNSY label 服务（在 HK VPS，本机不起）

## 成功标准

- 三个 migration 文件进入代码库
- sync 脚本的新 domain 映射进入代码库
- PR 通过 CI（纯 migration + 脚本，不触发 lint-test-pairing / lint-feature-has-smoke）
