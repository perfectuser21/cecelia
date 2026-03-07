---
name: plan
version: 1.7.0
created: 2026-02-17
updated: 2026-03-07
changelog:
  - 1.7.0: 加入 Stage 0.5 领域判断（domain detection）+ owner_role 匹配，输出格式增加 domain/owner_role，路由表按 domain 分流
  - 1.6.0: 层级重命名 Mission/Vision/Area OKR + /architect 加入路由
  - 1.5.0: 对齐 OKR 层级（加周期/产能）、修正 Layer 4 路由、新增产能感知和多机路由
  - 1.4.0: 新增无头 Suggestion 模式（[SUGGESTION_MODE]），Magentic-One 第5步
  - 1.3.0: 修复旧 skill 名残留，/okr 后台 → /decomp 后台；修复注意项末尾拆解 skill 名
  - 1.2.0: 重构层级识别框架——以规模/范围为主信号，时间为辅助信号，加入多维评估矩阵
  - 1.1.0: 加入 Stage 2 Capability 查询，识别输出格式增加已有能力和缺口
  - 1.0.0: 初始版本
description: |
  用户意图识别 + 层级引导 + Capability 匹配。
  用户说任何一件想做的事，自动识别是哪个层级（OKR/Project/Initiative/Task），
  查询已有能力和缺口，然后告诉用户下一步走哪个 skill。
  这是用户和系统之间的"翻译层"。
---

# /plan - 意图识别 + 层级引导

## 触发方式

**自动触发**（CLAUDE.md 配置）：用户描述一件想做的事时自动运行。

**手动触发**：
```
/plan 今天想把秋米的拆解流程做稳定一点
/plan 这个季度要把任务成功率提到 85%
/plan 给 cecelia-core 加一个健康检查 API
```

---

## Stage 0.5: 领域判断（Domain Detection）

**在层级识别之前运行**，判断用户输入属于哪个业务领域，匹配对应 owner_role，用于后续路由和任务归属。

### Domain → Owner Role 映射

| Domain | Owner Role | 关键词信号 |
|--------|-----------|-----------|
| coding | cto | 代码、开发、bug、CI、工程、架构、API、重构、测试、PR、依赖 |
| product | cpo | 产品、需求、PRD、用户体验、功能设计、交互、流程设计 |
| growth | cmo | 增长、营销、SEO、运营、推广、用户增长、转化、内容 |
| finance | cfo | 财务、预算、成本、收入、报表、账单 |
| research | vp_research | 调研、分析、研究、市场调查、竞品、数据分析 |
| quality | vp_qa | 质量、QA、测试覆盖、回归、稳定性、CI 稳定性 |
| security | cto | 安全、漏洞、权限、认证、加密、合规 |
| operations | coo | 运维、部署、监控、日志、告警、DevOps、基础设施 |
| knowledge | vp_knowledge | 知识、文档、笔记、整理、总结、知识库 |
| agent_ops | vp_agent_ops | Agent、LLM、调度、任务派发、Cecelia、Brain、自动化 |

**默认值**：无明确信号 → `coding`（最常见，大多数任务都是开发任务）

### 判断规则

1. **关键词匹配**：从用户输入中提取关键词，对照上表匹配 domain
2. **优先级**：agent_ops > quality > security > coding（有多个匹配时选更具体的）
3. **不确定时默认 coding**：不要过度判断，开发相关任务统一归 coding

### 判断示例

| 用户说 | Domain | Owner Role |
|--------|--------|-----------|
| "给 brain 加个健康检查 API" | coding | cto |
| "调整 Cecelia 的任务调度逻辑" | agent_ops | vp_agent_ops |
| "这个季度任务成功率要到 85%" | quality | vp_qa |
| "梳理一下 PRD 流程" | product | cpo |
| "把部署脚本改成幂等的" | operations | coo |
| "做个竞品分析" | research | vp_research |

---

## Stage 0: 层级识别（必须第一步）

### 6 层层级

```
Mission:    — Alex 级别，唯一，永久的使命（"为什么存在"）
Vision:     — 每个 Area 的方向性愿景（无具体度量）| 2个可并行
Area OKR:   — 每个 Area 的季度可量化目标（有度量指标）| 3-5个/Vision
Project:    — 目标型工作容器，周（1周）| 3-4个/Area OKR
Initiative: — 串联任务包，min_tasks:4 | 40-70个/Project
Task:       — 最小执行单元，1 PR | 4-8个/Initiative
```

---

### 多维评估矩阵（核心识别框架）

层级识别基于**三个维度**综合判断，**不能只看时间**：

#### 维度 1：范围（最重要）

