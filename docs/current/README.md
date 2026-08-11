---
id: current-docs-readme
version: 2.2.7
created: 2026-03-10
updated: 2026-08-11
---

# Cecelia 文档路由表

> Claude 对话开始时读这个文件，知道"内容在哪查、做完写到哪"。
> 铁规则：只记录 main 分支当前真实存在的内容，不脑补。

---

## 核心系统状态（实时）

| 查什么 | 去哪查 | 方式 |
|--------|--------|------|
| 当前 OKR + 活跃任务 + 近期 PR | `curl localhost:5221/api/brain/context` | API |
| OKR 树（objectives → KRs） | `curl localhost:5221/api/brain/okr/current` | API |
| 进行中任务 | `curl "localhost:5221/api/brain/tasks?status=in_progress&limit=10"` | API |
| 有效决策 | `curl "localhost:5221/api/brain/decisions?status=active"` | API |

---

## 文档路由：查在哪

| 内容类型 | 位置 | 说明 |
|----------|------|------|
| 整体架构、子系统关系 | `docs/current/SYSTEM_MAP.md` | 权威，每10个PR审计一次 |
| **Kernel Harness / 能力（Capability）体系**（完成定义+非功能需求/7项合同/两套派发分流/provider注入链/数据账本） | `docs/current/KERNEL_HARNESS_MAP.md` | 权威指针地图，只放指针不放快照 |
| **术语对照表**（价值流/能力/主干活动/特性/使能项/验收标准…） | `packages/workflows/KERNEL_CONTEXT.md` | 决策 a340f100 正本，对话/UI/文档统一用词 |
| CI 流水线（L1-L4） | `docs/current/CI_PIPELINE.md` | ⚠️ 过期待重写（2026-03旧结构），仅存档参考 |
| /dev 工作流 | `docs/current/DEV_PIPELINE.md` | ⚠️ 过期待重写（2026-03旧结构），仅存档参考 |
| PR 学习记录 | `docs/learnings/cp-MMDDHHNN-xxx.md` | 每个PR自动写 |
| 架构审查结果 | `docs/arch-reviews/YYYY-MM-DD.md` | 最新：2026-08-11 20:00 UTC，CRITICAL（9 高/19 中；preview/production 重复派发且 callback 串环境、生产 internal auth 写面 503、staging 副作用 loops 与物理 schema 未隔离、两条 nightly 均失败且诊断失真） |
| 操作手册（技能/功能） | `docs/instruction-book/` | 用户/AI 操作参考 |
| 已知缺口 | `docs/gaps/` | 记录未覆盖区域 |
| 历史文档 | `docs/archive/` | 不读，已过期 |

---

## 文档路由：写到哪

| 做完了什么 | 写到哪 |
|-----------|--------|
| 合并了一个 PR | `docs/learnings/cp-xxx.md`（已在流程里）|
| 发现了系统架构变化 | `docs/current/SYSTEM_MAP.md` 更新版本号 |
| 发现了新的巡检缺口 | `localhost:5221/api/brain/decisions` 记录缺口决策 |
| 做了一个架构决定 | `localhost:5221/api/brain/decisions` POST |
| 完成了一个 OKR 任务 | `PATCH localhost:5221/api/brain/tasks/{id}` status→completed |

---

## 维护规则

- **谁来维护**：Claude 在完成相关任务后主动更新，不靠用户维护
- **更新时机**：合并 PR 后、巡检状态变化后、发现文档过期后
- **不需要 /dev**：这个文件是文档，直接改直接 commit
