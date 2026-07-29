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

## 硬规则摘要（Hard Rules Summary — 与 .claude/CLAUDE.md 同步）

> 这是 `.claude/CLAUDE.md` 里同名 section 的逐字同步副本，专为 Codex 等只原生读 AGENTS.md 的执行体准备。
> 由 `scripts/check-agents-rules-sync.sh` 校验一致性，改动前必须先改 `.claude/CLAUDE.md` 再同步过来。

<!-- HARD_RULES:BEGIN -->
### 语言
1. 所有输出必须使用简体中文，禁止日语、韩语或其他语言。

### 分支与提交
2. 绝对禁止 `git push origin main`。
3. 绝对禁止在 main 分支上 `git add` / `git commit`。
4. 分支策略：`cp-*` / `feature/*` 分支开发 → PR → main，不允许绕过。
5. push 后必须等待 CI 完成，禁止用 `gh pr merge --admin` 绕过 CI 检查。
6. commit message 遵循 Conventional Commits 格式（feat/fix/docs/chore/test/refactor/build/ci/style/perf/revert）。

### 危险操作确认
7. 网络配置变更、分区操作、`docker rm -f` 生产容器、数据库 schema 直改、`ufw deny 22` 等危险操作，必须先告知风险并获得明确确认后才能执行。

### Brain 改动门禁（DevGate）
8. 改动 `packages/brain` 代码前必须依次通过：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs`。
9. DevGate 校验失败时禁止继续编码，必须先修复校验问题。
10. 不允许凭记忆/猜测编造架构、跳过 DevGate、引用已废弃的旧路径。

### 任务追踪
11. 改代码走 `/dev` 流程（bug 修复 / 小改动 / 大功能三条路径）。
12. 任务生命周期状态通过 Brain API（`localhost:5221`）管理，不使用临时 ad-hoc 状态记录。

### 决策留痕
13. 用户做出的实质性决策必须写入 Brain `decisions` 表，不放进 memory 或 CLAUDE.md。

### 代码规范
14. 禁止创建 `*New.tsx` / `*Old.tsx` / `*Backup.*` 等临时版本文件。
15. 禁止在仓库根目录堆放临时脚本。
16. 不主动创建 markdown 文档，除非用户明确要求。
17. 单文件超过 500 行需拆分；同一段逻辑重复出现 3 次以上需提取为函数。
18. 完成任务后必须清理调试用的 `console.log`、注释掉的死代码、未使用的 import。

### Bug 修复流程
19. 修 bug 前必须先写一个能复现该 bug 的 failing test。
20. 该 failing test 修复后必须永久保留在 CI 里作为回归测试，不能删除。

### 验收标准
21. 功能验收必须验证真实产出效果（例如：视频类功能用 ffprobe 验证真实视频/音频流；数据写入类功能查数据库确认记录存在），不能仅凭"测试通过"这类空泛断言收尾。

### 凭据管理
22. API Key / Token / 密钥等凭据一律不提交进 git；`.gitignore` 必须排除 `.env` / `*.key` / `*.pem` 等敏感文件模式。

### AI 自我检测
23. 当输出中出现"手动/您可以/暂时禁用/等待用户/绕过/临时/跳过/忽略/先不管/稍后"这类推诿性措辞时，必须停下重新分析并自动解决问题，不能把困难推给用户。
<!-- HARD_RULES:END -->