| 问题 | 信号 | 倾向层级 |
|------|------|---------|
| 涉及几个 Area（Cecelia/ZenithJoy/...）？ | 2+ Area | Mission |
| 涉及几个仓库？ | 多仓库 | Project+ |
| 涉及几个仓库？ | 单仓库 | Initiative |
| 涉及全局基础设施/架构决策？ | 是 | Mission/Vision |
| 涉及某个 Area 的整体方向？ | 是 | Vision/Area OKR |

#### 维度 2：抽象程度

| 问题 | 信号 | 倾向层级 |
|------|------|---------|
| 是方向/目标，还是具体实现？ | 方向/目标 | Mission/Vision/Area OKR |
| 有没有可量化的度量指标（%/数量/频率）？ | 有 | Area OKR |
| 能直接开始写代码吗？ | 能 | Initiative/Task |
| 需要先拆解规划再执行？ | 需要 | Area OKR/Project |
| 需要讨论澄清方向？ | 需要 | Mission/Vision |

#### 维度 3：工作量

| 问题 | 信号 | 倾向层级 |
|------|------|---------|
| 多少个 PR？ | 1个PR | Initiative |
| 多少个 PR？ | 多个PR | Project |
| 单人能独立完成？ | 是 | Initiative/Task |
| 需要多个 Agent 协作？ | 是 | Area OKR/Project |
| 包含多个子功能模块？ | 是 | Project |

#### 时间（辅助信号，不是主信号）

时间只作为校验，**不能单独决定层级**：
- 很快能做完 → 支持 Initiative/Task 判断
- 需要很长时间 → 可能是 KR/Project（但大工程的 Initiative 也可能很慢）
- "这个季度"说的是 KR 的衡量周期，不代表一定是 Global OKR

---

### 识别流程

```
Step 1: 先问"涉及多少个 repo/Area/团队？"
    ↓
    多 Area 且战略使命 → Mission
    单 Area 且无度量 → Vision
    有度量指标 → Area OKR
    ↓
Step 2: 如果是具体实现，问"需要几个 PR？"
    ↓
    多 PR 或跨 repo → Project
    单 PR 单 repo → Initiative ★
    极小改动 → Task
    ↓
Step 3: 不确定时，默认 Initiative，问用户确认
```

---

### 判断示例

| 用户说 | 关键信号 | 层级 |
|--------|---------|------|
| "Perfect21 今年要实现全面自主运营" | 跨所有 Area，战略方向 | Mission |
| "Cecelia 这个月要更智能" | 单 Area，方向性，无度量 | Vision |
| "任务成功率要到 85%" | 有度量指标（85%），可量化 | Area OKR |
| "把质检系统接入所有 14 个 repo" | 跨多仓库，多 PR | Project |
| "给 cecelia-core 加健康检查 API" | 单 repo，单功能，1 PR | Initiative ★ |
| "修一下这个 null pointer" | 极小，单文件 | Task |
| "这个季度把 CI 稳定性提到 99%" | 有度量（99%）→ Area OKR，时间是度量周期 | Area OKR |

> **关键**："这个季度" 描述的是 Area OKR 的度量周期，不是 Mission 的信号。
> 有度量指标 → Area OKR，无论时间长短。

---

### 模糊时的提问框架

如果输入信号不足，**问这2个问题**：

```
1. "这涉及几个仓库/团队？"
   → 判断 Project vs Initiative

2. "有没有具体的衡量指标？（比如成功率X%、完成Y个）"
   → 判断 KR vs OKR
```

---

## Stage 1: 识别输出（必须格式）

识别完成后，**必须输出以下格式**：

```
[Plan 识别]
━━━━━━━━━━━━━━━━━━━━━━
输入："{用户原话}"
领域：{domain}（coding/product/growth/finance/research/quality/security/operations/knowledge/agent_ops）
负责人：{owner_role}（cto/cpo/cmo/cfo/vp_qa/vp_research/coo/vp_knowledge/vp_agent_ops）
层级：{层级名}（Mission/Vision/Area OKR/Project/Initiative/Task）
依据：{识别理由，说明哪个维度的信号起决定作用}
━━━━━━━━━━━━━━━━━━━━━━
已有能力（从 capability 表匹配）：
  • {capability name}（stage={N}）— {一句话描述}
  （如果没有相关的，写"无"）
缺口：{没有 capability 覆盖的部分，或"无明显缺口"}
━━━━━━━━━━━━━━━━━━━━━━
下一步：{具体行动}
```

---

## Stage 2: Capability 查询

**在识别层级后、输出结果前，查询 Brain API 的 capability 表，匹配已有能力和缺口。**

### 查询方式

```bash
curl -s http://localhost:5221/api/brain/capabilities | jq
```

