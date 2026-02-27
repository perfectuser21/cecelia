---
name: plan
version: 1.3.0
created: 2026-02-17
updated: 2026-02-27
changelog:
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

## Stage 0: 层级识别（必须第一步）

### 6 层层级

```
Layer 1: Global OKR   — 跨多个 Area 的全平台战略目标
Layer 2: Area OKR     — 单 Area 内的方向性目标（无具体度量）
Layer 3: KR           — 关键结果（有可量化的度量指标）
Layer 4: Project      — 跨多 repo 或多 Initiative 的工作包
Layer 5: Initiative   — 单 repo 单功能，一个 PR 大小 ★ 最常见
Layer 6: Task         — 单一操作，明确且极小
```

---

### 多维评估矩阵（核心识别框架）

层级识别基于**三个维度**综合判断，**不能只看时间**：

#### 维度 1：范围（最重要）

| 问题 | 信号 | 倾向层级 |
|------|------|---------|
| 涉及几个 Area（Cecelia/ZenithJoy/...）？ | 2+ Area | Layer 1 |
| 涉及几个仓库？ | 多仓库 | Layer 4+ |
| 涉及几个仓库？ | 单仓库 | Layer 5 |
| 涉及全局基础设施/架构决策？ | 是 | Layer 1-2 |
| 涉及某个 Area 的整体方向？ | 是 | Layer 2-3 |

#### 维度 2：抽象程度

| 问题 | 信号 | 倾向层级 |
|------|------|---------|
| 是方向/目标，还是具体实现？ | 方向/目标 | Layer 1-3 |
| 有没有可量化的度量指标（%/数量/频率）？ | 有 | Layer 3 (KR) |
| 能直接开始写代码吗？ | 能 | Layer 5-6 |
| 需要先拆解规划再执行？ | 需要 | Layer 3-4 |
| 需要讨论澄清方向？ | 需要 | Layer 1-2 |

#### 维度 3：工作量

| 问题 | 信号 | 倾向层级 |
|------|------|---------|
| 多少个 PR？ | 1个PR | Layer 5 |
| 多少个 PR？ | 多个PR | Layer 4 |
| 单人能独立完成？ | 是 | Layer 5-6 |
| 需要多个 Agent 协作？ | 是 | Layer 3-4 |
| 包含多个子功能模块？ | 是 | Layer 4 |

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
    多 Area → Layer 1 Global OKR
    单 Area 且无度量 → Layer 2 Area OKR
    有度量指标 → Layer 3 KR
    ↓
Step 2: 如果是具体实现，问"需要几个 PR？"
    ↓
    多 PR 或跨 repo → Layer 4 Project
    单 PR 单 repo → Layer 5 Initiative ★
    极小改动 → Layer 6 Task
    ↓
Step 3: 不确定时，默认 Layer 5，问用户确认
```

---

### 判断示例

| 用户说 | 关键信号 | 层级 |
|--------|---------|------|
| "Perfect21 今年要实现全面自主运营" | 跨所有 Area，战略方向 | Layer 1 |
| "Cecelia 这个月要更智能" | 单 Area，方向性，无度量 | Layer 2 |
| "任务成功率要到 85%" | 有度量指标（85%），可量化 | Layer 3 KR |
| "把质检系统接入所有 14 个 repo" | 跨多仓库，多 PR | Layer 4 Project |
| "给 cecelia-core 加健康检查 API" | 单 repo，单功能，1 PR | Layer 5 Initiative ★ |
| "修一下这个 null pointer" | 极小，单文件 | Layer 6 Task |
| "这个季度把 CI 稳定性提到 99%" | 有度量（99%）→ KR，时间是度量周期 | Layer 3 KR |

> **关键**："这个季度" 描述的是 KR 的度量周期，不是 Global OKR 的信号。
> 有度量指标 → KR，无论时间长短。

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
层级：Layer N - {层级名}
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
| Layer 1: Global OKR | 讨论澄清 → 存入 DB | 太大，需要先讨论全局方向 |
| Layer 2: Area OKR | 讨论澄清 → 存入 DB | 需要明确 Area 目标 |
| Layer 3: KR | 触发秋米（`/decomp` 后台） | 先收集信息 → 确认 → 拆解到 Initiative |
| Layer 4: Project | `/dev` + 多 PR 规划 | 创建 Initiative + 拆 PR |
| Layer 5: Initiative ★ | **直接 `/dev`** | 最常见路径 |
| Layer 6: Task | **直接 `/dev`** | 小改动，直接做 |

---

## Stage 4: Initiative 路径（详细）

**Layer 5 Initiative 是最常见路径**，走以下流程：

```
用户说 "今天想做 XXX"
    ↓
[Plan 识别] Layer 5 Initiative
    ↓
确认 repo（在哪个仓库做？）
    ↓
/dev 开始（PRD → DoD → Code → PR → CI → Merge）
```

**不需要先创建 Initiative 记录**（/dev 里会处理），直接开始写 PRD。

---

## Stage 5: KR 路径（详细）

**Layer 3 KR 走后台拆解**：

```
用户说 "任务成功率要到 85%"
    ↓
[Plan 识别] Layer 3 KR
    ↓
确认 KR 信息：
  - 所属 Area：（Cecelia / ZenithJoy / ...）
  - 度量指标：（85% 成功率）
  - 度量周期：（这个月 / 这个季度）
    ↓
存入 DB（POST /api/brain/action/create-goal, type='kr', status='ready'）
    ↓
OKR Tick 自动检测 → 触发秋米调用 /decomp 后台拆解
    ↓
秋米调用 /decomp 拆解到 Initiative（Brain 自动创建 Task）
```

---

## 注意

- **规模/范围是主信号**：先判断"涉及多少 repo/Area/团队"
- **时间是辅助信号**：时间长不等于层级高，时间是度量周期而非定级标准
- **有度量指标 → KR**：无论用户说"这个月"还是"这个季度"
- **不确定就问**：用"涉及几个仓库？"和"有没有度量指标？"两个问题快速定级
- **Initiative 是默认**：模糊情况统一判 Layer 5，不要过度拆解
- **不要自己做拆解**：/plan 只识别 + 引导，拆解是 /decomp 的工作
