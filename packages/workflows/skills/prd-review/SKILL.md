---
name: prd-review
version: 1.0.0
model: claude-sonnet-4-6
created: 2026-03-20
updated: 2026-03-20
changelog:
  - 1.0.0: 合并 decomp-check + prd_audit 为统一 PRD 审查 Gate
description: |
  PRD 审查 Gate（Codex Gate 1/4）。合并了 decomp-check（拆解质检）和 prd_audit（PRD 审计）。
  覆盖拆解结构质量 + PRD 覆盖度 + DoD 可验证性 + 层级正确性四个维度。
  给出 approved / needs_revision / rejected 三态裁决。
  rejected 时自动触发秋米重拆。
  触发词：审查拆解、PRD审查、prd-review、质检拆解。
---

> **CRITICAL LANGUAGE RULE: 所有输出必须使用简体中文。**

# PRD-Review — PRD 审查 Gate

**唯一职责**：审查 /decomp 产出的拆解结构 + PRD 文档质量，给出明确裁决。

合并了以下两个旧 Skill 的职责：
- `decomp-check`：拆解结构质检（数量、因果链、覆盖度、层级）
- `prd_audit`：PRD 文档审计（承诺 vs 实际覆盖、DoD 可验证性）

不做拆解，不改方向，不建议。只判断：**拆解结构好不好？PRD 覆盖全不全？**

---

## 触发方式

```
/prd-review                              # 审查当前拆解
/prd-review --decomp-type <type>         # 指定拆解类型
```

### Brain 自动派发

```json
{
  "task_type": "prd_review",
  "decomp_type": "okr_to_kr | kr_to_project | project_to_initiative",
  "parent": { "id": "<uuid>", "type": "...", "title": "..." },
  "children": [{ "id": "...", "title": "...", "type": "...", "metadata": {} }]
}
```

---

## 输入格式

Brain 传入：

```json
{
  "decomp_type": "okr_to_kr | kr_to_project | project_to_initiative",
  "parent": {
    "id": "<uuid>",
    "type": "global_okr | area_okr | kr | project",
    "title": "...",
    "metric_from": 60,
    "metric_to": 90
  },
  "children": [
    { "id": "...", "title": "...", "type": "...", "metadata": {} }
  ],
  "prd_content": "PRD 原文（可选，若有则进行 PRD 覆盖度检查）"
}
```

---

## 审查维度

### 维度 A：拆解结构质量

#### OKR -> KR（Global OKR 或 Area OKR 拆 Key Results）

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **数量** | 2-5 个 KR | < 2 或 > 5 |
| **可量化** | 每个 KR 有 from/to 数字 | "提升"、"优化"等无数字描述 |
| **格式** | 动词 + 对象 + 从X到Y | 缺少基线值或目标值 |
| **度量可行性** | 度量方式可实际执行 | "用户满意度"等无法查询的指标 |
| **覆盖度** | KR 全部达成 -> OKR 目标实现 | 明显遗漏关键结果领域 |
| **独立性** | 各 KR 独立，无重叠 | 两个 KR 本质上测同一件事 |

#### KR -> Project

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **数量** | 1 个 KR -> 3-4 个 Project（以周为单位） | < 3 -> needs_revision；> 6 -> needs_revision |
| **因果链** | 每个 Project 有具体"推动方式"说明 | "有助于提升"等空洞描述 |
| **覆盖度** | 所有 Project 加起来能推动指标 from->to | 做完这些明显不够达到目标值 |
| **命名具体** | 名称是可交付的功能模块 | "研究XXX"、"优化YYY"等模糊名称 |
| **验收标准** | 每个 Project 有可测试的验收条件 | 验收标准不可测试 |
| **战略对齐** | Project 方向与 KR 一致 | Project 和 KR 关联牵强 |

#### Project -> Initiative

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **数量（初始拆解）** | >= 10 个 Initiative（首次拆解） | < 10 个 |
| **数量（Project 总周期）** | 40-70 个 Initiative（全生命周期累计） | < 40 或 > 70 |
| **内部串联依赖** | Initiative 内 Task 有顺序依赖（Task 1->2->3->4） | Task 之间无依赖关系 |
| **Initiative 间可并行** | 不同 Initiative 之间可以并行执行 | Initiative 之间强串联依赖 |
| **DoD 明确** | 每个 Initiative 有清晰完成定义 | DoD 是"做完XXX"这种无法验证的描述 |
| **Test 字段** | 每个 DoD 条目有 `test:` 字段 | DoD 纯文字描述，无 test 字段 |
| **覆盖度** | 所有 Initiative 做完 -> Project 验收条件全过 | 明显遗漏关键步骤 |
| **命名可执行** | 名称明确说明交付什么 | "处理"、"完善"、"优化"等无内容词 |
| **层级正确** | Initiative 下是 Task，不是另一个 Initiative | 层级错误（Initiative 嵌套） |
| **type 字段正确** | 每个 child 的 `type` 字段为 `'initiative'` | `type` 为其他错误值 |
| **无层级跳跃** | children 中不存在 `type='task'` 的记录 | 出现 `type='task'` 说明跳过了 Initiative 层级 |