### 匹配规则

1. 根据用户输入的关键词，模糊匹配相关 capability：
   - 用户说"部署" → 匹配 `brain-deployment` 相关
   - 用户说"任务" → 匹配 `autonomous-task-scheduling` 相关
   - 用户说"OKR" → 匹配 `okr-six-layer-decomposition` 相关
   - 用户说"开发" → 匹配 `dev-workflow` 相关
2. 如果没有相关 capability，输出"无"
3. 最多列出 **3 个**最相关的 capability
4. 每个 capability 显示 name、stage、一句话描述

### 缺口分析

- 如果用户想做的事已经有 capability 覆盖 → 缺口写"无明显缺口"
- 如果用户想做的事没有 capability 覆盖 → 缺口写出缺少什么能力
- 缺口信息帮助后续 /dev 或 /decomp 决定是否需要新建 capability

---

## Stage 3: 层级 → 下一步映射

| 识别层级 | 下一步 | 说明 |
|---------|--------|------|
| Mission | 讨论澄清 → 存入 DB | Alex 级别使命，战略对齐 |
| Vision | 讨论澄清 → 存入 DB | 每 Area 方向性愿景，对话确认 |
| Area OKR | `/architect Mode 1` → `/decomp` → `/decomp-check` | 季度目标，先扫描系统再拆解 |
| Project | `/architect Mode 1` → `/decomp` → `/decomp-check` | 先拆解，每个 Initiative 走 `/architect Mode 2` → `/dev` |
| Initiative ★ | `/architect Mode 1` → `/architect Mode 2` → `/dev` | 最常见路径，先设计再开发 |
| Task | **直接 `/dev`** | 小改动，直接做 |

---

## Stage 4: Initiative 路径（详细）

**Initiative 是最常见路径**，走以下流程：

```
用户说 "今天想做 XXX"
    ↓
[Plan 识别] Initiative
    ↓
确认 repo（在哪个仓库做？）
    ↓
/architect Mode 1（CTO 扫描：读代码 → 写入 system_modules 知识库，若今日已跑可跳过）
    ↓
/architect Mode 2（技术设计：读 system_modules → 输出 architecture.md + 拆解 Tasks）
    ↓
/dev 开始（PRD → DoD → Code → PR → CI → Merge）
```

**不需要先创建 Initiative 记录**（/dev 里会处理），直接开始写 PRD。

---

## Stage 5: Area OKR 路径（详细）

**Area OKR 走架构扫描 + 后台拆解**：

```
用户说 "任务成功率要到 85%"
    ↓
[Plan 识别] Area OKR
    ↓
/architect Mode 1（CTO 扫描：读代码 → 写入 system_modules 知识库）
    ↓
确认 Area OKR 信息：
  - 所属 Area：（Cecelia / ZenithJoy / ...）
  - 度量指标：（85% 成功率）
  - 度量周期：（这个月 / 这个季度）
    ↓
存入 DB（POST /api/brain/action/create-goal, type='area_okr', status='ready'）
    ↓
/decomp → /decomp-check（拆解到 Initiative）
    ↓
每个 Initiative: /architect Mode 2 → /dev
```

---

## 产能感知

识别到 Mission/Vision/Area OKR 时，需考虑当前系统产能：

| 指标 | 数值 | 说明 |
|------|------|------|
| 并行 Vision | 2 个 | 系统同时支持 2 个 Vision 并行 |
| 研发 slot | 10 个 | 美国 VPS，每 Area OKR 约占 1 slot |
| 月产能 | ~8,600 PR | 基于 10 slot 全速运转估算 |

**提示**：识别到高层级（Mission/Vision/Area OKR）时，查询当前 slot 负载再建议下一步。

---

## 多机路由

不同类型的任务路由到不同机器和负责人：

### 按 Domain 路由

| Domain | Owner Role | 目标机器 | Skill |
|--------|-----------|----------|-------|
| coding | cto | 美国 VPS | `/dev` |
| agent_ops | vp_agent_ops | 美国 VPS | `/dev` |
| quality | vp_qa | 美国 VPS | `/qa` |
| security | cto | 美国 VPS | `/audit` |
| product | cpo | 美国 VPS | `/decomp` |
| research | vp_research | 美国 VPS | `/research` |
| operations | coo | 美国 VPS | `/dev` |
| knowledge | vp_knowledge | 美国 VPS | `/knowledge` |
| growth | cmo | 香港 VPS | `/dev` |
| finance | cfo | 美国 VPS | 人工处理 |

### 按机器路由（原有）

