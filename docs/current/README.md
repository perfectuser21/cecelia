---
id: current-docs-readme
version: 2.0.0
created: 2026-03-10
updated: 2026-03-25
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
| CI 流水线（L1-L4） | `docs/current/CI_PIPELINE.md` | 权威 |
| /dev 工作流 | `docs/current/DEV_PIPELINE.md` | 权威 |
| **自动巡检状态** | `docs/current/PATROL-REGISTRY.md` | 权威，见下方 |
| PR 学习记录 | `docs/learnings/cp-MMDDHHNN-xxx.md` | 每个PR自动写 |
| 架构审查结果 | `docs/arch-reviews/YYYY-MM-DD.md` | arch_review 写入 |
| 操作手册（技能/功能） | `docs/instruction-book/` | 用户/AI 操作参考 |
| 已知缺口 | `docs/gaps/` | 记录未覆盖区域 |
| 历史文档 | `docs/archive/` | 不读，已过期 |

---

## 文档路由：写到哪

| 做完了什么 | 写到哪 |
|-----------|--------|
| 合并了一个 PR | `docs/learnings/cp-xxx.md`（已在流程里）|
| 发现了系统架构变化 | `docs/current/SYSTEM_MAP.md` 更新版本号 |
| 发现了新的巡检缺口 | `docs/current/PATROL-REGISTRY.md` 更新状态 |
| 做了一个架构决定 | `localhost:5221/api/brain/decisions` POST |
| 完成了一个 OKR 任务 | `PATCH localhost:5221/api/brain/tasks/{id}` status→completed |

---

## 自动巡检状态（PATROL-REGISTRY）

> 更新时间：2026-03-25

| 巡检项 | 类型 | 触发方式 | 实际状态 | 发现→任务闭环 |
|--------|------|---------|---------|--------------|
| `check-coverage-completeness.mjs` | 脚本 | PR CI（L3） | ✅ 每个PR跑 | ❌ 无cron，warning不自动建任务 |
| `arch_review` | LLM | Brain调度 | ❌ 几乎不跑（7天内1条canceled） | ❌ |
| `code_review` | LLM | Brain调度 | ❌ 7天内0条 | ❌ |
| Brain src 覆盖率 Check4 | 脚本 | PR CI（L3） | ✅ 2026-03-25 上线 | ❌ 无cron |

**当前覆盖缺口（warning状态，未锁死）：**
- Brain 普通模块：10/151 无测试
- Engine hooks：4/9 无测试
- Engine devgate 脚本：8/13 无测试
- `apps/api/`、`apps/dashboard/`：完全未扫描

---

## 维护规则

- **谁来维护**：Claude 在完成相关任务后主动更新，不靠用户维护
- **更新时机**：合并 PR 后、巡检状态变化后、发现文档过期后
- **不需要 /dev**：这个文件是文档，直接改直接 commit
