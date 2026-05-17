# Cecelia System Catalog

> 这是 Cecelia 的完整系统地图。每次新增功能，必须更新对应的 Registry 文件。

## 5 张表索引

| 表 | 文件 | 记录什么 | 粒度 |
|---|---|---|---|
| Feature Registry | [feature-registry.yml](feature-registry.yml) | 系统能做什么 | 一个可交付的能力 |
| Skill Registry | [skill-registry.yml](skill-registry.yml) | Agent 能执行哪些指令 | 一个 /skill 命令 |
| Test Registry | [test-registry.yml](test-registry.yml) | 有哪些测试、覆盖什么 | 一个测试文件 |
| API Registry | [api-registry.yml](api-registry.yml) | 有哪些接口 | 一个 endpoint |
| Decision Registry | Brain DB `decisions` 表 | 做了哪些架构决策 | 一个技术决策 |

---

## 系统全景（按子系统）

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

- 新功能合并前：Feature Registry 必须有对应条目
- 新 Skill 合并前：Skill Registry 必须更新
- 新 API 合并前：API Registry 必须更新
- CI L2 会检查 Feature Registry 与代码一致性（TODO: 待实现）
