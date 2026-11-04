# Cecelia System Catalog

> 这是仓库静态资料索引，不代表生产全量、实时成熟度或技能真身。当前运行状态与台账通过 Brain API 读回；架构入口见 [DEFINITION.md](../../DEFINITION.md)。

## 5 张表索引

| 表 | 文件 | 记录什么 | 粒度 |
|---|---|---|---|
| Feature Registry | [features/](features/) | 静态功能资料 | 一个可交付的能力 |
| Skill Registry | Brain `skill_registry`／`GET /api/brain/registry?type=skill` | 当前技能登记；[旧清单](skill-registry.yml)仅历史参考 | 一个技能条目 |
| Test Registry | [test-registry.yml](test-registry.yml) | 有哪些测试、覆盖什么 | 一个测试文件 |
| API Registry | [api-registry.yml](api-registry.yml) | 有哪些接口 | 一个 endpoint |
| Decision Registry | Brain DB `decisions` 表 | 做了哪些架构决策 | 一个技术决策 |

---

## 历史静态盘点（不代表当前覆盖率）

| 子系统 | 功能数 | 测试覆盖 | 文档状态 |
|---|---|---|---|
| Brain 任务系统 | 6 | ✅ unit + e2e | ⚠️ 无 ADR/Runbook |
| Brain 记忆系统 | 7 | ⚠️ 部分 unit | ❌ 无文档 |
| Brain 编排系统 | 8 | ⚠️ 部分 unit | ❌ 无文档 |
| Brain 决策系统 | 9 | ⚠️ 部分 unit | ❌ 无文档 |
| 内容管道 | 8 | ❌ 无 | ❌ 无 |
| 发布系统 | 11 | ❌ 无 | ❌ 无 |
| Engine /dev | 3 skills | ⚠️ unit only | ⚠️ steps/*.md |
| Workspace | 9 | ⚠️ 部分 | ❌ 无 |

---

## 成熟度说明

```
Level 0  只有代码，无文档无测试
Level 1  代码 + PRD + DoD
Level 2  + Unit Test
Level 3  + Integration Test + ADR
Level 4  + E2E Test + API Docs
Level 5  + Runbook + Regression Test（生产级）
```

---

## 维护规则

- 静态功能资料索引位于 `features/`，不能据此推断已经部署或被真实消费者调用。
- 技能登记以 Brain `skill_registry` 为准，通过 `POST /api/brain/skills` 写入；旧 Skill 清单不再作为新增规则。
- API 与测试静态索引用于检索，实际入口、测试选集及 CI 阻挡关系以当前源码和工作流为准。
