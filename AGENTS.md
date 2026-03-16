# Cecelia — Agent Knowledge Root

> **读这个文件的人**：你是一个正在操作 Cecelia 系统的 AI Agent。
> 这里是入口地图，告诉你 Cecelia 是什么、能做什么、去哪找细节。
> 保持这个文件 ≤500 token。细节在下钻文件里，不要堆在这里。

---

## Cecelia 是什么

**Cecelia = 24/7 自主运行的 AI 管家系统**

```
Cecelia = Brain (Node.js, port 5221)
        + Tick Loop（每 5s 检查，每 2min 执行一次 tick）
        + 三层大脑（L0 脑干 / L1 丘脑 / L2 皮层）
        + PostgreSQL（数据存储）
        + 63 个 Skills（外部能力库）
```

Cecelia **自己不干活**，只负责决策和调度，召唤外部 Agent 执行具体任务。

---

## 启动 / 运行

```bash
# Brain 启动
cd packages/brain && node src/server.js

# 健康检查
curl localhost:5221/api/brain/health

# 查看系统状态
curl localhost:5221/api/brain/status/full

# 手动触发 tick
curl -X POST localhost:5221/api/brain/tick
```

---

## 模块地图

| 模块 | 路径 | 职责 | 详情 |
|------|------|------|------|
| Brain | `packages/brain/` | 核心调度、决策、保护 | → [brain/AGENTS.md](.agent-knowledge/brain.md) |
| Engine | `packages/engine/` | 开发工作流（hooks/skills/CI） | → [engine/AGENTS.md](.agent-knowledge/engine.md) |
| Apps | `apps/dashboard/` | React 前端界面 port 5211 | — |
| Skills | `~/.claude/skills/` | 63 个外部能力 | → [skills-index.md](.agent-knowledge/skills-index.md) |

---

## Cecelia 能调用什么

所有可调用的 Skills 按类型分组：→ **[.agent-knowledge/skills-index.md](.agent-knowledge/skills-index.md)**

任务类型 → Skill 路由表：→ **[.agent-knowledge/brain.md](.agent-knowledge/brain.md)**

---

## 实时状态（动态）

Cecelia 的当前运行状态不在本文件里，通过 API 实时查询：

```bash
# 队列状态、告警、Tick 状态
curl localhost:5221/api/brain/status/full

# 当前警觉等级
curl localhost:5221/api/brain/alertness
```

---

## 禁止操作

- 不要直接 push 到 `main`，所有代码变更走 `/dev`
- 不要跳过 DevGate（`scripts/devgate/`）
- 不要修改 `packages/brain/src/` 而不更新 `DEFINITION.md` 中的版本
- 不要修改 Skills 文件而不通过 `/dev` 流程

---

## 深度知识（HTML 知识页）

人类可读的深度说明书：`http://38.23.47.81:9998/knowledge/`

```
knowledge/
├── index.html          ← L1 系统总览
├── brain/index.html    ← L2 Brain 模块
├── engine/index.html   ← L2 Engine 模块
├── workflows/index.html← L2 Skills 库
└── system/index.html   ← L2 系统概念
```

---

*最后更新：2026-03-16 | Brain v1.217.0 | 63 Skills*
*自动维护：skills-index.md 由 CI 脚本从 SKILL.md 提取生成*