#### Initiative -> Task（Task 数量检查）

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **Task 数量下限** | 每个 Initiative 至少 4 个 Task | < 4 个 -> rejected |
| **Task 数量上限** | 每个 Initiative 最多 8 个 Task | > 8 个 -> needs_revision |
| **Task 串联依赖** | Task 之间有明确的顺序依赖 | Task 之间完全独立无依赖 |

### 维度 B：PRD 覆盖度（新增，来自 prd_audit）

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **承诺覆盖** | PRD 中每个成功标准都有对应 Initiative 承接 | 有成功标准无人承接 |
| **需求追溯** | 每个 Initiative 可追溯到 PRD 中的具体需求 | Initiative 与 PRD 无关联 |
| **边界完整** | PRD 中的非功能需求（性能、安全）有 Initiative 覆盖 | 非功能需求被遗漏 |
| **优先级对齐** | 高优先级需求对应的 Initiative 排在前面 | 优先级倒挂 |

### 维度 C：DoD 可验证性

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **test 字段存在** | 每个 DoD 条目有 `test:` 字段 | 缺少 test 字段 |
| **test 命令格式** | `manual:` 命令只用白名单工具（node/npm/curl/bash/psql） | 使用了 grep/ls/cat 等非白名单工具 |
| **test 可执行** | test 命令有明确的成功/失败判定 | 命令只有输出没有判定 |
| **覆盖充分** | DoD 条目覆盖所有关键功能点 | 关键功能点无对应 DoD |

---

## 裁决规则

### approved

所有检查项通过，拆解结构质量和 PRD 覆盖度均满意。

### needs_revision

1-2 个轻微问题，可在原基础上修正：
- 某个 KR 缺少度量方式但格式正确
- 某个 Initiative 命名模糊但逻辑正确
- Initiative 数量轻微不足（如 8-9 个，接近 10 的下限）
- 某个 Initiative DoD 缺少 test 字段但逻辑正确（1-2 个）
- PRD 中有 1-2 个低优先级需求未被 Initiative 覆盖

### rejected

以下任一情况立即 rejected：
- 因果链断裂（Project 无法推动 KR 指标）
- KR 无数字（无法度量）
- 拆解与父层目标完全不相关
- 层级错误（Initiative 下嵌套 Initiative）
- 子项全是空洞名称，无法执行
- DoD 无 Test 字段（所有 Initiative 的 DoD 都是纯文字）
- 层级跳跃（children 中出现 `type='task'`）
- Initiative Task 不足（某个 Initiative 的 Task < 4）
- PRD 核心需求（成功标准）无 Initiative 承接

---

## 输出格式（必须 JSON）

```json
{
  "verdict": "approved | needs_revision | rejected",
  "score": 1-10,
  "decomp_type": "kr_to_project",
  "findings": {
    "拆解结构": "合格 / 不合格（原因）",
    "因果链": "对齐 / 断裂（原因）",
    "覆盖度": "完整 / 遗漏（具体遗漏什么）",
    "命名质量": "清晰 / 模糊（哪几个，为什么）",
    "数量": "合理（N个）/ 过少（N个）/ 过多（N个）",
    "战略对齐": "对齐 / 偏离（如何偏离）",
    "PRD覆盖": "完整 / 遗漏（哪些成功标准未被覆盖）",
    "DoD可验证性": "全部可验证 / 部分缺失（哪些缺 test 字段）"
  },
  "issues": [
    "具体问题1（必须可操作，不能写'可以改进'）",
    "具体问题2"
  ],
  "summary": "一句话总结",
  "next_action": "proceed | revise | redispatched_to_autumnrice"
}
```

`next_action` 规则：
- `approved` -> `proceed`（继续流程）
- `needs_revision` -> `revise`（修正后重新提交审查）
- `rejected` -> `redispatched_to_autumnrice`（打回重拆）

---

## 反馈回路（打回重拆机制）

当 `verdict = rejected` 时，Brain 收到 `redispatched_to_autumnrice` 信号：

```
PRD-Review 输出 rejected
        |
Brain 接收 next_action=redispatched_to_autumnrice
        |
Brain 更新 parent 状态 -> status='ready'（重新进入拆解队列）
        |
Tick 检测到 ready -> 重新触发秋米
        |
秋米读取 PRD-Review 的 findings（通过 parent metadata 传递）
        |
秋米基于反馈重新拆解
        |
再次提交 PRD-Review 审查
```

**重试上限**：最多 3 次 rejected 后，升级为需人工介入（parent status='needs_info'）。

---

## 核心原则

1. **明确裁决，不模棱两可**：必须给出三态之一，不能说"有待改进"
2. **findings 要具体可操作**：不写"命名不清晰"，写"Initiative #2 '处理监控' 无法判断交付什么，建议改为'实现 /metrics 端点并注册到 Dashboard'"
3. **只看结构 + 覆盖度，不改方向**：方向是否正确由用户决定
4. **快速判断**：审查一次不超过 5 分钟