| 任务类型 | 目标机器 | 说明 |
|----------|----------|------|
| 开发任务（Claude Code） | 美国 VPS | 10 slot 研发环境 |
| 生产任务（MiniMax） | 香港 VPS | 生产部署 + 低延迟 |
| 视频/内容生成 | Mac mini | GPU 加速 |
| 数据处理 | 办公室 PC | 大内存 + 本地存储 |

---

## 注意

- **规模/范围是主信号**：先判断"涉及多少 repo/Area/团队"
- **时间是辅助信号**：时间长不等于层级高，时间是度量周期而非定级标准
- **有度量指标 → Area OKR**：无论用户说"这个月"还是"这个季度"
- **不确定就问**：用"涉及几个仓库？"和"有没有度量指标？"两个问题快速定级
- **Initiative 是默认**：模糊情况统一判 Initiative，不要过度拆解
- **不要自己做拆解**：/plan 只识别 + 引导，拆解是 /decomp 的工作
- **Initiative/Project 先走 /architect**：代码改动前先让 /architect 扫描架构，避免盲目开发

---

## 无头 Suggestion 模式

**触发条件**：task description 包含 `[SUGGESTION_MODE]`

此模式由 Brain 自动触发（无用户交互），task_type=`suggestion_plan`。
目标：识别 Suggestion 的层级，找挂载点，调 Brain API 创建相应结构。

### 输入格式

task description 格式：
```
[SUGGESTION_MODE]

Suggestion ID: <uuid>
Score: <float>
Source: <source_type>

内容：
<suggestion 原文>
```

### 执行步骤

**Step 1: 读取当前 OKR 结构**

```bash
# 获取所有活跃 KR
curl -s http://localhost:5221/api/brain/goals | jq '.[] | {id, title, status, level}'

# 获取所有活跃 Projects
curl -s http://localhost:5221/api/brain/projects | jq '.[] | {id, name, type, parent_id}'
```

**Step 2: 层级判断（使用本文档的多维矩阵）**

重点判断信号：
- Suggestion 内容是否有度量指标？→ Area OKR
- 涉及多个 repo 或系统架构？→ Project
- 单个功能、1-2 个 PR？→ Initiative（**最常见**）
- 极小改动，立即能做？→ Task

**默认规则**：不确定时 → Initiative。

**Step 3: 找挂载点**

根据 Suggestion 内容，在现有 OKR 结构中找到最合适的父节点：
- Area OKR → 找所属的 Vision/Goal
- Project → 找所属的 Area OKR
- Initiative → 找所属的 Project（type='project'）
- Task → 找所属的 Project（type='initiative'）

**Step 4: 调 Brain API 创建结构**

| 层级 | API 调用 |
|------|---------|
| Area OKR | `POST /api/brain/action/create-goal` (type='area_okr') |
| Project | `POST /api/brain/action/create-project` (type='project', kr_id=...) |
| Initiative | `POST /api/brain/action/create-project` (type='initiative', parent_id=<project_id>) |
| Task | `POST /api/brain/tasks` (task_type='dev', project_id=<initiative_id>) |

Layer 5 Initiative API 示例：
```bash
curl -s -X POST http://localhost:5221/api/brain/action/create-project \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<initiative 名称，来自 suggestion 内容>",
    "type": "initiative",
    "parent_id": "<project_id>",
    "description": "<suggestion 原文>"
  }'
```

Layer 6 Task API 示例：
```bash
curl -s -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "<task 标题>",
    "description": "<suggestion 原文>",
    "task_type": "dev",
    "priority": "P2",
    "project_id": "<initiative_id>"
  }'
```

### 输出格式（结构化 JSON）

执行完成后，输出以下结构化 JSON（供 execution-callback 解析）：

```json
{
  "suggestion_id": "<uuid>",
  "identified_layer": "Initiative",
  "layer_name": "Initiative",
  "reasoning": "单 repo，单功能，约 1-2 PR 工作量",
  "mount_point": {
    "type": "project",
    "id": "<project_id>",
    "name": "<project 名称>"
  },
  "created": {
    "type": "initiative",
    "id": "<新创建的 initiative id>",
    "name": "<initiative 名称>"
  },
  "status": "success"
}
```

如果判断失败或找不到挂载点：
```json
{
  "suggestion_id": "<uuid>",
  "identified_layer": "unknown",
  "reasoning": "无法确定层级或找不到合适的挂载点",
  "status": "failed",
  "error": "<错误说明>"
}
```

### 注意事项

- **不要等用户确认**：全自动运行，不输出交互式问题
- **幂等性**：如果同名 Initiative/Task 已存在，跳过创建，返回已有 ID
- **不确定就选 Initiative**：Initiative 是最安全的默认选择
- **写完就结束**：输出 JSON 后立即结束，不进入 /dev 流程
